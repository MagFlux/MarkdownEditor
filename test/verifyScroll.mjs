/**
 * verifyScroll.mjs — split-view scroll-sync regression.
 *
 * A genuine user scroll on the FOLLOW pane (while its ECHO_MS deadline is still
 * live) must be accepted as a fresh lead immediately — the old time-only window
 * swallowed it for ~800 ms ("left side lags / catches up"). Value-based echo
 * matching (ECHO_EPS offset compare) fixes this. Run with `npm run verify-scroll`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

// Self-contained: build, then serve on an isolated port (idempotent).
const S = 400; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync(`kill $(lsof -ti tcp:4599) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4599", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push("CONSOLE: " + m.text()); });

let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (n, c, extra) => { if (c) { pass++; console.log("ok  ", n, extra ? "→ " + extra : ""); } else { fail++; console.log("FAIL", n, extra ? "→ " + extra : ""); } };

await p.goto("http://localhost:4599/", { waitUntil: "networkidle" });
await sleep(400);

// Build a tall doc so both panes are genuinely scrollable (and have different
// scrollHeights: raw prose vs. rendered headings → the ratio sync matters).
await p.evaluate(() => {
  const ed = window.editor;
  const para = "Paragraph " + "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(4) + "\n\n";
  ed.setDocumentText(Array.from({ length: 30 }, (_, i) => "## Section " + (i + 1) + "\n" + para).join("\n"));
});
await sleep(S);

/**
 * panes — read both panes' `{ st, max }` where max = scrollHeight − clientHeight.
 * @returns {Promise<{e: {st: number, max: number}, p: {st: number, max: number}}>}
 */
const panes = () => p.evaluate(() => {
  const d = window.editor.activeTab;
  /** m — a pane's {st, max} pair. */
  const m = (el) => ({ st: Math.round(el.scrollTop), max: Math.round(el.scrollHeight - el.clientHeight) });
  return { e: m(d.editorScroll), p: m(d.previewScroll) };
});

/**
 * scrollFrac — set a pane's scrollTop to a fraction of its max (fires a real scroll).
 * @param {string} which — "e" (editor) or "p" (preview).
 * @param {number} f — the 0..1 scroll fraction to reach.
 * @returns {Promise<number>} the resulting scrollTop.
 */
const scrollFrac = (which, f) => p.evaluate((o) => {
  const { w, f2 } = o;
  const d = window.editor.activeTab;
  const el = w === "e" ? d.editorScroll : d.previewScroll;
  const v = Math.round((el.scrollHeight - el.clientHeight) * f2);
  el.scrollTop = v;
  return el.scrollTop;
}, { w: which, f2: f });
/**
 * waitAt — wait up to `budget` ms for a pane to reach `target` ± `tol`.
 * @param {string} which — "e" (editor) or "p" (preview).
 * @param {number} target — the scrollTop to wait for.
 * @param {number} tol — the ± tolerance in px.
 * @param {number} budget — max wait in ms.
 * @returns {Promise<{ms: number, at: number, reached: boolean}>} elapsed, landed offset, and hit.
 */
const waitAt = (which, target, tol, budget) => p.evaluate(async (o) => {
  const { w, t, tol2, budget2 } = o;
  const d = window.editor.activeTab;
  const el = w === "e" ? d.editorScroll : d.previewScroll;
  const t0 = performance.now();
  while (performance.now() - t0 < budget2) {
    if (Math.abs(el.scrollTop - t) <= tol2) return { ms: performance.now() - t0, at: Math.round(el.scrollTop), reached: true };
    await new Promise((r) => setTimeout(r, 10));
  }
  return { ms: performance.now() - t0, at: Math.round(el.scrollTop), reached: false };
}, { w: which, t: target, tol2: tol, budget2: budget });

// ---------------------------------------------------------------------------
// CASE A — scroll the LEFT (editor). The preview is driven. Then, WHILE the
// preview is still inside the ECHO_MS window, scroll the preview to a DISTINCT
// offset. A real scroll must be accepted as a fresh lead (the editor follows
// immediately); under the old time-window suppression it was swallowed and the
// editor "caught up" ~800 ms later.
// ---------------------------------------------------------------------------
await sleep(300);
const a0 = await panes();
await scrollFrac("e", 0.50);   // editor leads; preview is driven (echo stamped)
await sleep(120);
const aPFrac = 0.85;
const aPTarget = Math.round((a0.p.max) * aPFrac);
await scrollFrac("p", aPFrac); // real scroll on the FOLLOW pane inside echo window
const aRes = await waitAt("e", (aPTarget / a0.p.max) * a0.e.max, 8, 2500);
ok("A0 panes are scrollable and different heights", a0.e.max > 200 && a0.p.max > 200 && a0.e.max !== a0.p.max, JSON.stringify({ e: a0.e, p: a0.p }));
ok("A1 a real scroll on the preview (inside echo window) is accepted", aRes.reached, JSON.stringify(aRes));
ok("A2 editor follows to the ratio-matched offset (preview→0.85)", aRes.reached && Math.abs(aRes.at - (aPTarget / a0.p.max) * a0.e.max) <= 8,
   "editor at " + aRes.at + " target " + ((aPTarget / a0.p.max) * a0.e.max).toFixed(1));

// ---------------------------------------------------------------------------
// CASE B — mirror: scroll the RIGHT (preview). The editor is driven. Then,
// WHILE the editor is inside the ECHO_MS window, scroll the editor to a
// DISTINCT offset. It must be accepted as a fresh lead (preview follows now);
// the old code would have swallowed this scroll for up to ECHO_MS.
// ---------------------------------------------------------------------------
await sleep(300);
const b0 = await panes();
await scrollFrac("p", 0.35);   // preview leads; editor is driven (echo stamped)
await sleep(120);
const bEFrac = 0.72;
const bETarget = Math.round(b0.e.max * bEFrac);
await scrollFrac("e", bEFrac); // real scroll on the FOLLOW pane inside echo window
const bRes = await waitAt("p", (bETarget / b0.e.max) * b0.p.max, 8, 2500);
ok("B1 a real scroll on the editor (inside echo window) is accepted", bRes.reached, JSON.stringify(bRes));
ok("B2 preview follows to the ratio-matched offset (editor→0.72)", bRes.reached && Math.abs(bRes.at - (bETarget / b0.e.max) * b0.p.max) <= 8,
   "preview at " + bRes.at + " target " + ((bETarget / b0.e.max) * b0.p.max).toFixed(1));

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
console.log(`\n${pass} ok / ${fail} fail`);
await b.close();
process.exit(fail ? 1 : 0);
