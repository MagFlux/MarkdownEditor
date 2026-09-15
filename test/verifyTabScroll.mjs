/**
 * verifyTabScroll.mjs — cross-tab scroll persistence.
 *
 * A tab's editor + preview scroll positions must survive a switch away and
 * back. Previously .pane-group{display:none} reset a hidden tab's scrollTop to 0
 * (a tab at 50% read top on return). activate() captures the leaving tab's
 * ratios while laid out and re-asserts the entering tab's after two rAF ticks.
 * Run with `npm run verify-tabscroll`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

// Regression: a tab's vertical scroll position must PERSIST across a switch
// away and back. The old activate() hid the leaving tab via
// .pane-group{display:none} (style.css) and re-showed the entering tab, and the
// browser resets a display:none→shown scroll container's scrollTop to 0 — so a
// tab scrolled to 50% read 0 (top) on return. activate() now captures the
// leaving tab's editor/preview scroll RATIOS while it's still laid out and
// re-asserts the entering tab's remembered ratios after two rAF ticks (mirrors
// setMode/openAtTop), stamping the value-based echo guard so the restore can't
// be misread as a user scroll or kick the split-view follow scroll.
//
// Self-contained: build, then serve on an isolated port (idempotent).
const S = 500; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync(`kill $(lsof -ti tcp:4606) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4606", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push("CONSOLE: " + m.text()); });

let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (n, c, extra) => { if (c) { pass++; console.log("ok  ", n, extra ? "→ " + extra : ""); } else { fail++; console.log("FAIL", n, extra ? "→ " + extra : ""); } };

await p.goto("http://localhost:4606/", { waitUntil: "networkidle" });
await sleep(400);

const TALL = "# Doc\n\n" + Array.from({ length: 150 }, (_, i) =>
  "Section " + (i + 1) + ": " + "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ".repeat(3) + "\n").join("") +
  "\n```mermaid\nflowchart LR\n    A --> B --> C\n```\n";

// Two tall tabs, each with a rendered (tall) mermaid diagram so the preview is
// genuinely scrollable and both panes have different heights.
await p.evaluate((txt) => {
  const ed = window.editor;
  ed.newTab("Alpha", txt);
  ed.newTab("Beta", txt);
}, TALL);
await sleep(S);

/**
 * ratio — a pane's scroll ratio (scrollTop / max) for the active tab.
 * @param {string} which — "e" (editor) or "p" (preview).
 * @returns {Promise<number>} the 0..1 scroll ratio.
 */
const ratio = (which) => p.evaluate((w) => {
  const d = window.editor.activeTab;
  const el = w === "e" ? d.editorScroll : d.previewScroll;
  const max = el.scrollHeight - el.clientHeight;
  return max > 0 ? el.scrollTop / max : 0;
}, which);

/**
 * scrollBoth — scroll both panes of the active tab to `f` of their max.
 * @param {number} f — the 0..1 scroll fraction to reach.
 */
const scrollBoth = (f) => p.evaluate((f2) => {
  const d = window.editor.activeTab;
  for (const el of [d.editorScroll, d.previewScroll]) {
    const max = el.scrollHeight - el.clientHeight;
    if (max > 0) el.scrollTop = Math.round(max * f2);
  }
}, f);

/**
 * tab — a playwright locator for a tab's name chip.
 * @param {string} name — the tab name to match.
 * @returns {import('playwright-chromium').Locator}
 */
const tab = (name) => p.locator(`.tab .tname`, { hasText: name });

// Both panes must be genuinely scrollable for the ratios to mean anything.
// (Measure the ACTIVE tab — a hidden tab reports scrollHeight 0 while display:none.)
const aMax = await p.evaluate(() => {
  const d = window.editor.activeTab;
  /** m — a pane's scrollable max. */
  const m = (el) => el.scrollHeight - el.clientHeight;
  return { name: d.name, e: m(d.editorScroll), p: m(d.previewScroll) };
});
ok("tall tabs are scrollable in both panes", aMax.e > 300 && aMax.p > 300, JSON.stringify(aMax));

// ---------------------------------------------------------------------------
// CASE 1 — Alpha @50% → Beta → back to Alpha stays @~50% (both panes).
// ---------------------------------------------------------------------------
await tab("Alpha").click(); await sleep(S);
await scrollBoth(0.50); await sleep(S);
const aE0 = await ratio("e"), aP0 = await ratio("p");
ok("1a Alpha scrolled to ~50% on both panes", aE0 > 0.4 && aE0 < 0.6 && aP0 > 0.4 && aP0 < 0.6, "e=" + aE0.toFixed(3) + " p=" + aP0.toFixed(3));

await tab("Beta").click(); await sleep(S);            // away (Alpha hidden → display:none)
await tab("Alpha").click(); await sleep(S);           // back
const aE1 = await ratio("e"), aP1 = await ratio("p");
ok("1b editor restored to remembered ~50% on return", Math.abs(aE1 - aE0) <= 0.05, "was " + aE0.toFixed(3) + " now " + aE1.toFixed(3));
ok("1c preview restored to remembered ~50% on return", Math.abs(aP1 - aP0) <= 0.05, "was " + aP0.toFixed(3) + " now " + aP1.toFixed(3));

// ---------------------------------------------------------------------------
// CASE 2 — per-tab independence: Beta gets a DIFFERENT ratio and survives its
// own round trip without clobbering Alpha (and vice-versa).
// ---------------------------------------------------------------------------
await tab("Beta").click(); await sleep(S);
await scrollBoth(0.25); await sleep(S);
const bE0 = await ratio("e"), bP0 = await ratio("p");
ok("2a Beta scrolled to ~25% on both panes", bE0 > 0.15 && bE0 < 0.35 && bP0 > 0.15 && bP0 < 0.35, "e=" + bE0.toFixed(3) + " p=" + bP0.toFixed(3));

await tab("Alpha").click(); await sleep(S);           // away from Beta
await tab("Beta").click(); await sleep(S);            // back → must hold ~25%
const bE1 = await ratio("e"), bP1 = await ratio("p");
ok("2b Beta holds ~25% after a round trip (not clobbered by Alpha)", Math.abs(bE1 - bE0) <= 0.05 && Math.abs(bP1 - bP0) <= 0.05,
   "e was " + bE0.toFixed(3) + "→" + bE1.toFixed(3) + " p was " + bP0.toFixed(3) + "→" + bP1.toFixed(3));

await tab("Alpha").click(); await sleep(S);           // back to Alpha: still ~50%
const aE2 = await ratio("e"), aP2 = await ratio("p");
ok("2c Alpha still holds ~50% after Beta's trip (no cross-tab clobber)", Math.abs(aE2 - aE0) <= 0.05 && Math.abs(aP2 - aP0) <= 0.05,
   "e was " + aE0.toFixed(3) + "→" + aE2.toFixed(3) + " p was " + aP0.toFixed(3) + "→" + aP2.toFixed(3));

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
console.log(`\n${pass} ok / ${fail} fail`);
await b.close();
try { process.kill(-srv.pid); } catch { /* already dead */ }
if (errors.length) fail = 1;
process.exit(fail ? 1 : 0);
