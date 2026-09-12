// Round-trip invariant test: stripping all <span> tags out of the highlighted
// overlay must reproduce the exact source (caret-alignment guarantee).
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
globalThis.window = { __TAURI__: false, addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const m = await import("../src/markdown.js");

const decode = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, "\"");
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
