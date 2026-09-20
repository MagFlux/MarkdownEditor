/**
 * verifyCaret.mjs — caret placement after editor actions.
 *
 * Guards the caret/selection contracts committed this session:
 *  - Enter on a nested list item CONTINUES the marker AND the parent's
 *    indentation, with a collapsed caret after the new marker (no highlight).
 *  - Tab indents blank lines too, and the caret follows its column through the
 *    added/removed indent — ALWAYS collapsed (never a highlight over the
 *    block). Shift+Tab outdents the same way.
 *  - Inline formats (mid-word or over a selection) commit a collapsed caret at
 *    the end of the inner text, immediately BEFORE the closing marker.
 *  - Code-block wrap puts the caret INSIDE the fence: on the blank middle line
 *    for an empty block ("```\n|\n```"), after the content (before `\n````)
 *    otherwise.
 *  - Table insert puts the caret in the first body cell; block formats put the
 *    caret at the end of the rewritten block.
 *
 * Run with `npm run verify-caret`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

const S = 400; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Self-contained: build, then serve the built output on an isolated port (idempotent)
try { execSync(`kill $(lsof -ti tcp:4608) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4608", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
let pass = 0, fail = 0;
/** ok — record a pass/fail assertion with an optional diagnosis string. */
const ok = (n, c, extra) => { if (c) { pass++; console.log("ok  ", n, extra !== undefined ? "→ " + JSON.stringify(extra) : ""); } else { fail++; console.log("FAIL", n, extra !== undefined ? "→ " + JSON.stringify(extra) : ""); } };

await p.goto("http://localhost:4608/", { waitUntil: "networkidle" });
await sleep(600);

/**
 * caret — the selection state [start, end] of the active tab's textarea.
 * @returns {Promise<[number, number]>}
 */
const caret = () => p.evaluate(() => {
  const t = window.editor.activeTab.input;
  return [t.selectionStart, t.selectionEnd];
});

/**
 * setDoc — set the active tab's full text (non-committing), focus the textarea,
 * and park the caret at `off` (collapsed) or [start,end].
 * @param {string} text — the full document text.
 * @param {number|[number,number]} sel — caret offset or selection range.
 */
async function setDoc(text, sel) {
  await p.evaluate(([txt, s]) => {
    const ed = window.editor;
    ed.setDocumentText("");
    const t = ed.activeTab.input;
    ed.setDocumentText(txt);
    const [a, bb] = Array.isArray(s) ? s : [s, s];
    t.focus();
    t.setSelectionRange(a, bb);
  }, [text, sel]);
  await sleep(S);
}

/** key — press a real keyboard key on the focused textarea. */
const key = (k) => p.keyboard.press(k).then(() => sleep(S));
/** block — invoke a block-format action directly. */
const block = (kind) => p.evaluate((k2) => window.editor.toggleBlock(k2), kind).then(() => sleep(200));

// ---------------------------------------------------------------------------
// CASE 1 — Enter continues a NESTED list item with its parent's indentation.
// The original bug: "\t- Test3" + Enter produced an UNINDENTED "- " on the
// next line (the leading `\s*` of the marker regex was dropped).
// ---------------------------------------------------------------------------
await setDoc("- Test1\n- Test2\n\t- Test", 25);
await key("Enter");
let txt = await p.evaluate(() => window.editor.documentText);
ok("1a Enter after nested bullet keeps the tab indent + marker",
  txt === "- Test1\n- Test2\n\t- Test\n\t- ", txt);
{
  const [a, bb] = await caret();
  ok("1b Enter continuation = collapsed caret after the marker (no highlight)",
    a === 27 && bb === 27, [a, bb]);
}

// Ordered list increment also works down a level of indentation.
await setDoc("1. one\n\t2. two", 14);
await key("Enter");
txt = await p.evaluate(() => window.editor.documentText);
ok("1c Enter on nested ordered item → indent preserved + number incremented",
  txt === "1. one\n\t2. two\n\t3. ", txt);

// Enter on an EMPTY nested item still EXITS the list.
await setDoc("- a\n\t- ", 7);
await key("Enter");
txt = await p.evaluate(() => window.editor.documentText);
ok("1d Enter on empty nested item exits the list", txt === "- a\n", txt);

// ---------------------------------------------------------------------------
// CASE 2 — Tab: indenting NEVER highlights; caret follows its column.
// ---------------------------------------------------------------------------
await setDoc("hello world", 5); // caret after "hello", column 5, line start col 0
await key("Tab");
txt = await p.evaluate(() => window.editor.documentText);
ok("2a Tab indents whole line", txt === "\thello world", txt);
{
  const [a, bb] = await caret();
  ok("2b caret followed the text (no highlight)", a === 6 && bb === 6, [a, bb]);
}

// Blank line: Tab inserts the indent and the caret moves past it (collapsed).
await setDoc("a\n\nb", 2); // caret on the blank middle line
await key("Tab");
txt = await p.evaluate(() => window.editor.documentText);
ok("2c Tab on a BLANK line inserts the indent", txt === "a\n\t\nb", txt);
{
  const [a, bb] = await caret();
  ok("2d caret visibly moved onto the blank line, collapsed", a === 3 && bb === 3, [a, bb]);
}

// Shift+Tab outdent: caret maps back through the removed prefix.
await setDoc("\tabcd", 5); // caret after "abcd"
await key("Shift+Tab");
txt = await p.evaluate(() => window.editor.documentText);
ok("2e Shift+Tab outdents the line", txt === "abcd", txt);
{
  const [a, bb] = await caret();
  ok("2f caret column preserved across removal, collapsed", a === 4 && bb === 4, [a, bb]);
}

// Shift+Tab at column 0: nothing before the caret, it stays at column 0.
await setDoc("\tabc", 0);
await key("Shift+Tab");
txt = await p.evaluate(() => window.editor.documentText);
ok("2g Shift+Tab at col 0 outdents", txt === "abc", txt);
{
  const [a, bb] = await caret();
  ok("2h caret stays at column 0, collapsed", a === 0 && bb === 0, [a, bb]);
}

// ---------------------------------------------------------------------------
// CASE 3 — Inline formats: caret at the end of the inner text, BEFORE the
// closing marker, never a highlight.
// ---------------------------------------------------------------------------
// Selection bold: select exactly "test", then bold it.
await setDoc("bold test", [5, 9]);
await p.evaluate(() => window.editor.toggleFormat("bold")); await sleep(200);
txt = await p.evaluate(() => window.editor.documentText);
ok("3a selection 'test' bolded exactly", txt === "bold **test**", txt);
{
  const [a, bb] = await caret();
  ok("3b caret collapsed AFTER 'test', BEFORE closing '**'", a === 11 && bb === 11, [a, bb]);
}

// Mid-word caret wrap: caret strictly inside a plain word.
await setDoc("bold test", 7); // caret inside "test"
await p.evaluate(() => window.editor.toggleFormat("bold")); await sleep(200);
txt = await p.evaluate(() => window.editor.documentText);
{
  const [a, bb] = await caret();
  ok("3c mid-word caret wrap lands caret before closing **",
    txt === "bold **test**" && a === 11 && bb === 11, { txt, sel: [a, bb] });
}

// Toggle-OFF via caret INSIDE the span: caret ends after the unwrapped span.
await setDoc("**test**", 4);
await p.evaluate(() => window.editor.toggleFormat("bold")); await sleep(200);
txt = await p.evaluate(() => window.editor.documentText);
{
  const [a, bb] = await caret();
  ok("3d toggle-OFF unwraps, caret collapsed at span end before nothing",
    txt === "test" && a === 4 && bb === 4, { txt, sel: [a, bb] });
}

// Empty-marker insertion still keeps the caret BETWEEN the markers.
await setDoc("the test", 4); // caret in the single-space gap
await p.evaluate(() => window.editor.toggleFormat("bold")); await sleep(200);
txt = await p.evaluate(() => window.editor.documentText);
{
  const [a, bb] = await caret();
  ok("3d gap caret inserts empty pair with caret between markers",
    txt === "the **** test" && a === 6 && bb === 6, { txt, sel: [a, bb] });
}

// ---------------------------------------------------------------------------
// CASE 4 — Code block: caret INSIDE the fence.
// ---------------------------------------------------------------------------
await setDoc("", 0);
await block("codeblock");
txt = await p.evaluate(() => window.editor.documentText);
{
  const [a, bb] = await caret();
  ok("4a empty fence wrap = ```\\n\\n```", txt === "```\n\n```", txt);
  ok("4b caret sits on the blank middle line (before the closing fence)",
    a === 4 && bb === 4, [a, bb]);
}

await setDoc("foo", 3);
await block("codeblock");
txt = await p.evaluate(() => window.editor.documentText);
{
  const [a, bb] = await caret();
  ok("4c content fence wrap", txt === "```\nfoo\n```", txt);
  ok("4d caret after content, before the \\n``` tail",
    a === 7 && bb === 7, [a, bb]);
}

// ---------------------------------------------------------------------------
// CASE 5 — Block level: h1 caret at end of rewritten block; table caret in
// the first body cell; codeblock-as-selection caret end.
// ---------------------------------------------------------------------------
await setDoc("title", 5);
await block("h1");
txt = await p.evaluate(() => window.editor.documentText);
{
  const [a, bb] = await caret();
  ok("5a h1 rewrites the line", txt === "# title", txt);
  ok("5b caret at end, collapsed", a === 7 && bb === 7, [a, bb]);
}

await setDoc("", 0);
await block("table");
{
  const [a, bb] = await caret();
  const good = await p.evaluate(() => {
    const v = window.editor.documentText;
    const row3 = "|          |          |          |";
    const row3Start = v.indexOf(row3);
    return [row3Start + 2, row3Start + 2];
  });
  ok("5c table insertion = 3-row scaffold",
    (await p.evaluate(() => window.editor.documentText)) ===
      "| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n|          |          |          |\n");
  ok("5d caret in the first body cell, collapsed",
    (a === good[0] && bb === good[1]), [a, good[0]]);
}

srv.kill("SIGKILL");
await b.close();
console.log(`\nPASS ${pass} / FAIL ${fail}`);
if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
process.exit(fail ? 1 : 0);
