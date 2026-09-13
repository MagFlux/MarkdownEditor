import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

const S = 400; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Self-contained: build, then serve the built output on an isolated port (idempotent)
try { execSync(`kill $(lsof -ti tcp:4399) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4399", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("ok  ", n); } else { fail++; console.log("FAIL", n); } };

// The live toolbar-state guarantee: the formatting buttons reflect the formatting
// at the CARET the instant the caret moves (click / arrow / programmatic), with NO
// text change required.  A whole-line token (e.g. `**bold**`) is detected at every
// intra-line caret offset, so the assertions are deterministic regardless of the
// exact caret pixel/offset.  Buttons read as `class="... active ..."`.

const activeFmt = (name) => p.locator(`button[data-fmt="${name}"]`).first().getAttribute("class").then((c) => /(^|\s)active(\s|$)/.test(c || ""));
const activeBlock = (name) => p.locator(`button[data-block="${name}"]`).first().getAttribute("class").then((c) => /(^|\s)active(\s|$)/.test(c || ""));
const FMT_NAMES = ["bold", "italic", "underline", "strike", "code", "link"];
const BLOCK_NAMES = ["h1", "h2", "h3", "quote", "ul", "ol", "table"];
async function states() {
  return {
    fmt: Object.fromEntries(await Promise.all(FMT_NAMES.map(async (n) => [n, await activeFmt(n)]))),
    block: Object.fromEntries(await Promise.all(BLOCK_NAMES.map(async (n) => [n, await activeBlock(n)]))),
  };
}
// Set the active tab's whole text (cleaning dirty state) and place the caret at `off`.
async function setLine(text, off) {
  await p.evaluate(([txt, o]) => {
    const ed = window.editor;
    ed.setDocumentText(txt);
    const t = ed.activeTab.input;
    t.setSelectionRange(o, o);
    t.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  }, [text, off]);
  await sleep(S);
}

await p.goto("http://localhost:4399/", { waitUntil: "networkidle" });
await sleep(600);

// --- Inline bold: `**bold**` is detected at every caret offset within its line ---
await setLine("**bold**", 4);
{
  const s = await states();
  ok("caret in **bold** → bold active", s.fmt.bold === true);
  ok("caret in **bold** → no other inline active",
    !s.fmt.italic && !s.fmt.code && !s.fmt.link && !s.fmt.strike && !s.fmt.underline);
  ok("caret in **bold** → no block active", Object.values(s.block).every((v) => v === false));
}

await setLine("**bold**", 0);
ok("caret at start (off 0) of **bold** line → still bold, no text change", (await activeFmt("bold")) === true);

await setLine("**bold**", 8);
ok("caret at end (off 8) of **bold** line → still bold, no text change", (await activeFmt("bold")) === true);

// --- Inline underline: `<u>hello</u>` ---
await setLine("<u>hello</u>", 6);
{
  const s = await states();
  ok("caret in <u>hello</u> → underline active", s.fmt.underline === true);
  ok("caret in <u>hello</u> → bold NOT active", s.fmt.bold === false);
}

// --- Inline code: `code` ---
await setLine("`code`", 3);
ok("caret in `code` → code active", (await activeFmt("code")) === true);

// --- Plain line: NO inline, NO block ---
await setLine("plain text here", 9);
{
  const s = await states();
  ok("caret on plain line → no inline active", Object.values(s.fmt).every((v) => v === false));
  ok("caret on plain line → no block active", Object.values(s.block).every((v) => v === false));
}

// --- Block H2: `## Heading` → h2 (not h1/h3), no inline ---
await setLine("## Heading", 4);
{
  const s = await states();
  ok("caret on ## line → h2 active", s.block.h2 === true);
  ok("caret on ## line → h1/h3 NOT active", s.block.h1 === false && s.block.h3 === false);
  ok("caret on ## line → no inline active", Object.values(s.fmt).every((v) => v === false));
}

// --- Arrow-key / End move: caret moves with no text change; button tracks ---
await setLine("**bold**", 0);
await p.locator("textarea.input:visible").last().focus();
await p.keyboard.press("End"); // caret jumps to end of line, no text change
await sleep(S);
ok("keyboard End move onto **bold** → bold active (no text change)", (await activeFmt("bold")) === true);

// --- Tab switch re-sync: activating one tab, then another, re-syncs buttons ---
await p.evaluate(() => { window.editor.newTab("tb-bold", "**bold**"); });
await sleep(S * 2);
ok("activate() onto a **bold** tab → bold active (no text change)", (await activeFmt("bold")) === true);

await p.evaluate(() => { window.editor.newTab("tb-plain", "just words"); });
await sleep(S * 2);
{
  const s = await states();
  ok("activate() onto a plain tab → no inline active (stale bold cleared)", Object.values(s.fmt).every((v) => v === false));
  ok("activate() onto a plain tab → no block active", Object.values(s.block).every((v) => v === false));
}

await p.evaluate(() => { const t = window.editor.tabs.find((x) => x.name === "tb-bold"); if (t) window.editor.activate(t); });
await sleep(S * 2);
ok("activate() back to a **bold** tab → bold active again (no text change)", (await activeFmt("bold")) === true);

console.log(`\nPASS ${pass} / FAIL ${fail}`);
await b.close();
try { process.kill(-srv.pid); } catch { /* already dead */ }
if (errors.length) { console.log("PAGE ERRORS:", errors); fail++; }
process.exit(fail ? 1 : 0);
