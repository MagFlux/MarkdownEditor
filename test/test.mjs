/**
 * test.mjs — round-trip invariant test suite (Node, no browser).
 *
 * Strips every `<span>` out of the highlight overlay HTML and asserts the
 * result reproduces the exact source character-for-character. This is the
 * caret-alignment guarantee that keeps the invisible textarea caret under the
 * visible overlay. Also asserts the OVERLAY STYLING for the inline tokens:
 * `<u>text</u>` must produce a `.u` span (the underline actually paints) —
 * an escaped-plain-text fallback would still round-trip, so the span check
 * is what catches a broken token match. Run with `npm test`.
 */
globalThis.document = {
  createElement: () => ({
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {},
    addEventListener() {},
    setAttribute() {},
    querySelector: () => null,
  }),
  documentElement: { dataset: {} },
  addEventListener() {},
  querySelector: () => null,
};
globalThis.window = { __TAURI__: false, addEventListener() {}, document: globalThis.document, location: { href: "about:blank" } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
// jsPDF's UMD wrapper resolves its global scope as:
//   window || global || self || this
// and then calls `r.atob.bind(r)` / `r.btoa.bind(r)`. Since this test
// defines a fake `globalThis.window` (to stub the browser environment),
// jsPDF picks *that* object — which would otherwise lack `atob`/`btoa`.
// Add them to the fake window so jsPDF's UMD init succeeds under Node.
globalThis.window.atob = (b64) => Buffer.from(b64, "base64").toString("binary");
globalThis.window.btoa = (bin) => Buffer.from(bin, "binary").toString("base64");

const m = await import("../src/markdown.js");

/** decode — un-escape the HTML entities the overlay renderer may emit. */
const decode = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, "\"");

/** strip — remove every overlay `<span>` wrapper; the result must equal the source. */
const strip = (h) => decode(h.replace(/<span class="[^"]*">/g, "").replace(/<\/span>/g, ""));

const cases = [
  "**b**",
  "*i*",
  "~~s~~",
  "`c`",
  "<u>u</u>",
  "<u>multi word</u>",
  "with live <u>formatting</u>.",
  "x <u>y</u> z **b** <u>w</u>",
  "<u></u>",
  "<u>unclosed",
  "[a](b)",
  "mix **b** *i* <u>u</u> `c` [l](u) ~~s~~",
  "# H",
  "## H2",
  "### H3",
  "> q",
  "- x",
  "1. x",
  "```\nx\n```",
  "a | b",
  "|---|---|",
  "d | e",
  "a | b | c\n| --- | --- | --- |\nd | e | f",
  "just | a | pipe\nline with | pipe",
  "",
  "plain text with no formatting",
  "$e^{i\\pi} + 1 = 0$",
  "costs $5 and $10 total",
  "$$\\Gamma(z) = \\int_0^\\infty t^{z-1}e^{-t}dt$$",
  // GFM task lists (the `.task` mark span added in render.js — see below for
  // the styling assertion; these pin the round-trip with checkbox markers).
  "- [ ] todo",
  "- [x] done",
  "1. [X] ordered",
  "> - [ ] quoted",
  "  - [x] nested",
  "- [ ] **bold** and `code` in a task",
  "- [ ]",
];

let fails = 0;
for (const src of cases) {
  const html = m.highlightToHtml(src);
  const back = strip(html);
  if (back !== src) {
    fails++;
    console.error("MISMATCH", JSON.stringify(src), "->", JSON.stringify(back));
  }
  // Styling regression (the `<u>` close-tag search): a `<u>…</u>` token with
  // non-empty inner text must render its inner text in a `.u` span — the
  // underline the editor paints. Plain `&lt;u&gt;` output round-trips fine, so
  // only this span assertion catches the token match breaking.
  if (/^<u>.+<\/u>$/i.test(src)) {
    const inner = src.replace(/^<u>/i, "").replace(/<\/u>$/i, "");
    if (!html.includes(`<span class="u">${inner}</span>`)) {
      fails++;
      console.error("NO .u SPAN for", JSON.stringify(src), "->", JSON.stringify(html));
    }
  }
  // Task-marker styling regression: a list line whose content starts with a
  // GFM checkbox must render that `[ ]`/`[x]` marker in a `.task` span (the
  // accent-colored marker the editor paints under the real preview checkbox).
  // The bracket alone would still round-trip as escaped plain text, so only
  // this span assertion catches the marker styling breaking.
  if (/^[-*+]\s\[[xX ]\]/.test(src) || /^\d+\.\s\[[xX ]\]/.test(src)) {
    const marker = src.replace(/^[-*+]\s/, "").replace(/^\d+\.\s/, "").slice(0, 3);
    if (!html.includes(`<span class="mark task">${marker}</span>`)) {
      fails++;
      console.error("NO .task SPAN for", JSON.stringify(src), "->", JSON.stringify(html));
    }
  }
}
if (fails === 0) {
  console.log(`OK ${cases.length} round-trip cases`);
} else {
  console.error(`${fails} case(s) FAILED`);
  process.exit(1);
}

/* ---------------------------------------------------------------------------
 * Math pipeline (src/math.js) — the PROTECT → PARSE → RESTORE contract.
 * These run in Node (katex.renderToString is pure), so the delimiter rules
 * are pinned here cheaply; the live-preview/export behavior is pinned by
 * test/verifyMath.mjs (Playwright). Run with `npm test`.
 * ------------------------------------------------------------------------- */
const math = await import("../src/math.js");
const { renderMarkdown, containsMath } = math;
let mathFails = 0;
/** mok — record a math-pipeline assertion. */
const mok = (label, cond, extra) => {
  if (cond) console.log("ok  ", label);
  else { mathFails++; console.error("MATH FAIL", label, extra !== undefined ? "→ " + JSON.stringify(extra) : ""); }
};
/** katexed — true when the html actually contains KaTeX output. */
const katexed = (h) => h.includes('class="katex');

// Block + inline math render; no placeholder leaks; display math is not
// stranded inside a <p> (the unwrap step).
{
  const h = renderMarkdown("# T\n\n$$\\Gamma(z) = \\int_0^\\infty t^{z-1}e^{-t}dt\\,.$$\n\nInline $e^{i\\pi}+1=0$ math.\n");
  mok("block $$ renders katex-display", h.includes("katex-display"), h.slice(0, 120));
  mok("inline $...$ renders katex", katexed(h) && !h.includes("<p><!--m"), h.slice(0, 120));
  mok("no placeholder leaks", !h.includes("<!--m"));
  mok("display math unwrapped from <p>", !/<p><span class="katex-display"/.test(h));
}
// Code regions are sacred.
mok("fence with $$ untouched", !katexed(renderMarkdown("```\n$$x$$\n```\n")));
mok("inline code with $ untouched", !katexed(renderMarkdown("a `$x^2$` b")));
mok("mermaid fence with $ untouched", !katexed(renderMarkdown("```mermaid\nA[$$x$$]\n```")));
// Pandoc-style prose rules.
mok("currency $5 and $10 stays prose", !katexed(renderMarkdown("costs $5 and $10 total")) && containsMath("costs $5 and $10 total") === false);
mok("\\$ escape stays prose", !katexed(renderMarkdown("\\$5 is money")) && containsMath("\\$5 is money") === false);
mok("unclosed $$ stays prose", !katexed(renderMarkdown("$$x^2 end")) && containsMath("$$x^2 end") === false);
// Blank-fence guard: the toolbar's fresh $$\n\n$$ scaffold shows its markers.
mok("blank $$ block stays literal", !katexed(renderMarkdown("$$\n\n$$")) && containsMath("$$\n\n$$") === false);
// Block-position rule: a mid-prose `$$` followed by whitespace (the inline
// math button's fresh EMPTY marker pair) must not pair with a later `$$`.
mok("mid-line $$x$$ is display (non-space follower)", /katex-display/.test(renderMarkdown("word $$x^2$$ end")));
mok("stray mid-prose $$ does not pair with a later block", (() => {
  const h = renderMarkdown("paid $$ today\n\n$$\nE=mc^2\n$$");
  return h.includes("paid $$ today") && /katex-display/.test(h);
})());
mok("stray $$ at EOL does not pair with a later block", (() => {
  const h = renderMarkdown("typed $$\nmore prose\n\n$$\nE=mc^2\n$$");
  return h.includes("typed $$") && /katex-display/.test(h);
})());
// Invalid LaTeX renders INLINE IN RED (throwOnError:false) — katex 0.18 emits
// the red source with color:#cc0000 (katex-error class only on hard failures).
mok("invalid latex renders in red", /#cc0000|katex-error/.test(renderMarkdown("$$\\badcmd{x}$$")));
// Math works inside lists/quotes (placeholder restore path through marked).
mok("math inside a list item", katexed(renderMarkdown("- item $a_1$ x")));
mok("math inside a blockquote", katexed(renderMarkdown("> $$q=1$$")));
mok("containsMath detects inline", containsMath("a $x^2$ b") === true);
mok("containsMath false on plain docs", containsMath("no math here, just $ signs") === false);

if (mathFails === 0) {
  console.log("OK math pipeline cases");
} else {
  console.error(`${mathFails} math case(s) FAILED`);
  process.exit(1);
}

/* ---------------------------------------------------------------------------
 * GFM task lists (src/tasks.js) — the ordinal→source mapping contract.
 * The live-preview interactivity is pinned by test/verifyTasks.mjs
 * (Playwright); these Node cases pin the mapping rules cheaply.
 * ------------------------------------------------------------------------- */
const tasks = await import("../src/tasks.js");
const { scanTaskItems, enhancePreviewTasks, toggleTaskAt } = tasks;
let taskFails = 0;
/** tok — record a task-mapping assertion. */
const tok = (label, cond, extra) => {
  if (cond) console.log("ok  ", label);
  else { taskFails++; console.error("TASK FAIL", label, extra !== undefined ? "→ " + JSON.stringify(extra) : ""); }
};

{
  const md = "- [ ] a\n- [x] b\n1. [X] c\n> - [ ] d\n  - [x] nested\n";
  const items = scanTaskItems(md);
  tok("scan maps 5 task items in document order",
      items && items.length === 5 &&
      items[0].line === 0 && items[0].checked === false &&
      items[1].line === 1 && items[1].checked === true &&
      items[2].line === 2 && items[2].checked === true &&   // ordered [X]
      items[3].line === 3 && items[3].checked === false &&  // quoted
      items[4].line === 4 && items[4].checked === true,     // nested
      JSON.stringify(items));
  const html = renderMarkdown(md);
  tok("marked renders 5 inert checkboxes", (html.match(/disabled="" type="checkbox"/g) || []).length === 5);
  tok("renderMarkdown (export path) never stamps data-task", !html.includes("data-task"));
  const enh = enhancePreviewTasks(html, md);
  tok("enhance re-enables and ordinals every checkbox", (enh.match(/data-task="\d+"/g) || []).length === 5 && !enh.includes("disabled=\"\" type=\"checkbox\""));
}
{
  // An item's continuation prose QUOTING the next item's raw must not steal
  // the mapping (the line-start verification rejects mid-line matches).
  const md = '- [ ] a\n  continued "- [ ] a" prose\n- [x] b';
  const items = scanTaskItems(md);
  tok("prose-mention does not steal the mapping", items && items.length === 2 && items[1].line === 2 && items[1].checked === true, JSON.stringify(items));
}
tok("4-space indented code is not a task", JSON.stringify(scanTaskItems("    - [ ] x\n")) === "[]", scanTaskItems("    - [ ] x\n"));
tok("plain doc maps to [] (not null)", Array.isArray(scanTaskItems("plain text, no tasks")) && scanTaskItems("plain text, no tasks here").length === 0);
{
  const md = "- [ ] one\n- [ ] two";
  const on = toggleTaskAt(md, 1, true);
  tok("toggle ON flips the state char in place", on && on.text === "- [ ] one\n- [x] two" && on.caret === 13, JSON.stringify(on));
  const on0 = toggleTaskAt(md, 0, true);
  const off0 = on0 && toggleTaskAt(on0.text, 0, false);
  tok("toggle OFF flips back ([x] → [ ])", off0 && on0.text === "- [x] one\n- [ ] two" && off0.text === md, JSON.stringify({ on0, off0 }));
  tok("toggle returns null on an out-of-range ordinal", toggleTaskAt(md, 5, true) === null);
}
{
  // Desync safety: enhancing an html against a DIFFERENT source must return
  // the html unchanged (inert) rather than stamping wrong ordinals.
  const htmlA = renderMarkdown("- [ ] a\n- [ ] b\n");
  const mdB = "- [ ] x\n";
  tok("count mismatch → html unchanged (stay inert)", enhancePreviewTasks(htmlA, mdB) === htmlA);
}

if (taskFails === 0) {
  console.log("OK task-list cases");
} else {
  console.error(`${taskFails} task case(s) FAILED`);
  process.exit(1);
}

/* ---------------------------------------------------------------------------
 * Fenced-code highlighting (src/codecolor.js via highlight.js core).
 * Node cases pin: hljs markup for registered languages, marked's exact
 * byte-shape for unregistered/unknown ones, and that NO raw `<` can ever
 * leak from a highlighted fence (hljs escapes its output). The live preview
 * + exported-HTML behavior is pinned by test/verifyCodeColor.mjs.
 * ------------------------------------------------------------------------- */
const codecolor = await import("../src/codecolor.js");
const { LANGS } = codecolor;
let ccFails = 0;
/** cok — record a code-highlighting assertion. */
const cok = (label, cond, extra) => {
  if (cond) console.log("ok  ", label);
  else { ccFails++; console.error("CODE FAIL", label, extra !== undefined ? "→ " + JSON.stringify(extra) : ""); }
};

{
  const h = renderMarkdown("```js\nconst a = 1;\n```");
  cok("js fence is highlighted with hljs spans", /class="hljs-keyword"/.test(h) && /class="hljs-number"/.test(h), h);
  cok("no raw < leaks from a highlighted fence", !/</.test(h.replace(/<[^>]*>/g, "")), h);
  cok("the language class survives (language-js)", /<code class="language-js">/.test(h));
}
{
  // Raw HTML inside a highlighted fence must stay ESCAPED (security).
  const h = renderMarkdown("```js\n// <img src=x onerror=alert(1)>\nconst s = \"<b>\";\n```");
  cok("html-looking code stays escaped in the highlight", !h.includes("<img src") && !h.includes("<b>"), h);
}
cok("unknown language keeps marked's plain escaped shape",
    renderMarkdown("```unknownlang\nkeep raw\n```") === "<pre><code class=\"language-unknownlang\">keep raw\n</code></pre>\n");
cok("no info string keeps marked's plain escaped shape",
    renderMarkdown("```\na<b & c>d\"e\n```") === "<pre><code>a&lt;b &amp; c&gt;d&quot;e\n</code></pre>\n");
cok("mermaid fence stays untouched (mermaid.js owns it)",
    renderMarkdown("```mermaid\nA-->B\n```") === "<pre><code class=\"language-mermaid\">A--&gt;B\n</code></pre>\n");
cok("math inside a fence still stays literal",
    !renderMarkdown("```js\nconst x = \"$$a$$\";\n```").includes("katex"));
cok("aliases cover common spellings",
    LANGS.includes("bash") && LANGS.includes("python") && LANGS.includes("typescript") && LANGS.includes("cpp"));
{
  // The exported standalone HTML carries the light token palette.
  const exportMod = await import("../src/export.js");
  const css = exportMod.EXPORT_PREVIEW_CSS;
  cok("EXPORT_PREVIEW_CSS styles hljs tokens", /\.hljs-keyword/.test(css) && /\.hljs-string/.test(css));
}

if (ccFails === 0) {
  console.log("OK code-highlighting cases");
} else {
  console.error(`${ccFails} code case(s) FAILED`);
  process.exit(1);
}
