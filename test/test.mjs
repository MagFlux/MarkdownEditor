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
