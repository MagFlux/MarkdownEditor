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
 *  - Code-block and MERMAID fence wraps put the caret INSIDE the fence: on
 *    the blank middle line for an empty block ("```\n|\n```" /
 *    "```mermaid\n|\n```"), after the content (before `\n````) otherwise.
 *  - Math-block insert puts the caret ON the blank middle line of "$$\n\n$$"
 *    (an empty caret line is replaced in place; a non-empty one keeps its
 *    prose and the block lands below it — the table branch's contract).
 *  - INSERT-ONLY inserter pins: table, codeblock/mermaid and math NEVER
 *    remove — a click inside an existing table/math block inserts a second
 *    scaffold, a click with
 *    the caret on a fence line re-wraps it (the old unwrap/remove branches
 *    are gone).
 *  - Table insert puts the caret in the first body cell; block formats put the
 *    caret at the end of the rewritten block.
 *  - Ctrl+Arrow word-wise moves are MARKDOWN-AWARE and engine-independent:
 *    a word is a whitespace-delimited run (trailing punctuation like
 *    `formatting.` rides along; a standalone ` - ` is its own stop) and a
 *    whole formatted span (`**bold**`, `*it*`, `` `code` ``, `[l](u)`,
 *    `**two words**`) is atomic — markers included. Ctrl+Right from
 *    `A| **lightweight**` lands at `A **lightweight**|`, from `editor|`
 *    stops after the `-`, from `live| formatting.` lands after the period;
 *    Ctrl+Left mirrors. Line-crossing stops at the next line's first word
 *    (`step|\n- **Diagrams**` → `step\n-| …`); only the document edges fall
 *    through to native (a no-op there). Ctrl+Shift+Arrow selection gestures
 *    act on the CARET edge (selectionDirection-driven): a forward selection
 *    shrinks from its right edge, crossing the anchor flips the direction;
 *    a fresh direction-less selection extends its far edge.
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

// Inline math `$…$` mirrors the inline caret contract: wrap ends at the
// inner-span end BEFORE the closing `$`; toggle-OFF collapses after the span;
// the empty pair inserts at the caret (pads merge with the gap).
await setDoc("bold test", [5, 9]);
await p.evaluate(() => window.editor.toggleFormat("inlinemath")); await sleep(200);
txt = await p.evaluate(() => window.editor.documentText);
ok("3e selection 'test' inline-mathed exactly", txt === "bold $test$", txt);
{
  const [a, bb] = await caret();
  ok("3f caret collapsed AFTER 'test', BEFORE closing '$'", a === 10 && bb === 10, [a, bb]);
}

await setDoc("$value$", 4);
await p.evaluate(() => window.editor.toggleFormat("inlinemath")); await sleep(200);
{
  const [a, bb] = await caret();
  ok("3f toggle-OFF $value$ unwraps, caret collapsed at span end",
    (await p.evaluate(() => window.editor.documentText)) === "value" && a === 5 && bb === 5, { sel: [a, bb] });
}

await setDoc("the test", 4);
await p.evaluate(() => window.editor.toggleFormat("inlinemath")); await sleep(200);
txt = await p.evaluate(() => window.editor.documentText);
{
  const [a, bb] = await caret();
  ok("3g gap caret + inline math → $$ pair, caret between the markers",
    txt === "the $$ test" && a === 5 && bb === 5, { txt, sel: [a, bb] });
}

await setDoc("price $5,000", 9);
await p.evaluate(() => window.editor.toggleFormat("inlinemath")); await sleep(200);
{
  const [a, bb] = await caret();
  ok("3h currency token is never wrapped (empty pair instead), token intact",
    (await p.evaluate(() => window.editor.documentText)) === "price $5, $$ 000" && a === 11 && bb === 11, { sel: [a, bb] });
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
// CASE 4M — Mermaid fence insert: the toolbar's ```mermaid button wraps with
// the SAME fence/caret contract as the codeblock button (offset +7 for the
// `mermaid\n` tag). INSERT-ONLY like every inserter: no branch removes an
// existing fence.
// ---------------------------------------------------------------------------
await setDoc("", 0);
await block("mermaid");
txt = await p.evaluate(() => window.editor.documentText);
{
  const [a, bb] = await caret();
  ok("4e empty mermaid wrap = ```mermaid\\n\\n```", txt === "```mermaid\n\n```", txt);
  ok("4f caret on the blank middle line, collapsed",
    a === 11 && bb === 11, [a, bb]);
}

await setDoc("foo", 3);
await block("mermaid");
txt = await p.evaluate(() => window.editor.documentText);
{
  const [a, bb] = await caret();
  ok("4g content mermaid wrap", txt === "```mermaid\nfoo\n```", txt);
  ok("4h caret after content, before the \\n``` tail",
    a === 14 && bb === 14, [a, bb]);
}

// ---------------------------------------------------------------------------
// CASE 4X — Math block insert: the toolbar's $$ button inserts the
// "$$\n\n$$" scaffold. INSERT-ONLY like every inserter (never removes), and
// it mirrors the table branch's caret-line contract: an EMPTY caret line is
// replaced in place, a NON-EMPTY line keeps its prose and the block lands
// BELOW it. Caret on the blank middle line, collapsed.
// ---------------------------------------------------------------------------
await setDoc("", 0);
await block("math");
txt = await p.evaluate(() => window.editor.documentText);
{
  const [a, bb] = await caret();
  ok("4k empty math insert = $$\\n\\n$$", txt === "$$\n\n$$\n", txt);
  ok("4l caret on the blank middle line, collapsed",
    a === 3 && bb === 3, [a, bb]);
}

await setDoc("foo", 3);
await block("math");
txt = await p.evaluate(() => window.editor.documentText);
{
  const [a, bb] = await caret();
  ok("4m math insert on a non-empty line KEEPS the prose, block pushed below",
    txt === "foo\n$$\n\n$$\n", txt);
  ok("4n caret on the block's blank middle line, collapsed",
    a === 7 && bb === 7, [a, bb]);
}

await setDoc("$$\nE=mc^2\n$$", 5);
await block("math");
txt = await p.evaluate(() => window.editor.documentText);
{
  const [a, bb] = await caret();
  ok("4o math click INSIDE an existing math block inserts a SECOND scaffold (never removes)",
    (txt.match(/^\$\$$/gm) || []).length === 4, txt);
  ok("4p caret in the SECOND scaffold's blank middle line, collapsed",
    a === 13 && bb === 13, [a, bb]);
}

// INSERT-ONLY pin: a caret ON a fence line wraps it AGAIN inside a new fence
// (the old unwrap-on-edge-line branch is gone — a second click never removes).
await setDoc("```\nfoo\n```", 0);
await block("codeblock");
txt = await p.evaluate(() => window.editor.documentText);
{
  const [a, bb] = await caret();
  ok("4i fence-line click wraps again (insert-only, no unwrap)",
    txt === "```\n```\n```\nfoo\n```", txt);
  ok("4j caret at end of the re-wrapped content, before the \\n``` tail",
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

// INSERT-ONLY pins: (a) clicking table with the caret INSIDE an existing table
// inserts a SECOND scaffold (the old remove-table branch is gone — a second
// click never removes) and (b) a table click on a non-empty line keeps that
// line's text and pushes the scaffold below it (the old splice REPLACED the
// caret line's text — insert-only means nothing is ever destroyed).
await setDoc("| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n|          |          |          |", 70);
await block("table");
{
  const [a, bb] = await caret();
  txt = await p.evaluate(() => window.editor.documentText);
  ok("5e table click INSIDE a table inserts a SECOND scaffold (never removes)",
    (txt.match(/\| Column 1 \| Column 2 \| Column 3 \|/g) || []).length === 2, txt);
  ok("5f caret in the SECOND scaffold's first body cell, collapsed",
    a === 177 && bb === 177, [a, bb]);
}

await setDoc("hello", 5);
await block("table");
txt = await p.evaluate(() => window.editor.documentText);
{
  const [a, bb] = await caret();
  ok("5g table click on a non-empty line KEEPS the prose, scaffold pushed below",
    txt === "hello\n| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n|          |          |          |\n", txt);
  ok("5h caret in the new scaffold's first body cell, collapsed",
    a === 78 && bb === 78, [a, bb]);
}

// ---------------------------------------------------------------------------
// CASE 6 — Markdown-aware Ctrl+Arrow word-wise caret moves. The engines'
// native segmentation is inconsistent AND marker-blind (both stop between
// "lightweight" and the closing `**`; Chromium stops before a trailing period;
// WebKitGTK skips standalone punctuation runs). wordJump owns every intra-line
// move with a deterministic token model: a word is a whitespace-delimited run
// (trailing punctuation rides along, a standalone ` - ` is its own stop) and a
// formatted span is ATOMIC (markers included, multi-word spans survive their
// internal space). Only line edges fall through to the native move (wraps).
// ---------------------------------------------------------------------------
// The exact reported bug: caret after "A", Ctrl+Right must clear the span.
await setDoc("A **lightweight**", 1);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("6a Ctrl+Right from 'A| **lightweight**' lands AFTER the closing '**'",
    a === 17 && bb === 17, [a, bb]);
}

// Caret at the span start / strictly inside the span: still one word.
await setDoc("A **lightweight**", 2);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("6b Ctrl+Right from the opening '**' clears the whole span", a === 17 && bb === 17, [a, bb]);
}
await setDoc("A **lightweight**", 5);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("6c Ctrl+Right from mid-'lightweight' lands after the closing '**'", a === 17 && bb === 17, [a, bb]);
}

// Mirror: Ctrl+Left from the span end / mid-span lands BEFORE the opening '**'.
await setDoc("A **lightweight**", 17);
await key("Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("6d Ctrl+Left from 'A **lightweight**|' lands at the opening '**'",
    a === 2 && bb === 2, [a, bb]);
}
await setDoc("A **lightweight**", 5);
await key("Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("6e Ctrl+Left from mid-span lands at the opening '**'", a === 2 && bb === 2, [a, bb]);
}

// Plain words BEFORE a span are not swallowed: the stop is the plain word's
// end (these values coincide with Chromium's native word-end stops).
await setDoc("foo bar **baz**", 0);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("6f Ctrl+Right from 'f|oo bar **baz**' stops at the plain word end",
    a === 3 && bb === 3, [a, bb]);
}
await setDoc("foo bar **baz**", 4);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("6g Ctrl+Right from 'b|ar **baz**' stops after 'bar' (not the span)",
    a === 7 && bb === 7, [a, bb]);
}

// Whitespace directly before a span: the span IS the next word → cross it whole.
await setDoc("foo bar **baz**", 7);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("6h Ctrl+Right from 'foo bar |**baz**' lands after the closing '**'",
    a === 15 && bb === 15, [a, bb]);
}

// Left mirror over a span, from its end and from mid-token.
await setDoc("foo bar **baz**", 15);
await key("Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("6i Ctrl+Left from after '**baz**' lands at the opening '**'", a === 8 && bb === 8, [a, bb]);
}
await setDoc("foo bar **baz**", 12);
await key("Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("6j Ctrl+Left from mid-'baz' lands at the opening '**'", a === 8 && bb === 8, [a, bb]);
}

// Other span kinds: code span and link.
await setDoc("x `code` y", 1);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("6k Ctrl+Right over a code span lands after the closing backtick",
    a === 8 && bb === 8, [a, bb]);
}
await setDoc("[text](url)", 1);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("6l Ctrl+Right inside a link lands after the closing ')'", a === 11 && bb === 11, [a, bb]);
}
await setDoc("[text](url)", 11);
await key("Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("6m Ctrl+Left from after a link lands at the opening '['", a === 0 && bb === 0, [a, bb]);
}

// Trailing sentence punctuation RIDES ALONG with its word (the "live
// formatting." report): the stop is after the comma, not before it.
await setDoc("**bold**, tail", 1);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("6n Ctrl+Right over '**bold**,' stops after the comma", a === 9 && bb === 9, [a, bb]);
}

// Shift+Ctrl+Arrow extends the selection word-wise (span as one word).
await setDoc("A **lightweight**", 1);
await key("Shift+Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("6o Shift+Ctrl+Right extends the selection across the whole span",
    a === 1 && bb === 17, [a, bb]);
}
await setDoc("A **lightweight**", 17);
await key("Shift+Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("6p Shift+Ctrl+Left extends the selection back to the opening '**'",
    a === 2 && bb === 17, [a, bb]);
}

// The "editor - write" report: a standalone punctuation run between spaces is
// a word of its own (WebKitGTK's native move used to SKIP it and jump to the
// end of the line).
await setDoc("editor - write", 6);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("6q Ctrl+Right from 'editor| - write' stops after the '-'",
    a === 8 && bb === 8, [a, bb]);
}
await setDoc("editor - write", 8);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("6r Ctrl+Right from 'editor -| write' stops after 'write'",
    a === 14 && bb === 14, [a, bb]);
}
await setDoc("editor - write", 14);
await key("Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("6s Ctrl+Left from 'editor - write|' stops before 'write'",
    a === 9 && bb === 9, [a, bb]);
}
await setDoc("editor - write", 9);
await key("Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("6t Ctrl+Left from 'editor - |write' stops before the '-'",
    a === 7 && bb === 7, [a, bb]);
}

// The "live formatting." report: trailing sentence punctuation is consumed in
// the same press (Chromium's native move stopped before the period).
await setDoc("live formatting.", 4);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("6u Ctrl+Right from 'live| formatting.' lands AFTER the period",
    a === 16 && bb === 16, [a, bb]);
}
await setDoc("live formatting.", 16);
await key("Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("6v Ctrl+Left from 'live formatting.|' stops at the word start",
    a === 5 && bb === 5, [a, bb]);
}

// Multi-word spans stay ATOMIC: the internal space must not split the word.
await setDoc("A **two words** b", 1);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("6w Ctrl+Right clears the whole '**two words**' span in one press",
    a === 15 && bb === 15, [a, bb]);
}
await setDoc("A **two words** b", 7);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("6x Ctrl+Right from the span's internal space still clears the span",
    a === 15 && bb === 15, [a, bb]);
}
await setDoc("A **two words** b", 15);
await key("Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("6y Ctrl+Left from after '**two words**' lands at the opening '**'",
    a === 2 && bb === 2, [a, bb]);
}
await setDoc("A **two words** b", 8);
await key("Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("6z Ctrl+Left from mid-'words' lands at the opening '**'",
    a === 2 && bb === 2, [a, bb]);
}

// ---------------------------------------------------------------------------
// CASE 7 — Ctrl+Arrow LINE-CROSSING. Native crossing is marker-blind: from
// `step|\n- **Diagrams**` it skips the next line's leading `- ` and lands
// mid-span (`**Diagrams|**`). wordJump owns the crossing: right moves stop at
// the end of the NEXT line's first word, left moves at the start of the
// PREVIOUS line's last word; blank lines are skipped; the document edges are
// left to native (a no-op there).
// ---------------------------------------------------------------------------
// The exact reported bug: end of "step", Ctrl+Right crosses and stops after
// the "-" list marker, NOT inside the span.
await setDoc("step\n- **Diagrams**", 4);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("7a Ctrl+Right at a line end crosses and stops after the next line's '-'",
    a === 6 && bb === 6, [a, bb]);
}
await setDoc("step\n- **Diagrams**", 6);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("7b the next press clears the whole span", a === 19 && bb === 19, [a, bb]);
}

// Mirror: Ctrl+Left from the crossed position walks back through the marker,
// then crosses the newline to the start of the previous line's last word.
await setDoc("step\n- **Diagrams**", 6);
await key("Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("7c Ctrl+Left from after the '-' stops at the '-' start",
    a === 5 && bb === 5, [a, bb]);
}
await setDoc("step\n- **Diagrams**", 5);
await key("Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("7d Ctrl+Left at a line start crosses back to the previous word start",
    a === 0 && bb === 0, [a, bb]);
}

// The next line's first word can itself be a span: stop after its markers.
await setDoc("a\n**bold** b", 1);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("7e crossing into a line that starts with a span stops after its '**'",
    a === 10 && bb === 10, [a, bb]);
}

// Plain-text crossing (no markers involved) and the left mirror.
await setDoc("one\ntwo", 3);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("7f Ctrl+Right crosses a plain newline to the next word end",
    a === 7 && bb === 7, [a, bb]);
}
await setDoc("one\ntwo", 4);
await key("Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("7g Ctrl+Left crosses back to the previous line's word start",
    a === 0 && bb === 0, [a, bb]);
}

// Blank lines are skipped while crossing.
await setDoc("a\n\nb", 1);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("7h Ctrl+Right skips blank lines while crossing", a === 4 && bb === 4, [a, bb]);
}

// Document edge: native handles it (a no-op — the caret stays put).
await setDoc("abc", 3);
await key("Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("7i Ctrl+Right at the document end leaves the caret in place",
    a === 3 && bb === 3, [a, bb]);
}

// Ctrl+Left from a line start whose previous line ENDS with a span: lands at
// the span's opening markers.
await setDoc("a **bold**\nnext", 11);
await key("Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("7j crossing back into a line that ends with a span stops at its '**'",
    a === 2 && bb === 2, [a, bb]);
}

// ---------------------------------------------------------------------------
// CASE 8 — Ctrl+Shift+Arrow selection gestures act on the CARET edge, not the
// left/right-most edge. A forward selection (anchor left, caret right) must
// SHRINK from its right edge on Ctrl+Shift+Left, and only grow past the
// anchor (direction flips) after the caret crosses it — like native
// shift+arrows. Anchor/caret come from selectionDirection; a fresh
// direction-less selection falls back to extending the far edge.
// ---------------------------------------------------------------------------
/** sel3 — park a selection with an EXPLICIT selectionDirection. */
const sel3 = (a, bb, df) => p.evaluate(([x, y, d]) => {
  const t = window.editor.activeTab.input;
  t.focus();
  t.setSelectionRange(x, y, d);
}, [a, bb, df]).then(() => sleep(S));

// Grow forward twice from a collapsed caret, then SHRINK back from the caret.
await setDoc("alpha beta gamma delta", 10); // caret between "beta" and "gamma"
await key("Shift+Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("8a Shift+Ctrl+Right grows forward one word from the caret",
    a === 10 && bb === 16, [a, bb]);
}
await key("Shift+Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("8b growing again reaches the line end", a === 10 && bb === 22, [a, bb]);
}
await key("Shift+Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("8c Shift+Ctrl+Left SHRINKS a forward selection from its caret edge",
    a === 10 && bb === 17, [a, bb]);
}
await key("Shift+Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("8d shrinking again keeps the anchor fixed", a === 10 && bb === 11, [a, bb]);
}
await key("Shift+Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("8e crossing the anchor flips the direction and grows the other way",
    a === 6 && bb === 10, [a, bb]);
}
await key("Shift+Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("8f moving back toward the anchor shrinks to nothing at the anchor",
    a === 10 && bb === 10, [a, bb]);
}

// A backward-made selection (anchor right, caret left) extends from its caret.
await setDoc("alpha beta gamma delta", 0);
await sel3(10, 16, "backward");
await key("Shift+Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("8g Shift+Ctrl+Left on a backward selection grows from its caret",
    a === 6 && bb === 16, [a, bb]);
}
await sel3(10, 16, "backward");
await key("Shift+Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("8h moving toward the anchor of a backward selection collapses at it",
    a === 16 && bb === 16, [a, bb]);
}

// A fresh selection with NO direction (programmatic/mouse-made): Chromium
// normalizes "none" to forward — the caret is the right edge — so the gesture
// shrinks from there. (The direction-less fallback branch — extend the far
// edge — only fires on engines that genuinely report "none".)
await setDoc("alpha beta gamma delta", 0);
await sel3(6, 16, "none");
await key("Shift+Control+ArrowRight");
{
  const [a, bb] = await caret();
  ok("8i direction-less selection + Shift+Ctrl+Right grows from its caret",
    a === 6 && bb === 22, [a, bb]);
}
await sel3(6, 16, "none");
await key("Shift+Control+ArrowLeft");
{
  const [a, bb] = await caret();
  ok("8j direction-less selection (normalized forward) shrinks from its caret",
    a === 6 && bb === 11, [a, bb]);
}

srv.kill("SIGKILL");
await b.close();
console.log(`\nPASS ${pass} / FAIL ${fail}`);
if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
process.exit(fail ? 1 : 0);
