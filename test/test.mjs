/**
 * test.mjs — round-trip invariant test suite (Node, no browser).
 *
 * Strips every `<span>` out of the highlight overlay HTML and asserts the
 * result reproduces the exact source character-for-character. This is the
 * caret-alignment guarantee that keeps the invisible textarea caret under the
 * visible overlay. Run with `npm test`.
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
  const back = strip(m.highlightToHtml(src));
  if (back !== src) {
    fails++;
    console.error("MISMATCH", JSON.stringify(src), "->", JSON.stringify(back));
  }
}
if (fails === 0) {
  console.log(`OK ${cases.length} round-trip cases`);
} else {
  console.error(`${fails} case(s) FAILED`);
  process.exit(1);
}
