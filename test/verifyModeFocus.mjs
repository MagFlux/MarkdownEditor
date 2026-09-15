/**
 * verifyModeFocus.mjs — mode-click focus regression (Playwright, Chromium).
 *
 * Asserts the mode button causatively focuses the editor textarea for every
 * target EXCEPT preview (where focusing the hidden zero-width textarea fires
 * WebKitGTK's eager scroll-into-view and ratchets the preview pane to the
 * bottom), and IS focused for split/edit. Blurs before each click so it
 * measures causative focus. Run with `npm run verify-modefocus`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

// Regression: clicking the View-mode button SPLIT→EDIT→PREVIEW→SPLIT must
// never move the VISIBLE pane off its current scroll position.
//
// The one transition that must ALSO not leave focus on the editor textarea is
// the one that HIDES it: edit→preview. In preview the editor pane is 0-width
// (style.css .mode-preview .pane-editor{flex:0;width:0}), so the handler's
// trailing activeTab.input.focus() fires WebKitGTK's EAGER scroll-into-view on
// that zero-width textarea; realScroll→kickScrollSync→followScroll then
// ratchets that phantom offset onto the PREVIEW pane — the user sees "edit
// stays at top but preview jumps to the bottom". Only preview hides the editor,
// so the guard is scoped to entering preview: the `mode` action does
// `if (next === "preview") return;` (split/edit targets keep the normal
// trailing focus — the textarea is visible there and caret-follow is expected).
//
// verify-modescroll is the companion: it asserts the RATIO is preserved for
// every transition. Both are green simultaneously only when the focus-skip is
// exactly preview-targeted (a blanket `return` breaks verify-modescroll's
// caret-mid cases; no `return` at all leaves the user's preview-jump bug live).
//
// This test scrolls the panes to the top and mid-doc, and after the edit→
// preview transition asserts the textarea is NOT focused (the real guard). For
// the other transitions it only asserts the scroll RATIO held — because there
// the textarea is visible and may legitimately hold focus. The edit→preview
// focus assertion is reproducible in headless Chromium even though Chromium
// does not fire the eager scroll-into-view that WebKitGTK does.
const S = 500; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync(`kill $(lsof -ti tcp:4610) 2>/dev/null || true`, { stdio: "ignore" }); } catch {}
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4610", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await p.goto("http://localhost:4610/", { waitUntil: "networkidle" });
await sleep(400);

let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (n, c, x) => { if (c) { pass++; console.log("ok  ", n, x ? "→ " + x : ""); } else { fail++; console.log("FAIL", n, x ? "→ " + x : ""); } };

// Tall doc so both panes are genuinely scrollable; caret at the END (worst case).
await p.evaluate(() => {
  const ed = window.editor;
  ed.setDocumentText(
    "# Doc\n\n" + Array.from({ length: 120 }, (_, i) =>
      "S" + (i + 1) + ". " + "lorem ipsum dolor sit amet ".repeat(4) + "\n").join("") +
    "\n```mermaid\nflowchart TB\n    A-->B\n```\n"
  );
  const d = ed.activeTab;
  d.input.selectionStart = d.input.value.length;
  d.input.selectionEnd = d.input.value.length;
});
await sleep(S);

/**
 * snap — capture mode, both panes' scroll ratios, and the focus state.
 * @returns {Promise<{mode: string, edit: number, preview: number, focusIsTextarea: boolean, focusTag: string}>}
 */
const snap = () => p.evaluate(() => {
  const d = window.editor.activeTab;
  const e = d.editorScroll, pv = d.previewScroll;
  /** r — a pane's 0..1 scroll ratio. */
  const r = (el) => { const m = el.scrollHeight - el.clientHeight; return m > 0 ? +(el.scrollTop / m).toFixed(4) : 0; };
  const ae = document.activeElement;
  return {
    mode: document.querySelector(".mode-label").textContent,
    edit: r(e), preview: r(pv),
    focusIsTextarea: ae === d.input || (ae && ae.tagName === "TEXTAREA"),
    focusTag: ae ? ae.tagName : "null",
  };
});

// Force to the TOP in split view, caret at end.
await p.evaluate(() => {
  const d = window.editor.activeTab;
  d.editorScroll.scrollTop = 0; d.previewScroll.scrollTop = 0;
  d.input.selectionStart = d.input.value.length; d.input.selectionEnd = d.input.value.length;
});
await sleep(S);

/**
 * clickMode — click the mode button after first BLURring the active element, so the
 * focus assertions measure CAUSATIVE focus from the click (a plain focus() would
 * otherwise leave an already-focused textarea focused regardless of the branch).
 */
const clickMode = async () => {
  await p.evaluate(() => {
    const ae = document.activeElement;
    if (ae && ae.blur) ae.blur();
  });
  await p.evaluate(() => document.querySelector('[data-action="mode"]').click());
  await sleep(S);
};

// ---------------------------------------------------------------------------
// CASE 1 — split → edit (the case the user says "works")
// ---------------------------------------------------------------------------
await clickMode();
let s = await snap();
ok("1a split→edit: mode is Edit", s.mode === "Edit", JSON.stringify(s));
ok("1b split→edit: editor stays at top", s.edit < 0.02, "edit=" + s.edit);
ok("1c split→edit: textarea focused (legitimate — editor visible)", s.focusIsTextarea, "focus=" + s.focusTag);

// ---------------------------------------------------------------------------
// CASE 2 — edit → preview (the case the user says "jumps to BOTTOM")
// ---------------------------------------------------------------------------
await clickMode();
s = await snap();
ok("2a edit→preview: mode is Preview", s.mode === "Preview", JSON.stringify(s));
ok("2b edit→preview: preview stays at top (the reported bug)", s.preview < 0.02,
   "preview=" + s.preview + (s.preview > 0.9 ? " — JUMPED TO BOTTOM" : ""));
ok("2c edit→preview: textarea not focused after click", !s.focusIsTextarea, "focus=" + s.focusTag);

// ---------------------------------------------------------------------------
// CASE 3 — preview → split (user says "back at top" — OK)
// ---------------------------------------------------------------------------
await clickMode();
s = await snap();
ok("3a preview→split: mode is Split", s.mode === "Split", JSON.stringify(s));
ok("3b preview→split: both panes back at top", s.edit < 0.02 && s.preview < 0.02,
    "edit=" + s.edit + " preview=" + s.preview);
ok("3c preview→split: textarea focused (legitimate — editor visible)", s.focusIsTextarea, "focus=" + s.focusTag);

// ---------------------------------------------------------------------------
// CASE 4 — mid-doc round trip (both panes must hold ~35%)
// ---------------------------------------------------------------------------
// Get back to split.
if (s.mode !== "Split") { await clickMode(); }  // preview→split
await sleep(S);

await p.evaluate(() => {
  const d = window.editor.activeTab;
  /** set — scroll a pane to 35% of its max. */
  const set = (el) => { const m = el.scrollHeight - el.clientHeight; if (m > 0) el.scrollTop = m * 0.35; };
  set(d.editorScroll); set(d.previewScroll);
});
await sleep(S);
s = await snap();
ok("4a mid-doc split ~35% (setup)", s.mode === "Split" && Math.abs(s.edit - 0.35) < 0.06 && Math.abs(s.preview - 0.35) < 0.06,
   "edit=" + s.edit + " preview=" + s.preview);

await clickMode(); // split→edit
s = await snap();
ok("4b split→edit: editor holds ~35%", s.mode === "Edit" && Math.abs(s.edit - 0.35) < 0.06,
   "edit=" + s.edit + " preview(hidden)=" + s.preview);

await clickMode(); // edit→preview
s = await snap();
ok("4c edit→preview: preview holds ~35% (not bottom)", s.mode === "Preview" && Math.abs(s.preview - 0.35) < 0.08,
   "preview=" + s.preview + (s.preview > 0.9 ? " — JUMPED TO BOTTOM" : ""));

await clickMode(); // preview→split
s = await snap();
ok("4d preview→split: both panes back to ~35%", s.mode === "Split" && Math.abs(s.edit - 0.35) < 0.08 && Math.abs(s.preview - 0.35) < 0.08,
   "edit=" + s.edit + " preview=" + s.preview);

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
console.log(`\n${pass} ok / ${fail} fail`);
await b.close();
try { process.kill(-srv.pid); } catch {}
if (errors.length) fail = 1;
process.exit(fail ? 1 : 0);
