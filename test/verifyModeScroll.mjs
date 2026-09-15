/**
 * verifyModeScroll.mjs — mode-switch scroll-ratio preservation regression.
 *
 * Switching modes (split↔edit↔preview) previously refocused the textarea and
 * let the browser's scroll-to-caret + followScroll ratchet snap the entering
 * pane to the document end. `setMode` now records the leaving-mode ratio and
 * re-asserts it on the entering panes after two rAF ticks. Covers split→edit
 * (caret-end), 55%/50%/30% ratio preservation, and the fast triple-switch race.
 * Run with `npm run verify-modescroll`.
 */
// Regression: switching view modes (split / edit / preview) must preserve the
// scroll RATIO of the previously-visible pane.
//
// Before the `setMode` fix: with the caret at the END of the document, clicking
// the mode button focused the textarea and the browser's scroll-to-caret +
// `followScroll` ratchet snapped the newly-visible pane to the BOTTOM. Now
// `setMode` records the leaving-mode ratio *before* the class toggle and
// re-asserts it on the entering panes after two nested rAF ticks — winning the
// race against the focus auto-scroll.
//
// Mode button order: split -> edit -> preview -> split.
// Run: node test/verifyModeScroll.mjs
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

/**
 * sleep — sleep for `ms` milliseconds.
 * @param {number} ms — the delay.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync(`kill $(lsof -ti tcp:4603) 2>/dev/null || true`, { stdio: "ignore" }); } catch {}
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4603", "--strictPort"], {
  stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true,
});
await sleep(1800);
const b = await chromium.launch();
const p = await (await b.newContext()).newPage({ viewport: { width: 1280, height: 900 } });
await p.goto("http://localhost:4603/", { waitUntil: "networkidle" });
await sleep(400);

let pass = 0, fail = 0;
/**
 * okMsg — record a pass/fail and log it, optionally with a detail line.
 * @param {boolean} good — true to pass.
 * @param {string} name — the assertion label.
 * @param {string} [line] — a detail line to append.
 */
const okMsg = (good, name, line) => { good ? pass++ : fail++; console.log(`${good ? "PASS" : "FAIL"}  ${name} ${line ? "|" + line : ""}`); };

/**
 * ok — assert `got` is within `tol` of `want`.
 * @param {string} name — the assertion label.
 * @param {number} got — the measured value.
 * @param {number} want — the expected value.
 * @param {number} [tol] — tolerance (default 0.05).
 */
const ok = (name, got, want, tol) => {
  const good = Math.abs(got - want) <= (tol ?? 0.05);
  okMsg(good, name, `got=${got.toFixed(3)} want=${want}`);
};

/**
 * eq — assert strict equality of `got` and `want`.
 * @param {string} name — the assertion label.
 * @param {*} got — the measured value.
 * @param {*} want — the expected value.
 */
const eq = (name, got, want) => okMsg(got === want, name, `got=${got} want=${want}`);

/**
 * ratio — a pane's scroll ratio (scrollTop / max) for the active tab.
 * @param {string} w — "editor" or "preview".
 * @returns {Promise<number>} the 0..1 scroll ratio.
 */
const ratio = (w) => p.evaluate((k) => {
  const d = window.editor.activeTab;
  const sc = k === "editor" ? d.editorScroll : d.previewScroll;
  const max = sc.scrollHeight - sc.clientHeight;
  return max > 0 ? sc.scrollTop / max : 0;
}, w);

/** curMode — the current view-mode value from the app dataset. */
const curMode = () => p.evaluate(() => window.editor.workspace.closest(".app").dataset.mode);

/**
 * setModeTo — click the mode button until the view is on `target` (up to 3 tries).
 * @param {string} target — the desired `data-mode` value.
 */
const setModeTo = async (target) => {
  for (let i = 0; i < 3; i++) {
    if (await curMode() === target) break;
    await p.click('[data-action="mode"]');
    await sleep(350);
  }
};

/**
 * setCaret — place the caret at a position (and focus the textarea).
 * @param {string|number} f — "end", or a 0..1 fraction of the text length.
 */
const setCaret = (f) => p.evaluate((k) => {
  const d = window.editor.activeTab;
  const n = d.input.value.length;
  const pos = k === "end" ? n : Math.floor(n * k);
  d.input.focus(); d.input.setSelectionRange(pos, pos);
}, f);

/**
 * scrollEditor — scroll the editor pane to `f` of its max.
 * @param {number} f — the 0..1 scroll fraction.
 */
const scrollEditor = (f) => p.evaluate((k) => {
  const d = window.editor.activeTab; const sc = d.editorScroll;
  sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * k;
}, f);

/**
 * scrollPreview — scroll the preview pane to `f` of its max.
 * @param {number} f — the 0..1 scroll fraction.
 */
const scrollPreview = (f) => p.evaluate((k) => {
  const d = window.editor.activeTab; const sc = d.previewScroll;
  sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * k;
}, f);

await p.evaluate(() => {
  const para = "Paragraph " + "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(4) + "\n\n";
  window.editor.setDocumentText(Array.from({ length: 30 }, (_, i) => "## Section " + (i + 1) + "\n" + para).join("\n"));
});
await sleep(400);

// 1. SPLIT (top) + caret-end -> EDIT does NOT snap to bottom.
await setModeTo("split");
await p.evaluate(() => { const d = window.editor.activeTab; d.editorScroll.scrollTop = 0; d.previewScroll.scrollTop = 0; });
await sleep(200);
await setCaret("end");
await setModeTo("edit");
ok("split(top)+caret-end -> EDIT stays near top", await ratio("editor"), 0, 0.1);

// 2. Top state survives further cycles EDIT -> PREVIEW -> SPLIT.
await setModeTo("preview");
ok("EDIT -> PREVIEW still near top", await ratio("preview"), 0, 0.1);
await setModeTo("split");
ok("... -> SPLIT both panes near top", await ratio("editor"), 0, 0.1);

// 3. SPLIT at 55% -> EDIT keeps ~55%.
await setModeTo("split");
await scrollEditor(0.55);
await sleep(250);
const r3 = await ratio("editor");
await setModeTo("edit");
ok("split(55%) -> EDIT keeps ~55%", await ratio("editor"), r3, 0.1);

// 4. SPLIT at 50%, caret mid-doc, -> EDIT stays mid.
await setModeTo("split");
await scrollEditor(0.5);
await sleep(200);
await setCaret(0.5);
await setModeTo("edit");
ok("split(50%)+caret-mid -> EDIT stays ~50%", await ratio("editor"), 0.5, 0.12);

// 5. PREVIEW at 30% -> SPLIT keeps ~30% on preview.
await setModeTo("preview");
await scrollPreview(0.3);
await sleep(250);
const r5 = await ratio("preview");
await setModeTo("split");
ok("preview(30%) -> SPLIT keeps ~30% on preview", await ratio("preview"), r5, 0.12);

// 6. Fast triple-switch race: no stale apply() from an earlier click overwrites
// the latest one. split -> edit -> preview -> split, no delays, should end at 25%.
await setModeTo("split");
await scrollEditor(0.25);
await sleep(200);
await setCaret("end");
await p.click('[data-action="mode"]');
await p.click('[data-action="mode"]');
await p.click('[data-action="mode"]');
await sleep(400);
eq("back at split after 3 fast clicks", await curMode(), "split");
ok("fast triple switch keeps ~25% on editor (no stale overwrite)", await ratio("editor"), 0.25, 0.15);

await b.close();
console.log(`\n${pass + fail} cases: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
