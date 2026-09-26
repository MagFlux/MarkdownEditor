/**
 * verifyFind.mjs — Find & Replace bar regression (floating non-modal bar).
 *
 * Pins the contracts of src/find.js: Ctrl+F opens the bar with focus in the
 * find input (and pre-fills from a single-line selection), Esc closes it and
 * hands focus back to the editor, the live count `i/n` tracks typing without
 * yanking the editor caret, Enter / F3 navigate with wrap-around (selection
 * lands on the match bounds), the Aa case toggle and the `.*` regex toggle
 * behave (invalid regex = inline red, never a throw), Replace replaces the
 * selected match as ONE undo step, Replace-all replaces everything as ONE
 * undo step, regex `$1` substitutions work, the bar recomputes across tab
 * switches, typing in the editor updates the count while the bar is open, and
 * in split view a reveal scroll DRIVES the preview pane to the matching
 * position (the preview follows the found match through the block-anchored
 * scroll-sync machinery).
 * Run with `npm run verify-find`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

// Self-contained: build, then serve on an isolated port (idempotent).
const S = 400; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync(`kill $(lsof -ti tcp:4621) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4621", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push("CONSOLE: " + m.text()); });

let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (n, c, extra) => { if (c) { pass++; console.log("ok  ", n, extra ? "→ " + extra : ""); } else { fail++; console.log("FAIL", n, extra ? "→ " + extra : ""); } };

await p.goto("http://localhost:4621/", { waitUntil: "networkidle" });
await sleep(400);

// Deterministic fixture (len 115; case-folded "lorem" ×6: 2+2+1+1; exact-case
// "lorem" ×5; the tail match sits at [105,110)):
//   line1 27 | list line 39 | ```js 5 | fence code 23 | ``` 3 | tail lorem 10
await p.evaluate(() => {
  const ed = window.editor;
  ed.setDocumentText(
    "lorem ipsum and Lorem again\n\n- lorem in a list, then lorem once more\n\n```js\n// lorem inside a fence\n```\n\ntail lorem"
  );
});
await sleep(S);

/**
 * barState — read the bar's open state, count text, error class, and inputs.
 * @returns {Promise<{open:boolean, count:string, err:boolean, find:string, repl:string, focused:string}>}
 */
const barState = () => p.evaluate(() => {
  const bar = document.querySelector(".findbar");
  const active = document.activeElement;
  return {
    open: !!(bar && bar.classList.contains("open")),
    count: bar ? bar.querySelector(".fcount").textContent : "",
    err: !!(bar && bar.querySelector('[data-f="find"]').classList.contains("err")),
    find: bar ? bar.querySelector('[data-f="find"]').value : "",
    repl: bar ? bar.querySelector('[data-f="replace"]').value : "",
    focused: active ? (active.dataset && active.dataset.f ? active.dataset.f : (active.className || active.tagName)) : "",
  };
});

/** sel — the active textarea's [selectionStart, selectionEnd]. */
const sel = () => p.evaluate(() => { const d = window.editor.activeTab; return [d.input.selectionStart, d.input.selectionEnd]; });

/** setFind / setRepl — set the bar inputs from the page side. */
const setFind = (v) => p.evaluate((t) => {
  const el = document.querySelector('.findbar [data-f="find"]');
  el.value = t;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, v);
const setRepl = (v) => p.evaluate((t) => { document.querySelector('.findbar [data-f="replace"]').value = t; }, v);

// ---------------------------------------------------------------------------
// CASE 1 — open/close + focus semantics
// ---------------------------------------------------------------------------
await p.keyboard.press("Control+f");
let st = await barState();
ok("1a Ctrl+F opens the bar with focus in the find input", st.open && st.focused === "find", JSON.stringify(st));

ok("1b empty query counts 0/0", st.count === "0/0", st.count);

await p.keyboard.press("Escape");
st = await barState();
const focusedAfterEsc = await p.evaluate(() => document.activeElement === window.editor.activeTab.input);
ok("1c Esc closes the bar and refocuses the editor textarea", !st.open && focusedAfterEsc);

// ---------------------------------------------------------------------------
// CASE 2 — live count + selection navigation with wrap-around
// Bar re-OPENED here (1c closed it). Caret parked at 0 (inside match 1).
// ---------------------------------------------------------------------------
await p.evaluate(() => { const d = window.editor.activeTab; d.input.focus(); d.input.setSelectionRange(0, 0); });
await p.keyboard.press("Control+f");
await setFind("lorem");
st = await barState();
ok("2a live count: 6 case-folded 'lorem' matches", st.count === "1/6", st.count);

const firstSel = await sel();
ok("2b typing a query SELECTS the current match ([0,5))", firstSel[0] === 0 && firstSel[1] === 5, JSON.stringify(firstSel));

await p.keyboard.press("Enter"); // focus is in the bar's find input → next
let s1 = await sel();
ok("2c Enter selects match 2 bounds [16,21) ('Lorem')", s1[0] === 16 && s1[1] === 21, JSON.stringify(s1));

await p.keyboard.press("F3");
let s2 = await sel();
st = await barState();
ok("2d F3 advances to match 3 (list item) and count follows", s2[0] === 31 && st.count === "3/6", JSON.stringify(s2) + " / " + st.count);

for (let i = 0; i < 4; i++) await p.keyboard.press("F3");
let s3 = await sel();
ok("2f F3 wraps around the document (back to match 1 [0,5))", s3[0] === 0 && s3[1] === 5, JSON.stringify(s3));

await p.keyboard.press("Shift+F3");
let s4 = await sel();
ok("2g Shift+F3 steps back with wrap (lands on the tail match [110,115))", s4[0] === 110 && s4[1] === 115, JSON.stringify(s4));

// ---------------------------------------------------------------------------
// CASE 3 — case toggle (Aa) + regex toggle (.*)
// ---------------------------------------------------------------------------
await p.evaluate(() => { document.querySelector('.findbar [data-fo="case"]').click(); });
st = await barState();
ok("3a Aa on: 5 exact-case matches, count tracks the caret's match (5th)", st.count === "5/5", st.count);
await p.evaluate(() => { document.querySelector('.findbar [data-fo="case"]').click(); }); // Aa off again

await setFind("lo(r)em"); // regex: 'lorem' with capture 'r'
await p.evaluate(() => { document.querySelector('.findbar [data-fo="regex"]').click(); });
st = await barState();
ok("3b regex mode: 6 matches, count tracks the caret's match (6th)", st.count === "6/6", st.count);

await setFind("(unclosed");
st = await barState();
ok("3c invalid regex paints the input red, count explains, no throw", st.err && /bad pattern/i.test(st.count), st.count);

await setFind("lo(r)em");
await setRepl("$1X"); // $1 → 'r' (so 'lorem' → 'rX')
await p.keyboard.press("F3"); // from the tail match, next wraps to match 1
let s5 = await sel();
ok("3d regex match selected before replace", s5[0] === 0 && s5[1] === 5, JSON.stringify(s5));

// ---------------------------------------------------------------------------
// CASE 4 — replace: one undo step, regex $1 substitution, advances to next
// ---------------------------------------------------------------------------
await p.evaluate(() => { document.querySelector('.findbar [data-fa="replace"]').click(); });
await sleep(S);
const afterRep = await p.evaluate(() => window.editor.getDocumentText());
ok("4a $1 substitution produced 'rX' for the first 'lorem'", /^rX ipsum/.test(afterRep), afterRep.split("\n")[0]);
st = await barState();
ok("4b count moved on to the next match (1/5 after replace)", st.count === "1/5", st.count);

await p.keyboard.press("Control+z");
await sleep(S);
const undone = await p.evaluate(() => window.editor.getDocumentText());
ok("4c Ctrl+Z reverts the replacement in ONE step", /^lorem ipsum/.test(undone), undone.split("\n")[0]);

// ---------------------------------------------------------------------------
// CASE 5 — replace-all: one undo step for the whole batch
// Replacement is "xx" so the post-state matches NOTHING (a "LOREM" replacement
// would still case-fold-match the query and legitimately keep 6 matches).
// ---------------------------------------------------------------------------
await setFind("lorem");
await setRepl("xx");
await p.evaluate(() => { document.querySelector('.findbar [data-fa="replaceall"]').click(); });
await sleep(S);
const afterAll = await p.evaluate(() => window.editor.getDocumentText());
ok("5a replace-all rewrote every 'lorem' (fence included — it IS text)",
   (afterAll.match(/lorem/gi) || []).length === 0 && (afterAll.match(/xx/g) || []).length === 6,
   JSON.stringify({ lorem: (afterAll.match(/lorem/gi) || []).length, xx: (afterAll.match(/xx/g) || []).length }));
st = await barState();
ok("5b count is 0/0 after replace-all", st.count === "0/0", st.count);
await p.keyboard.press("Control+z");
await sleep(S);
const undoneAll = await p.evaluate(() => window.editor.getDocumentText());
ok("5c ONE Ctrl+Z reverts the whole batch", (undoneAll.match(/lorem/gi) || []).length === 6, JSON.stringify((undoneAll.match(/lorem/gi) || []).length));

// ---------------------------------------------------------------------------
// CASE 6 — literal special chars + selection prefill + tab switching
// ---------------------------------------------------------------------------
await setFind("a[m]");
st = await barState();
ok("6a literal mode treats regex chars literally (0 matches)", st.count === "0/0", st.count);

// Select a single-line word in the editor, then Ctrl+F → prefilled query.
await p.evaluate(() => {
  const d = window.editor.activeTab;
  const at = d.input.value.indexOf("ipsum");
  d.input.focus();
  d.input.setSelectionRange(at, at + 5);
});
await p.keyboard.press("Control+f");
st = await barState();
ok("6b opening with a selection pre-fills the find input", st.find === "ipsum", st.find);

// Tab switch with the bar OPEN: recomputes against the fresh (empty) tab.
await p.keyboard.press("Control+t");
await sleep(S);
st = await barState();
ok("6c bar recomputes on tab switch (open, 0/0 on the fresh tab)", st.open && st.count === "0/0", st.count);
await p.keyboard.press("Control+w"); // close the empty tab again
await sleep(S);

// Editor typing while the bar is open updates the count live (refresh → recompute).
// The caret is parked at the doc END first: revealCurrent (from the query edit)
// selected the 'tail' match, and typing over a selection REPLACES it.
await setFind("tail");
await p.evaluate(() => {
  const d = window.editor.activeTab;
  d.input.focus();
  const end = d.input.value.length;
  d.input.setSelectionRange(end, end);
});
await p.keyboard.type("x", { delay: 10 });
st = await barState();
ok("6d typing in the editor keeps the count live (1/1 for 'tail')", st.count === "1/1", st.count);

// ---------------------------------------------------------------------------
// CASE 7 — the synthetic caret: visible while the bar holds focus, hidden
// when the editor is focused (its real caret takes over) or the bar closes.
// ---------------------------------------------------------------------------
// 6d left focus in the editor — focus the bar's find input, then navigate:
// the caret element must appear inside the ACTIVE tab's editor column.
await p.evaluate(() => { document.querySelector('.findbar [data-f="find"]').focus(); });
await p.keyboard.press("F3");
st = await barState();
const caretOn = await p.evaluate(() => {
  const el = document.querySelector(".find-caret");
  const wrap = document.querySelector(".find-match-wrap");
  const col = window.editor.activeTab.editor.parentNode;
  return {
    caret: !el ? null : { display: el.style.display, inEditorCol: el.parentNode.className === "editor-col",
      activeCol: el.parentNode === col, h: Math.round(el.getBoundingClientRect().height) },
    match: !wrap ? null : { display: wrap.style.display, inEditorCol: wrap.parentNode === col,
      rects: wrap.querySelectorAll(".find-match").length },
  };
});
ok("7a navigating keeps focus in the bar AND paints the synthetic caret",
   st.focused === "find" && caretOn && caretOn.caret.display === "block" && caretOn.caret.inEditorCol && caretOn.caret.activeCol && caretOn.caret.h > 10,
   JSON.stringify({ focused: st.focused, caret: caretOn && caretOn.caret }));
ok("7a2 the current match is HIGHLIGHTED on the overlay (engine-independent)",
   caretOn && caretOn.match.display === "block" && caretOn.match.inEditorCol && caretOn.match.rects >= 1,
   JSON.stringify(caretOn && caretOn.match));

// Clicking into the editor hides the synthetic caret (the real caret shows).
await p.evaluate(() => { window.editor.activeTab.input.focus(); });
await sleep(120);
const caretHidden = await p.evaluate(() => ({
  caret: (() => { const el = document.querySelector(".find-caret"); return !el || el.style.display === "none"; })(),
  match: (() => { const w = document.querySelector(".find-match-wrap"); return !w || w.style.display === "none"; })(),
}));
ok("7b focusing the editor hides BOTH (real selection/caret take over)", caretHidden.caret && caretHidden.match, JSON.stringify(caretHidden));

// Clicking back into the bar's find input restores them.
await p.evaluate(() => { document.querySelector('.findbar [data-f="find"]').focus(); });
await sleep(120);
const caretBack = await p.evaluate(() => ({
  caret: (() => { const el = document.querySelector(".find-caret"); return !!el && el.style.display === "block"; })(),
  match: (() => { const w = document.querySelector(".find-match-wrap"); return !!w && w.style.display === "block"; })(),
}));
ok("7c focusing the bar restores the highlight and the caret", caretBack.caret && caretBack.match, JSON.stringify(caretBack));

// Closing the bar hides it for good.
await p.keyboard.press("Escape");
await sleep(120);
const caretGone = await p.evaluate(() => ({
  caret: (() => { const el = document.querySelector(".find-caret"); return !el || el.style.display === "none"; })(),
  match: (() => { const w = document.querySelector(".find-match-wrap"); return !w || w.style.display === "none"; })(),
}));
ok("7d closing the bar hides the highlight and the caret", caretGone.caret && caretGone.match, JSON.stringify(caretGone));

// Reopening with the PERSISTED query selects the current match immediately —
// the selected text must equal the query itself ("tail" is the only match).
await p.keyboard.press("Control+f");
await sleep(150);
const selText = await p.evaluate(() => {
  const d = window.editor.activeTab;
  return d.input.value.slice(d.input.selectionStart, d.input.selectionEnd);
});
ok("7e reopening with an existing query SELECTS the current match", selText === "tail", JSON.stringify(selText));
await p.keyboard.press("Escape"); // clean state for case 8
await sleep(120);

// ---------------------------------------------------------------------------
// CASE 8 — Esc STAY-PUT: navigating to a match and pressing Esc must NOT
// jump the view back to the pre-search position (the reported bug). With no
// current match, Esc restores the pre-open caret (the old nicety).
// ---------------------------------------------------------------------------
await p.evaluate(() => {
  const ed = window.editor;
  const para = "Filler paragraph for scroll depth without the keyword. ";
  const lines = [];
  for (let i = 0; i < 40; i++) {
    lines.push("## Section " + i + "\n\n" + para.repeat(3));
    if (i === 0) lines.push("\n\nneedle one right up top\n\n");
    if (i === 20) lines.push("\n\nneedle two far far down\n\n");
  }
  ed.setDocumentText(lines.join("\n"));
});
await sleep(S);
await p.evaluate(() => { const d = window.editor.activeTab; d.input.focus(); d.input.setSelectionRange(0, 0); });
await p.keyboard.press("Control+f");
await p.keyboard.type("needle");
await sleep(150);
await p.keyboard.press("F3"); // typing auto-selected match 1 (near top); F3 → match 2 far down
await sleep(200);
const beforeEsc = await p.evaluate(() => {
  const d = window.editor.activeTab;
  return {
    st: Math.round(d.editorScroll.scrollTop),
    sel: [d.input.selectionStart, d.input.selectionEnd],
    needle2: d.input.value.lastIndexOf("needle"),
  };
});
ok("8a navigation landed on the second needle (scrolled down)", beforeEsc.sel[0] === beforeEsc.needle2 && beforeEsc.st > 0, JSON.stringify(beforeEsc));
await p.keyboard.press("Escape");
await sleep(200);
const afterEsc = await p.evaluate(() => {
  const d = window.editor.activeTab;
  return {
    st: Math.round(d.editorScroll.scrollTop),
    sel: [d.input.selectionStart, d.input.selectionEnd],
    focused: document.activeElement === d.input,
  };
});
ok("8b Esc does NOT jump the view (scrollTop unchanged ±2)", Math.abs(afterEsc.st - beforeEsc.st) <= 2, JSON.stringify({ before: beforeEsc.st, after: afterEsc.st }));
ok("8c Esc leaves the found word SELECTED (highlighted) and the editor focused",
   afterEsc.sel[0] === beforeEsc.sel[0] && afterEsc.sel[1] === beforeEsc.sel[1] && afterEsc.focused, JSON.stringify(afterEsc));

// No-match Esc: the pre-open caret is restored (the old nicety, kept).
await p.evaluate(() => { const d = window.editor.activeTab; d.input.setSelectionRange(0, 0); });
await p.keyboard.press("Control+f");
await p.keyboard.type("zzz-no-match");
await sleep(150);
await p.keyboard.press("Escape");
await sleep(150);
const noMatch = await p.evaluate(() => {
  const d = window.editor.activeTab;
  return [d.input.selectionStart, d.input.selectionEnd];
});
ok("8d with 0 matches, Esc restores the pre-open caret (collapsed at 0)", noMatch[0] === 0 && noMatch[1] === 0, JSON.stringify(noMatch));

// With the search window CLOSED, Esc CLEARS any selected text (the global
// Escape rule): select a word, press Esc → collapsed caret at the end.
await p.evaluate(() => {
  const d = window.editor.activeTab;
  const at = d.input.value.lastIndexOf("needle");
  d.input.focus();
  d.input.setSelectionRange(at, at + 6); // forward selection of "needle"
});
await sleep(100);
await p.keyboard.press("Escape"); // bar is closed here — the global rule applies
await sleep(150);
const cleared = await p.evaluate(() => {
  const d = window.editor.activeTab;
  return [d.input.selectionStart, d.input.selectionEnd];
});
ok("8e Esc with no search window CLEARS the selection (collapsed at its end)",
   cleared[0] === cleared[1] && cleared[0] > 0, JSON.stringify(cleared));

// ---------------------------------------------------------------------------
// CASE 9 — split view: the PREVIEW pane follows the editor's reveal scroll.
// Jumping to a match far down must bring BOTH panes there — the bar's
// programmatic editor write drives the preview through the same
// block-anchored followScroll machinery a real editor scroll uses (the
// reported gap: the preview used to sit still while the editor hopped
// between hits).
// ---------------------------------------------------------------------------
await p.evaluate(() => {
  const ed = window.editor;
  const para = "Filler paragraph for scroll depth without the keyword. ";
  const lines = [];
  for (let i = 0; i < 40; i++) {
    lines.push("## Section " + i + "\n\n" + para.repeat(3));
    if (i === 0) lines.push("\n\nneedle one right up top\n\n");
    if (i === 20) lines.push("\n\nneedle two far far down\n\n");
  }
  ed.setDocumentText(lines.join("\n"));
});
await sleep(S);
const mode9 = await p.evaluate(() => window.editor.workspace.closest(".app").dataset.mode);
const parked = await p.evaluate(() => {
  const d = window.editor.activeTab;
  d.editorScroll.scrollTop = 0;
  d.previewScroll.scrollTop = 0;
  d.input.focus();
  d.input.setSelectionRange(0, 0);
  const pv = d.previewScroll;
  return { mode: window.editor.workspace.closest(".app").dataset.mode,
           pvMax: Math.round(pv.scrollHeight - pv.clientHeight) };
});
ok("9-pre split mode with a scrollable preview", mode9 === "split" && parked.pvMax > 400, JSON.stringify(parked));
await p.keyboard.press("Control+f");
await p.keyboard.type("needle");
await sleep(150);
await p.keyboard.press("F3"); // jump to the FAR match (needle two, section 20)
await sleep(900); // let the follower glide land (cap ~0.8s)
const follow = await p.evaluate(() => {
  const d = window.editor.activeTab;
  const pv = d.previewScroll;
  const pvRect = pv.getBoundingClientRect();
  let hit = false;
  for (const el of d.preview.querySelectorAll("p")) {
    if (!el.textContent.includes("needle two far far down")) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom > pvRect.top && r.top < pvRect.bottom) { hit = true; break; }
  }
  return {
    edSt: Math.round(d.editorScroll.scrollTop),
    pvSt: Math.round(pv.scrollTop),
    pvMax: Math.round(pv.scrollHeight - pv.clientHeight),
    hit,
  };
});
ok("9a jumping to the far match scrolled BOTH panes (preview follows the reveal)",
   follow.edSt > 0 && follow.pvSt > follow.pvMax * 0.3, JSON.stringify(follow));
ok("9b the found paragraph is visible in the preview pane after the jump", follow.hit, JSON.stringify(follow));

await p.keyboard.press("Shift+F3"); // wrap back to the TOP needle
await sleep(900);
const back = await p.evaluate(() => {
  const d = window.editor.activeTab;
  const pv = d.previewScroll;
  const pvRect = pv.getBoundingClientRect();
  let hit = false;
  for (const el of d.preview.querySelectorAll("p")) {
    if (!el.textContent.includes("needle one right up top")) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom > pvRect.top && r.top < pvRect.bottom) { hit = true; break; }
  }
  return { pvSt: Math.round(pv.scrollTop), pvMax: Math.round(pv.scrollHeight - pv.clientHeight), hit };
});
ok("9c stepping back re-follows the preview toward the top",
   back.pvSt < back.pvMax * 0.15 && back.hit, JSON.stringify(back));

await p.keyboard.press("Escape"); // clean state for anything after
await sleep(120);

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
console.log(`\n${pass} ok / ${fail} fail`);
await b.close();
process.exit(fail ? 1 : 0);
