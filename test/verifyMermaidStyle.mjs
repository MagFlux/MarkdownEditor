/**
 * verifyMermaidStyle.mjs — Mermaid diagrams must stay readable even when the
 * SVG-internal stylesheet fails to apply (the Windows WebView2 "black nodes"
 * regression).
 *
 * The fix (src/mermaid.js): installMermaidStyles() mirrors the SVG <style> into
 * a document-level <style>, AND stampSvgStyles() parses Mermaid's own generated
 * CSS with the engine and re-applies it as presentation attributes on the
 * shapes. Presentation attributes lose to author CSS, so where the stylesheet
 * applies (Linux/WebKitGTK) nothing changes; where NO <style> element applies
 * at all, the attributes carry the diagram.
 *
 * This test asserts, for a rendered flowchart + sequence pair:
 *   1. node rects carry stamped fill/stroke matching Mermaid's theme values;
 *   2. sequence messageLine0 carries a real stroke (its inline stroke="none"
 *      placeholder was overwritten);
 *   3. after removing EVERY <style> element in the document (simulating the
 *      WebView2 failure), computed styles still match the theme — i.e. the
 *      diagram is NOT black/invisible;
 *   4. re-stamping the same holder is a no-op (idempotency).
 *
 * Run with `npm run verify-mermaidstyle`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

const S = 450; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync(`kill $(lsof -ti tcp:4607) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4607", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push("CONSOLE: " + m.text()); });

let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (n, c, extra) => { if (c) { pass++; console.log("ok  ", n, extra ? "→ " + extra : ""); } else { fail++; console.log("FAIL", n, extra ? "→ " + extra : ""); } };

await p.goto("http://localhost:4607/", { waitUntil: "networkidle" });
await sleep(400);

await p.evaluate(() => {
  window.editor.setDocumentText(
    "# Style robustness\n\n" +
    "```mermaid\nflowchart LR\n    A[Write Markdown] --> B{Live preview}\n```\n\n" +
    "```mermaid\nsequenceDiagram\n    You->>Editor : press Ctrl+B\n    Editor-->>You : that word is bolded\n```\n"
  );
});
await sleep(S * 3); // debounce + render

// ---------------------------------------------------------------------------
// CASE 1 — the stamping happened: node rect carries mermaid's theme fill.
// ---------------------------------------------------------------------------
const stamped = await p.evaluate(() => {
  const fc = document.querySelectorAll(".mermaid-diagram")[0];
  const rect = fc.querySelector(".node rect.basic");
  return { fill: rect.getAttribute("fill"), stroke: rect.getAttribute("stroke") };
});
ok("1a flowchart node rect has stamped fill", /rgb\(236,\s*236,\s*255\)|#ECECFF/i.test(stamped.fill || ""), JSON.stringify(stamped));
ok("1b flowchart node rect has stamped stroke", /rgb\(147,\s*112,\s*219\)|#9370DB/i.test(stamped.stroke || ""), JSON.stringify(stamped));

// ---------------------------------------------------------------------------
// CASE 2 — the messageLine stroke="none" placeholder was overwritten.
// ---------------------------------------------------------------------------
const msg = await p.evaluate(() => {
  const seq = document.querySelectorAll(".mermaid-diagram")[1];
  const line = seq.querySelector("line.messageLine0");
  const dotted = seq.querySelector("line.messageLine1");
  return { stroke: line.getAttribute("stroke"), dash: dotted.getAttribute("stroke-dasharray") };
});
ok("2a messageLine0 stroke is themed (not none)", /rgb\(51,\s*51,\s*51\)|#333/i.test(msg.stroke || ""), JSON.stringify(msg));
ok("2b messageLine1 keeps its dasharray", !!msg.dash, JSON.stringify(msg));

// ---------------------------------------------------------------------------
// CASE 3 — total stylesheet failure: remove EVERY <style> in the document.
// Computed styles must STILL be the theme (proof the attributes carry it).
// ---------------------------------------------------------------------------
await p.evaluate(() => { document.querySelectorAll("style").forEach((s) => s.remove()); });
await sleep(300);
const dead = await p.evaluate(() => {
  const fc = document.querySelectorAll(".mermaid-diagram")[0];
  const rect = fc.querySelector(".node rect.basic");
  const seq = document.querySelectorAll(".mermaid-diagram")[1];
  const line = seq.querySelector("line.messageLine0");
  return {
    nodeFill: getComputedStyle(rect).fill,
    msgStroke: getComputedStyle(line).stroke,
    styleCount: document.querySelectorAll("style").length,
  };
});
ok("3a all styles removed", dead.styleCount === 0, JSON.stringify(dead));
ok("3b node fill survives without any stylesheet", /rgb\(236,\s*236,\s*255\)/i.test(dead.nodeFill), JSON.stringify(dead));
ok("3c message stroke survives without any stylesheet", /rgb\(51,\s*51,\s*51\)/i.test(dead.msgStroke), JSON.stringify(dead));

// ---------------------------------------------------------------------------
// CASE 4 — idempotency: a second install on the same holder adds no attrs.
// Uses window.editor's re-exported stampSvgStyles (no dynamic import() of a
// source path — that would 404 under vite preview and pollute the error list).
// ---------------------------------------------------------------------------
const idem = await p.evaluate(() => {
  const holder = document.querySelectorAll(".mermaid-diagram")[0];
  const before = holder.innerHTML.length;
  if (window.editor.stampSvgStyles) window.editor.stampSvgStyles(holder, "recheck-key-" + Date.now());
  return { changed: Math.abs(holder.innerHTML.length - before) > 40, has: !!window.editor.stampSvgStyles };
});
ok("4a re-stamp with same source is a no-op", idem.has && !idem.changed, JSON.stringify(idem));

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
console.log(`\n${pass} ok / ${fail} fail`);
await b.close();
try { process.kill(-srv.pid); } catch { /* already dead */ }
if (errors.length) fail = 1;
process.exit(fail ? 1 : 0);
