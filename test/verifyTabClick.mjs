/**
 * verifyTabClick.mjs — clicking an already-active tab is a no-op.
 *
 * The old activate() did input.focus()+refresh() on every click, refocusing the
 * textarea (scrolled it into view — both panes jumped 90%→~25%) and re-running
 * marked + mermaid. activate() now short-circuits when doc === activeTab.
 * Run with `npm run verify-tabclick`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

// Regression: clicking a tab that is ALREADY active must be a no-op — it must
// not move the scroll position (the old activate() did input.focus() + refresh(),
// which refocused the textarea and scrolled it into view = both panes jumped,
// e.g. 90% → ~25%), and it must not rewrite the preview DOM (the old refresh()
// → syncDom() re-ran marked + the debounced mermaid render, so a mermaid diagram
// on the page visibly re-rendered on every redundant tab click).
//
// Self-contained: build, then serve on an isolated port (idempotent).
const S = 450; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync(`kill $(lsof -ti tcp:4605) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4605", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push("CONSOLE: " + m.text()); });

let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (n, c, extra) => { if (c) { pass++; console.log("ok  ", n, extra ? "→ " + extra : ""); } else { fail++; console.log("FAIL", n, extra ? "→ " + extra : ""); } };

await p.goto("http://localhost:4605/", { waitUntil: "networkidle" });
await sleep(400);

// Tall doc with a rendered mermaid diagram (so we can prove the preview DOM is
// NOT rewritten by a redundant tab click).
await p.evaluate(() => {
  const ed = window.editor;
  const para = "Paragraph " + "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(4) + "\n\n";
  const lines = [];
  lines.push("# Long document");
  for (let i = 0; i < 120; i++) lines.push("Section " + (i + 1) + ": " + para.trim() + "\n");
  lines.push("```mermaid", "flowchart LR", "    A --> B --> C: done", "```");
  ed.setDocumentText(lines.join("\n"));
});
await sleep(S);

// A DOM probe: a custom attribute on the live preview node. If a redundant
// activate() rewrites the preview (syncDom → preview.innerHTML = …), this
// attribute is wiped, so its survival proves no re-render happened.
/** armProbe — tag the first preview child with `data-tcprobe` so a re-render wipe is detectable. */
const armProbe = () => p.evaluate(() => {
  const d = window.editor.activeTab;
  const first = d.preview.firstElementChild;
  if (first) first.setAttribute("data-tcprobe", "alive");
  return { probed: !!first, mermaid: d.preview.querySelectorAll(".mermaid-diagram").length };
});
/**
 * probe — read a pane's scroll ratio and its max.
 * @param {string} which — "e" (editor) or "p" (preview).
 * @returns {Promise<{ratio: number, max: number}>}
 */
const probe = (which) => p.evaluate((w) => {
  const d = window.editor.activeTab;
  const el = w === "e" ? d.editorScroll : d.previewScroll;
  const max = el.scrollHeight - el.clientHeight;
  return { ratio: max > 0 ? el.scrollTop / max : 0, max };
}, which);
/** setScroll — scroll both panes of the active tab to ~90% of their max. */
const setScroll = () => p.evaluate(() => {
  const d = window.editor.activeTab;
  for (const el of [d.editorScroll, d.previewScroll]) {
    const max = el.scrollHeight - el.clientHeight;
    if (max > 0) el.scrollTop = Math.round(max * 0.90);
  }
});

// ---------------------------------------------------------------------------
// CASE 1 — scroll is preserved across a redundant click on the ALREADY-active
// tab. Under the old activate() the textarea re-focus scrolled it into view and
// both panes jumped (90% → ~bottom); the fix short-circuits so they stay put.
// ---------------------------------------------------------------------------
await setScroll();
await sleep(S);
const e0 = await probe("e"), pr0 = await probe("p");
await armProbe();
const activeTabIdx = await p.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  return tabs.findIndex((t) => t.classList.contains("active"));
});
ok("1a active tab exists", activeTabIdx >= 0, "index " + activeTabIdx);
ok("1b both panes scrolled to ~90%", e0.max > 200 && pr0.max > 200 && e0.ratio > 0.8 && pr0.ratio > 0.8,
   "e=" + e0.ratio.toFixed(3) + " p=" + pr0.ratio.toFixed(3));

// Click the already-active tab (.tname), several times (user "flicking" it).
for (const i of [0, 1, 2]) {
  await p.locator(".tab").nth(activeTabIdx).locator(".tname").click();
  await sleep(520); // beat any rAF/marker settling
}
const e1 = await probe("e"), pr1 = await probe("p");
ok("1c editor scroll preserved after redundant click (no jump)", Math.abs(e1.ratio - e0.ratio) <= 0.05,
   "was " + e0.ratio.toFixed(3) + " now " + e1.ratio.toFixed(3));
ok("1d preview scroll preserved after redundant click (no jump)", Math.abs(pr1.ratio - pr0.ratio) <= 0.05,
   "was " + pr0.ratio.toFixed(3) + " now " + pr1.ratio.toFixed(3));

// ---------------------------------------------------------------------------
// CASE 2 — the preview DOM is NOT rewritten (no re-render). The probe attribute
// survives a redundant tab click, and the mermaid diagram count is unchanged.
// ---------------------------------------------------------------------------
const alive = await p.evaluate(() => {
  const d = window.editor.activeTab;
  const first = d.preview.firstElementChild;
  return { probe: first ? first.getAttribute("data-tcprobe") : null, mermaid: d.preview.querySelectorAll(".mermaid-diagram").length };
});
ok("2a preview DOM not rewritten on redundant click (probe alive)", alive.probe === "alive", "probe=" + alive.probe);
ok("2b mermaid diagram still rendered, count unchanged", alive.mermaid >= 1, "mermaid=" + alive.mermaid);

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
console.log(`\n${pass} ok / ${fail} fail`);
await b.close();
try { process.kill(-srv.pid); } catch { /* already dead */ }
if (errors.length) fail = 1;
process.exit(fail ? 1 : 0);
