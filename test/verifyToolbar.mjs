/**
 * verifyToolbar.mjs — toolbar active-states track the caret.
 *
 * Asserts the B/I/U/S/link and H1-H3/quote/list/table buttons light correctly
 * on click, arrow-key, programmatic-caret, and tab-switch paths (even with NO
 * text change required), with and without trailing sentence punctuation, plus
 * toggle-OFF comma preservation. Also guards the collapsed-caret format
 * insertion semantics: a plain caret inserts an EMPTY marker pair with the
 * caret between the markers (never wrapping a neighbouring word), while a
 * caret INSIDE a format span still toggles it off. Run with `npm run
 * verify-toolbar`.
 */
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
/** ok — record a pass/fail assertion under its label. */
const ok = (n, c) => { if (c) { pass++; console.log("ok  ", n); } else { fail++; console.log("FAIL", n); } };

// The live toolbar-state guarantee: the formatting buttons reflect the formatting
// at the CARET the instant the caret moves (click / arrow / programmatic), with NO
// text change required.  A whole-line token (e.g. `**bold**`) is detected at every
// intra-line caret offset, so the assertions are deterministic regardless of the
// exact caret pixel/offset.  Buttons read as `class="... active ..."`.

/** activeFmt — true when the inline `data-fmt` button for `name` is lit. */
const activeFmt = (name) => p.locator(`button[data-fmt="${name}"]`).first().getAttribute("class").then((c) => /(^|\s)active(\s|$)/.test(c || ""));

/** activeBlock — true when the `data-block` button for `name` is lit. */
const activeBlock = (name) => p.locator(`button[data-block="${name}"]`).first().getAttribute("class").then((c) => /(^|\s)active(\s|$)/.test(c || ""));
const FMT_NAMES = ["bold", "italic", "underline", "strike", "code", "link"];
const BLOCK_NAMES = ["h1", "h2", "h3", "quote", "ul", "ol", "table"];
/** states — snapshot every fmt + block button's active state into one object. */
async function states() {
  return {
    fmt: Object.fromEntries(await Promise.all(FMT_NAMES.map(async (n) => [n, await activeFmt(n)]))),
    block: Object.fromEntries(await Promise.all(BLOCK_NAMES.map(async (n) => [n, await activeBlock(n)]))),
  };
}
/**
 * setLine — set the active tab's full text (clearing dirty state) and park the caret.
 * @param {string} text — the new document text.
 * @param {number} off — the caret offset to place within it.
 */
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

// --- Inline formats with spaces: the whole formatted span must be detected ---
await setLine("**two words**", 6);
ok("caret in multi-word bold → bold active", (await activeFmt("bold")) === true);
await setLine("*two words*", 6);
ok("caret in multi-word italic → italic active", (await activeFmt("italic")) === true);
await setLine("<u>two words</u>", 7);
ok("caret in multi-word underline → underline active", (await activeFmt("underline")) === true);
await setLine("~~two words~~", 7);
ok("caret in multi-word strike → strike active", (await activeFmt("strike")) === true);
await setLine("`two words`", 6);
ok("caret in multi-word code → code active", (await activeFmt("code")) === true);
await setLine("[two words](https://example.com)", 7);
ok("caret in multi-word link → link active", (await activeFmt("link")) === true);

// --- Marker-like text inside code: code must win over nested-looking markers ---
const codeMarkerLine = "- The `**markers**` stay dimmed in the editor, so this stays a plain `.md` file";
for (const off of [codeMarkerLine.indexOf("markers") + 1, codeMarkerLine.indexOf("markers") + 3, codeMarkerLine.indexOf("markers") + 6]) {
  await setLine(codeMarkerLine, off);
  const s = await states();
  ok(`caret inside code-wrapped **markers** at ${off} → code active only`,
    s.fmt.code && Object.entries(s.fmt).every(([name, active]) => name === "code" || !active));
}

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

// --- Trailing comma: `**bold**` inside `- Live **bold**, *italic*` MUST light up. ---
// (Regression for the original bug: only the block `ul` button would activate
// because `wordAt` returned the 9-char token `**bold**` and the anchored
// detectFormat regexes failed.)
await setLine("- Live **bold**, *italic* here", 9);
{
  const s = await states();
  ok("caret on **bold** with trailing comma → bold active", s.fmt.bold === true);
  ok("caret on **bold** with trailing comma → only ul block (from `- ` prefix)",
    s.block.ul === true && !s.block.h1 && !s.block.h2 && !s.block.h3 && !s.block.quote && !s.block.ol && !s.block.table);
  ok("caret on **bold** with trailing comma → italic NOT active", s.fmt.italic === false);
}
await setLine("- Live **bold**, *italic* here", 19);
{
  const s = await states();
  ok("caret on *italic* with trailing comma → italic active", s.fmt.italic === true);
  ok("caret on *italic* with trailing comma → bold NOT active", s.fmt.bold === false);
}
// Strikethrough at end of line (no trailing comma — baseline still works):
await setLine("- Live ~~strikethrough~~", 25);
ok("caret on ~~strikethrough~~ at end → strike active", (await activeFmt("strike")) === true);
// Link (URL contains `:` `)` which must NOT be treated as sentence punctuation):
await setLine("See [links](https://example.com), then more", 15);
{
  const s = await states();
  ok("caret on [links](https://example.com), → link active", s.fmt.link === true);
  ok("caret on link w/ trailing comma → italic NOT active", s.fmt.italic === false);
}

// Toggle OFF **bold** in `- Live **bold**, *italic* here`: the trailing comma
// must SURVIVE removal (the pre-fix code would clobber it, giving
// `- Live bold, …` → `- Live bold,` lost the comma).
await setLine("- Live **bold**, *italic* here", 10);
await p.locator('button[data-fmt="bold"]:visible').first().click();
await sleep(S * 2);
{
  const txt = await p.evaluate(() => window.editor.activeTab.input.value);
  ok("toggle OFF **bold** with trailing comma → comma preserved",
    txt === "- Live bold, *italic* here", "got " + JSON.stringify(txt));
}

// --- Empty-line format: clicking bold on an empty line inserts the empty
// marker pair with the caret BETWEEN the markers, ready to type (regression:
// the old code wrapped the wordAt fallback span and left the caret at the
// line start). ---
await setLine("", 0);
await p.locator('button[data-fmt="bold"]:visible').first().click();
await sleep(S * 2);
{
  const t = await p.evaluate(() => {
    const i = window.editor.activeTab.input;
    return { v: i.value, s: i.selectionStart, e: i.selectionEnd };
  });
  ok("bold on empty line → inserts **** with caret in the middle",
    t.v === "****" && t.s === 2 && t.e === 2, "got " + JSON.stringify(t));
}

// --- Caret BETWEEN words ("the | test"): bold must NOT wrap a neighbour; it
// inserts an empty pair at the caret (regression: the old code bolded whichever
// word the caret was closer to). ---
await setLine("the test", 3);
await p.locator('button[data-fmt="bold"]:visible').first().click();
await sleep(S * 2);
{
  const t = await p.evaluate(() => {
    const i = window.editor.activeTab.input;
    return { v: i.value, s: i.selectionStart, e: i.selectionEnd };
  });
  ok("caret between words → inserts **** at caret, neighbours untouched",
    t.v === "the **** test" && t.s === 6 && t.e === 6, "got " + JSON.stringify(t));
}

// --- Caret INSIDE a formatted token still toggles OFF ---
await setLine("plain **bold** here", 8);
await p.locator('button[data-fmt="bold"]:visible').first().click();
await sleep(S * 2);
{
  const txt = await p.evaluate(() => window.editor.activeTab.input.value);
  ok("caret inside **bold** + bold → toggles OFF",
    txt === "plain bold here", "got " + JSON.stringify(txt));
}

// --- Caret just past a format span's closing marker: the button LIT state
// (asserted earlier on this caret) means a click must toggle the span OFF,
// never leave it half-wrapped. ---
await setLine("**bold** rest", 8);
await p.locator('button[data-fmt="bold"]:visible').first().click();
await sleep(S * 2);
{
  const txt = await p.evaluate(() => window.editor.activeTab.input.value);
  ok("caret right after `**bold**` (button lit) → toggles OFF the span",
    txt === "bold rest", "got " + JSON.stringify(txt));
}

// --- Selection still wraps the exact selected span ---
await p.evaluate(() => {
  const ed = window.editor;
  ed.setDocumentText("select me please");
  const t = ed.activeTab.input;
  t.setSelectionRange(7, 9);
  t.dispatchEvent(new Event("selectionchange", { bubbles: true }));
});
await sleep(S);
await p.locator('button[data-fmt="bold"]:visible').first().click();
await sleep(S * 2);
{
  const txt = await p.evaluate(() => window.editor.activeTab.input.value);
  ok("selection `me` + bold → wraps exactly the selection",
    txt === "select **me** please", "got " + JSON.stringify(txt));
}

console.log(`\nPASS ${pass} / FAIL ${fail}`);
await b.close();
try { process.kill(-srv.pid); } catch { /* already dead */ }
if (errors.length) { console.log("PAGE ERRORS:", errors); fail++; }
process.exit(fail ? 1 : 0);
