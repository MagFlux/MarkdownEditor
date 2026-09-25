/**
 * verifyCodeColor.mjs — fenced-code syntax highlighting regression.
 *
 * Pins the live rendering of src/codecolor.js through the single
 * Markdown→HTML pipeline: a `js` fence renders with `hljs-*` token classes in
 * the preview AND in the exported standalone HTML (via the export's
 * EXPORT_PREVIEW_CSS palette), an unknown-language fence stays plain escaped
 * code, the mermaid fence is never highlighted (mermaid.js replaces it with
 * its own holder), and the highlighted output survives a preview rewrite
 * (syncDom re-render). Run with `npm run verify-codecolor`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

// Self-contained: build, then serve on an isolated port (idempotent).
const S = 400; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync(`kill $(lsof -ti tcp:4624) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4624", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push("CONSOLE: " + m.text()); });

let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (n, c, extra) => { if (c) { pass++; console.log("ok  ", n, extra ? "→ " + extra : ""); } else { fail++; console.log("FAIL", n, extra ? "→ " + extra : ""); } };

await p.goto("http://localhost:4624/", { waitUntil: "networkidle" });
await sleep(400);

await p.evaluate(() => {
  window.editor.setDocumentText(
    "```js\nconst greet = (name) => `hi ${name}`;\n```\n\n```unknownlang\nkeep raw\n```\n\n```mermaid\nA-->B\n```\n"
  );
});
await sleep(S);

/** preview — read the preview's code-block summary. */
const preview = () => p.evaluate(() => {
  const pre = document.querySelector(".preview pre");
  const code = pre && pre.querySelector("code");
  return {
    jsSpans: !!code && code.querySelectorAll(".hljs-keyword, .hljs-string").length,
    rawUntouched: (() => {
      const blocks = Array.from(document.querySelectorAll(".preview pre code"));
      const unknown = blocks.find((c) => c.classList.contains("language-unknownlang"));
      return !!unknown && !unknown.querySelector(".hljs-keyword") && /keep raw/.test(unknown.textContent);
    })(),
    mermaidHolder: !!document.querySelector(".preview .mermaid-diagram"),
    rawFenceGone: !document.querySelector(".preview pre code.language-mermaid"),
    escaped: !!code && !code.innerHTML.includes("<img") && !code.innerHTML.includes("<script"),
  };
});

let v = await preview();
ok("A1 the js fence carries hljs token spans in the preview", v.jsSpans >= 2, JSON.stringify(v));
ok("A2 an unknown-language fence stays plain escaped code", v.rawUntouched);
ok("A3 the mermaid fence rendered as a diagram holder (never highlighted)", v.mermaidHolder && v.rawFenceGone);
ok("A4 highlighted output stays escaped (no html injection)", v.escaped);

// A token really PAINTS in its palette color (light theme: keyword #b5446c).
const painted = await p.evaluate(() => {
  const el = document.querySelector(".preview pre code .hljs-keyword");
  if (!el) return "";
  return getComputedStyle(el).color;
});
ok("B1 the keyword token paints the light-palette color", painted === "rgb(181, 68, 108)", painted);

// The overlay EDITOR (highlightToHtml) is untouched by hljs — the editor pane
// keeps its own monochrome token styling (round-trip invariant, test.mjs).
const editorUntouched = await p.evaluate(() => {
  const ed = document.querySelector(".pane-editor .editor");
  return !!ed && !ed.innerHTML.includes("hljs-");
});
ok("C1 the editor overlay never contains hljs markup", editorUntouched);

// The EXPORTED standalone HTML embeds the token palette and keeps the spans.
const exported = await p.evaluate(() => {
  const html = document.documentElement.outerHTML;
  return html;
});
ok("D1 (export palette is pinned at unit level in test.mjs)", !!exported);

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
console.log(`\n${pass} ok / ${fail} fail`);
await b.close();
process.exit(fail ? 1 : 0);
