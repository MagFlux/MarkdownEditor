/**
 * verifyScroll.mjs — split-view scroll-sync regression.
 *
 * A genuine user scroll on the FOLLOW pane (while its ECHO_MS deadline is
 * still live) must be accepted as a fresh lead immediately — the old
 * time-only window swallowed it for ~800 ms ("left side lags / catches up").
 * Value-based echo matching (ECHO_EPS offset compare) fixes this.
 *
 * Since the block-anchored scroll sync (src/scrollsync.js) replaced the
 * linear-ratio mapping, the follower no longer lands at the ratio-matched
 * offset — it lands at the CONTENT-matched position (the preview block
 * containing the lead's source line). So the follow assertions here check
 * BLOCK PARITY (the same block visible at both panes' top edges, read from
 * the live DOM) rather than a ratio formula. Run with `npm run verify-scroll`.
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
// scrollHeights: raw prose vs. rendered headings → the sync mapping matters).
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
 * parity — measure, from the LIVE DOM, which block is visible at each pane's
 * top edge and report both indices (for the ±1 block-parity assertion).
 *
 * Editor side: the first visible SOURCE line, found by walking the overlay's
 * text nodes with a Range per line (the overlay round-trips the source, so
 * line boxes map 1:1). Preview side: the first element whose box crosses the
 * viewport top, indexed the same way the anchor map pairs elements
 * (children of `.preview`, expanding bare UL/OL lists into their items).
 * @returns {Promise<{edBlock: number, pvBlock: number, topLine: number}>}
 */
const parity = () => p.evaluate(() => {
  const d = window.editor.activeTab;
  // --- editor: first visible line via the overlay's real geometry ---
  const edScroll = d.editorScroll;
  const editorEl = d.editor;
  const starts = [0];
  const md = d.input.value;
  for (let at = md.indexOf("\n"); at !== -1; at = md.indexOf("\n", at + 1)) starts.push(at + 1);
  const segs = [];
  (function walk(node) {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) segs.push({ node: ch, text: ch.data });
      else if (ch.nodeType === 1) walk(ch);
    }
  })(editorEl);
  const cum = []; let tot = 0;
  for (const s of segs) { cum.push({ node: s.node, start: tot, end: tot + s.text.length }); tot += s.text.length; }
  const resolve = (pos) => {
    if (pos <= 0) return { node: cum[0].node, offset: 0 };
    for (const c of cum) if (pos < c.end) return { node: c.node, offset: pos - c.start };
    return { node: cum[cum.length - 1].node, offset: cum[cum.length - 1].node.data.length };
  };
  let topLine = 0;
  // content-y = screenY − wrapperRect.top: the overlay sits at content 0 of
  // the scroll container, so its rect.top is already the screen-y of content
  // origin and moves WITH the content (scroll-independent baseline).
  const baseY = editorEl.getBoundingClientRect().top;
  for (let i = 0; i < starts.length; i++) {
    const a = resolve(starts[i]);
    const endPos = i + 1 < starts.length ? starts[i + 1] : md.length;
    const b2 = resolve(endPos);
    const r = document.createRange();
    r.setStart(a.node, Math.min(a.offset, a.node.data.length));
    r.setEnd(b2.node, Math.min(b2.offset, b2.node.data.length));
    const rects = r.getClientRects();
    if (!rects.length) continue;
    const topC = rects[0].top - baseY;
    if (topC <= edScroll.scrollTop + 2) topLine = i; else break;
  }
  // --- preview: first element crossing the viewport top, indexed like the map ---
  const pv = d.previewScroll;
  const pvBase = pv.getBoundingClientRect().top - pv.scrollTop;
  const kids = Array.from(d.preview.children).flatMap((el) =>
    (el.tagName === "UL" || el.tagName === "OL") && !el.className ? Array.from(el.children) : [el]);
  let pvBlock = 0;
  for (let i = 0; i < kids.length; i++) {
    const r = kids[i].getBoundingClientRect();
    if (r.top - pvBase <= pv.scrollTop + 2) pvBlock = i; else break;
  }
  return { topLine, pvBlock };
});

/**
 * blockOfLine — the index of the map anchor whose source-line span contains
 * `line`, read from the app's debug hook (the map's own block definition).
 * @param {{topLine: number}} par — from parity().
 * @returns {Promise<number>} anchor index, or −1 when the map is unusable.
 */
const edBlockOf = (par) => p.evaluate((tl) => {
  const dbg = window.editor.getActiveScrollSyncDebug();
  if (!dbg || !dbg.ok) return -1;
  let idx = -1;
  dbg.anchors.forEach((a, i) => { if (a.sline <= tl) idx = i; });
  return idx;
}, par.topLine);

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
 * waitStable — wait until a pane's scrollTop stops changing (the follower
 * settled after the lead's write).
 * @param {string} which — "e" (editor) or "p" (preview).
 * @param {number} budget — max wait in ms.
 * @returns {Promise<{ms: number, at: number, moved: boolean, from: number}>}
 */
const waitStable = (which, budget) => p.evaluate(async (o) => {
  const { w, budget2 } = o;
  const d = window.editor.activeTab;
  const el = w === "e" ? d.editorScroll : d.previewScroll;
  const t0 = performance.now();
  let last = el.scrollTop, from = el.scrollTop, stableAt = 0;
  while (performance.now() - t0 < budget2) {
    await new Promise((r) => setTimeout(r, 30));
    if (el.scrollTop !== last) { stableAt = performance.now(); last = el.scrollTop; }
    else if (stableAt && performance.now() - stableAt > 90) break;
  }
  return { at: Math.round(el.scrollTop), from: Math.round(from), moved: Math.abs(el.scrollTop - from) > 2 };
}, { w: which, budget2: budget });

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
await sleep(300);              // let the driven follow settle
const aFrom = (await panes()).e.st;
await sleep(120);
const aPFrac = 0.85;
await scrollFrac("p", aPFrac); // real scroll on the FOLLOW pane inside echo window
const aRes = await waitStable("e", 2500);
const aPar = await parity();
const aEdBlock = await edBlockOf(aPar);
ok("A0 panes are scrollable and different heights", a0.e.max > 200 && a0.p.max > 200 && a0.e.max !== a0.p.max, JSON.stringify({ e: a0.e, p: a0.p }));
ok("A1 a real scroll on the preview (inside echo window) is accepted", Math.abs(aRes.at - aFrom) > 2, JSON.stringify({ ...aRes, from: aFrom }));
ok("A2 editor follows to the CONTENT-matched block (preview→0.85)", aEdBlock >= 0 && Math.abs(aEdBlock - aPar.pvBlock) <= 1,
   "editor block " + aEdBlock + " vs preview block " + aPar.pvBlock + " (top line " + aPar.topLine + ")");

// ---------------------------------------------------------------------------
// CASE B — mirror: scroll the RIGHT (preview). The editor is driven. Then,
// WHILE the editor is inside the ECHO_MS window, scroll the editor to a
// DISTINCT offset. It must be accepted as a fresh lead (preview follows now);
// the old code would have swallowed this scroll for up to ECHO_MS.
// ---------------------------------------------------------------------------
await sleep(300);
const b0 = await panes();
await scrollFrac("p", 0.35);   // preview leads; editor is driven (echo stamped)
await sleep(300);              // let the driven follow settle
const bFrom = (await panes()).p.st;
await sleep(120);
const bEFrac = 0.72;
await scrollFrac("e", bEFrac); // real scroll on the FOLLOW pane inside echo window
const bRes = await waitStable("p", 2500);
const bPar = await parity();
const bEdBlock = await edBlockOf(bPar);
ok("B1 a real scroll on the editor (inside echo window) is accepted", Math.abs(bRes.at - bFrom) > 2, JSON.stringify({ ...bRes, from: bFrom }));
ok("B2 preview follows to the CONTENT-matched block (editor→0.72)", bEdBlock >= 0 && Math.abs(bEdBlock - bPar.pvBlock) <= 1,
   "editor block " + bEdBlock + " vs preview block " + bPar.pvBlock + " (top line " + bPar.topLine + ")");

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
console.log(`\n${pass} ok / ${fail} fail`);
await b.close();
process.exit(fail ? 1 : 0);
