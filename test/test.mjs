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
