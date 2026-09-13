import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

const S = 400; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try { execSync(`kill $(lsof -ti tcp:4398) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4398", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("ok  ", n); } else { fail++; console.log("FAIL", n); } };

await p.goto("http://localhost:4398/", { waitUntil: "networkidle" });
await sleep(600);

const val = () => p.evaluate(() => window.editor.documentText);
const undoState = () => p.evaluate(() => {
  const t = window.editor.activeTab;
  const btn = window.editor.toolbar.querySelector('[data-action="undo"]');
  return { len: t.undo.length, enabled: !btn.disabled };
});

// Dispatch a synthetic paste event whose clipboardData carries the given text/html.
async function pasteHtml(html) {
  return p.evaluate((html) => {
    const t = window.editor.activeTab.input;
    const ev = new Event("paste", { cancelable: true });
    ev.clipboardData = { getData: (type) => (type === "text/html" ? html : "") };
    const prevented = !t.dispatchEvent(ev);
    return prevented;
  }, html);
}

// --- 1) Excel-style HTML table → GFM markdown table ---
const excelTable = `<table><tr><th>Q1</th><th>Q2</th></tr><tr><td>10</td><td>20</td></tr><tr><td>30</td><td>40</td></tr></table>`;
await p.evaluate(() => { window.editor.setDocumentText(""); });
{
  const prevented = await pasteHtml(excelTable);
  const v = await val();
  ok("excel table → paste was intercepted", prevented === true);
  ok("excel table → has header | Q1 | Q2 |", v.includes("| Q1 | Q2 |"));
  ok("excel table → has separator | ------ | ------ |", v.includes("| ------ | ------ |"));
  ok("excel table → row 1 | 10 | 20 |", v.includes("| 10 | 20 |"));
  ok("excel table → row 2 | 30 | 40 |", v.includes("| 30 | 40 |"));
  ok("excel table → 4 lines", v.split("\n").length === 4);
}
{
  const u = await undoState();
  ok("excel table → undo button enabled", u.enabled === true);
  ok("excel table → one undo entry", u.len === 1);
}
await p.evaluate(() => window.editor.undo());
await sleep(S);
ok("excel table → undo restores empty doc", (await val()) === "");
ok("excel table → undo clears undo stack", (await undoState()).len === 0);

// --- 2) Bold / italic / underline spans preserved on paste ---
await p.evaluate(() => { window.editor.setDocumentText(""); });
await pasteHtml(`<b>bold text</b>`);
ok("bold span → **bold text**", (await val()) === "**bold text**");

await p.evaluate(() => { window.editor.setDocumentText(""); });
await pasteHtml(`<i>italic text</i>`);
ok("italic span → *italic text*", (await val()) === "*italic text*");

await p.evaluate(() => { window.editor.setDocumentText(""); });
await pasteHtml(`<u>under text</u>`);
ok("underline span → <u>under text</u>", (await val()) === "<u>under text</u>");

await p.evaluate(() => { window.editor.setDocumentText(""); });
await pasteHtml(`plain <b>bold bit</b> after`);
ok("mixed span → plain **bold bit** after", (await val()) === "plain **bold bit** after");

// --- 3) A cell that is itself bold keeps its bold markers in the table ---
await p.evaluate(() => { window.editor.setDocumentText(""); });
await pasteHtml(`<table><tr><th>Label</th></tr><tr><td><b>emphasised</b></td></tr></table>`);
{
  const v = await val();
  ok("table bold cell → **emphasised** inside | ... |", v.includes("| **emphasised** |"));
  ok("table bold cell → header + row present", v.includes("| Label |") && v.includes("| ------ |"));
}

// --- 4) No HTML on the clipboard → not intercepted (falls to default paste) ---
await p.evaluate(() => { window.editor.setDocumentText("base"); });
{
  const intercepted = await p.evaluate(() => {
    const t = window.editor.activeTab.input;
    const ev = new Event("paste", { cancelable: true });
    ev.clipboardData = { getData: () => "" }; // no text/html
    return !t.dispatchEvent(ev);
  });
  ok("plain-text paste → NOT intercepted (browser inserts plain text)", intercepted === false);
  ok("plain-text paste → document still just 'base'", (await val()) === "base");
}

console.log(`\nPASS ${pass} / FAIL ${fail}`);
await b.close();
try { process.kill(-srv.pid); } catch { /* already dead */ }
if (errors.length) { console.log("PAGE ERRORS:", errors); fail++; }
process.exit(fail ? 1 : 0);
