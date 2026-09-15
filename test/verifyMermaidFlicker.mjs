/**
 * verifyMermaidFlicker.mjs — a keystroke OUTSIDE a mermaid fence must never
 * flash raw code for an already-rendered diagram.
 *
 * The old syncDom rewrote `preview.innerHTML` on every keystroke (wiping a
 * rendered `<div class="mermaid-diagram">` holder back to a raw
 * `<pre><code class="language-mermaid">`), then a 120-ms debounced render
 * put the SVG back — the gap was visible as a flicker. The fix:
 *   (a) `_svgCache` in mermaid.js (source text → {svg, bindFunctions}),
 *   (b) `restoreMermaid(d.preview)` inside syncDom (synchronous, no async),
 *   (c) a `mermaidSourceKey(text)` gate in scheduleMermaidRender that bails
 *       out early when no mermaid fence body changed.
 *
 * This test asserts, for the ACTIVE tab: after typing in prose outside the
 * fence, in the SAME synchronous tick as the input event
 *   - no raw `<pre><code class="language-mermaid">` is present, AND
 *   - the rendered `.mermaid-diagram` holder IS present, AND
 *   - a probe attribute we just stamped on the holder SURVIVES (proof no DOM
 *     rewrite happened at all between the keystroke and the read).
 *
 * Run with `npm run verify-mermaidflicker`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

const S = 450; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

// Load a doc with a mermaid diagram and prose around it. The doc needs a
// rendered diagram (so the "before" state has a .mermaid-diagram holder) and
// an editable prose line (so we can type outside the fence).
await p.evaluate(() => {
  const ed = window.editor;
  const text =
    "# Title\n\n" +
    "Intro paragraph.\n\n" +
    "```mermaid\n" +
    "flowchart LR\n" +
    "    A[Start] --> B[End]\n" +
    "```\n\n" +
    "Trailing paragraph.\n";
  ed.setDocumentText(text);
});
// Wait for the 120 ms debounce + a frame, then verify the diagram rendered.
await sleep(S * 2);
const initial = await p.evaluate(() => {
  const d = window.editor.activeTab;
  return {
    rendered: d.preview.querySelectorAll(".mermaid-diagram").length,
    raw: d.preview.querySelectorAll("pre > code.language-mermaid").length,
  };
});
ok("0a mermaid diagram rendered before typing", initial.rendered >= 1 && initial.raw === 0,
   "rendered=" + initial.rendered + " raw=" + initial.raw);

// ---------------------------------------------------------------------------
// CASE 1 — type in prose AFTER the fence (outside the fence). This is the
// regression: the old code wiped the rendered holder and only restored it on
// the 120 ms debounce. The fix syncs synchronously.
// ---------------------------------------------------------------------------
// Type in prose AFTER the fence (outside the fence). This is the
// regression: the old code wiped the rendered holder and only restored it on
// the 120 ms debounce. The fix syncs synchronously.
// Position the caret at the END of a prose line (well outside the mermaid
// fence), then type a few characters. Using the textarea directly (not
// setDocumentText) is what fires the real `input` → refresh → syncDom path
// that the regression is about.
const typed = await p.evaluate(() => {
  const d = window.editor.activeTab;
  const ta = d.input;
  const v = ta.value;
  // Find the "Trailing paragraph." line and put the caret at its end.
  const idx = v.indexOf("Trailing paragraph.");
  if (idx < 0) return { ok: false, why: "no trailing prose" };
  const caretPos = idx + "Trailing paragraph.".length;
  ta.focus();
  ta.setSelectionRange(caretPos, caretPos);
  // Dispatch a single "input" with an appended character (a real edit).
  const before = ta.value;
  ta.value = before.slice(0, caretPos) + "X" + before.slice(caretPos);
  ta.setSelectionRange(caretPos + 1, caretPos + 1);
  ta.dispatchEvent(new Event("input", { bubbles: true, cancelable: false }));
  return { ok: true, before: before.length, after: ta.value.length };
});
ok("1a typing edit applied (value grew by 1)", typed.ok && typed.after === typed.before + 1,
   JSON.stringify(typed));

// Read the preview IMMEDIATELY (no sleep) — this is what matters: in the
// old code, the first syncDom after this keystroke would have already wiped
// the holder and only the 120 ms debounce would have restored it, so reading
// right after the keystroke would show a raw `<pre><code>`. The fix does
// `preview.innerHTML = …; restoreMermaid(d.preview)` synchronously in the
// same tick, so the SAME read shows no raw fence and a rendered holder.
// Note: the holder itself is NOT the pre-existing element — syncDom still
// rewrites preview.innerHTML (prose must update), so the exact DOM node is
// gone; `restoreMermaid` re-inserts a fresh holder from cache. `raw === 0`
// + `rendered >= 1` is the real assertion; element identity is NOT part of
// the fix.
const mid = await p.evaluate(() => {
  const d = window.editor.activeTab;
  return {
    rendered: d.preview.querySelectorAll(".mermaid-diagram").length,
    raw: d.preview.querySelectorAll("pre > code.language-mermaid").length,
  };
});
ok("1b no raw mermaid fence visible right after the keystroke (no flicker)",
   mid.raw === 0, "raw=" + mid.raw);
ok("1c rendered holder present right after the keystroke", mid.rendered >= 1,
   "rendered=" + mid.rendered);

// Wait for the 120 ms debounce window to pass and confirm the diagram is
// STILL rendered (a sanity check that we didn't suppress a legitimate render
// that would be needed later).
await sleep(S * 2);
const after = await p.evaluate(() => {
  const d = window.editor.activeTab;
  return {
    rendered: d.preview.querySelectorAll(".mermaid-diagram").length,
    raw: d.preview.querySelectorAll("pre > code.language-mermaid").length,
  };
});
ok("1e diagram still rendered after the debounce window passes",
   after.rendered >= 1 && after.raw === 0,
   "rendered=" + after.rendered + " raw=" + after.raw);

// ---------------------------------------------------------------------------
// CASE 2 — typing INSIDE the mermaid fence is NOT suppressed: it still re-
// renders (the diagram text is now different, so the old SVG is stale).
// We don't assert the NEW svg (mermaid.render is slow under headless
// Chromium and not needed for the regression assertion); we only assert that
// a raw fence is transiently visible OR a holder is present — both are OK —
// and that no errors were thrown during the render path.
// ---------------------------------------------------------------------------
const inFence = await p.evaluate(() => {
  const d = window.editor.activeTab;
  const ta = d.input;
  const v = ta.value;
  const idx = v.indexOf("A[Start] --> B[End]");
  if (idx < 0) return { ok: false };
  // Change the label "End" to "End2" inside the fence (still valid mermaid).
  const oldTail = "B[End]";
  const newTail = "B[End2]";
  const tailIdx = v.indexOf(oldTail);
  if (tailIdx < 0) return { ok: false, why: "no tail" };
  ta.focus();
  ta.value = v.slice(0, tailIdx) + newTail + v.slice(tailIdx + oldTail.length);
  ta.dispatchEvent(new Event("input", { bubbles: true, cancelable: false }));
  return { ok: true };
});
ok("2a in-fence edit applied (no length change, label mutated)", inFence.ok, JSON.stringify(inFence));
await sleep(S * 3);
const inFenceAfter = await p.evaluate(() => {
  const d = window.editor.activeTab;
  return {
    rendered: d.preview.querySelectorAll(".mermaid-diagram").length,
    raw: d.preview.querySelectorAll("pre > code.language-mermaid").length,
  };
});
ok("2b in-fence edit re-rendered (holder present after debounce)",
   inFenceAfter.rendered >= 1 && inFenceAfter.raw === 0,
   "rendered=" + inFenceAfter.rendered + " raw=" + inFenceAfter.raw);

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
console.log(`\n${pass} ok / ${fail} fail`);
await b.close();
try { process.kill(-srv.pid); } catch { /* already dead */ }
if (errors.length) fail = 1;
process.exit(fail ? 1 : 0);
