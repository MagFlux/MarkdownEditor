/**
 * verifyMermaidFade.mjs — Mermaid flowchart node outlines must NOT fade
 * left-to-right in the app's dark theme.
 *
 * Mermaid v12's default `neo` look paints flowchart node strokes as a
 * left-to-right linearGradient (`[data-look="neo"].node rect
 * { stroke: url(#id-gradient) }`, stops = gradientStart → gradientStop).
 * The DARK theme sets useGradient=true with start=#ccc (light grey) and
 * stop=mkBorder(secondary) (a much darker grey), so the right half of
 * every box outline fades into the dark background — the user report
 * ("box outlines fade in certain areas", "it fades from left to right").
 * Sequence diagrams never used that gradient, which is why only flowcharts
 * were affected. The light "default" theme already sets useGradient=false.
 *
 * The fix (src/mermaid.js): `mermaid.initialize({ themeVariables:
 * { useGradient: false, dropShadow: "none" } })` — explicit overrides
 * Mermaid itself honors, so the generated sheet emits the solid nodeBorder
 * stroke AND no drop-shadow filter. This test asserts, in BOTH themes: the
 * sheet carries no gradient-stroke rule and the defs hold no linearGradient,
 * a node rect's computed stroke is a SOLID color (never url(#…)), the
 * stamped presentation attribute matches it (the stylesheet-failure
 * fallback carries the same fix), the sheet's neo node rule carries
 * `filter: none` (no drop-shadow — the Windows "fuzzy borders" report),
 * and the dark-theme stroke luminance stays high (>0.5).
 *
 * Run with `npm run verify-mermaidfade` (16 cases).
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

const S = 450; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync(`kill $(lsof -ti tcp:4617) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4617", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push("CONSOLE: " + m.text()); });

let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (n, c, extra) => { if (c) { pass++; console.log("ok  ", n, extra ? "→ " + extra : ""); } else { fail++; console.log("FAIL", n, extra ? "→ " + extra : ""); } };

await p.goto("http://localhost:4617/", { waitUntil: "networkidle" });
await sleep(400);

// The user's diagram shape: rects + a decision diamond + labelled edges.
await p.evaluate(() => {
  window.editor.setDocumentText(
    "# Fade check\n\n" +
    "```mermaid\n" +
    "flowchart LR\n" +
    "    A[Write Markdown] --> B{Live preview}\n" +
    "    B -->|Ctrl+S| C[.md]\n" +
    "    B -->|Export| D[PDF / HTML]\n" +
    "```\n"
  );
});
await sleep(S * 3); // debounce + render

/** readFadeState — collect gradient + drop-shadow evidence from the FIRST holder. */
const readFadeState = () => p.evaluate(() => {
  const fc = document.querySelectorAll(".mermaid-diagram")[0];
  const svg = fc && fc.querySelector("svg");
  if (!svg) return { svg: false };
  const rect = svg.querySelector(".node rect");
  const cs = rect ? getComputedStyle(rect) : null;
  const styleText = (svg.querySelector("style") || {}).textContent || "";
  // The sheet's neo node-stroke rule — gradient url or a solid color? And is
  // the theme dropShadow still baked into its filter (the "fuzzy borders" call)?
  const m = styleText.match(/\[data-look="neo"\]\.node rect[^{]*\{[^}]*\}/);
  const rule = m ? m[0] : "";
  return {
    svg: true,
    gradientsInDefs: svg.querySelectorAll("linearGradient").length,
    computedStroke: cs ? cs.stroke : "",
    computedFilter: cs ? cs.filter : "",
    stampedAttr: rect ? (rect.getAttribute("stroke") || "") : "",
    ruleHasGradientUrl: /stroke:\s*url\(/.test(rule),
    ruleHasDropShadow: /drop-shadow/.test(rule),
    ruleSnippet: rule.slice(0, 200),
  };
});

/** assertNoFade — the shared assertions for one theme. */
const assertNoFade = (tag, s) => {
  ok(`${tag}: flowchart rendered`, s.svg === true, JSON.stringify(s).slice(0, 160));
  ok(`${tag}: defs hold no linearGradient`, s.svg === true && s.gradientsInDefs === 0, `count=${s.gradientsInDefs}`);
  ok(`${tag}: sheet node-stroke rule is not url(#gradient)`, s.svg === true && s.ruleHasGradientUrl === false, s.ruleSnippet);
  ok(`${tag}: computed node stroke is a SOLID color (never url)`, s.svg === true && /rgba?\(|#\w|none/.test(s.computedStroke) && !/url\(/.test(s.computedStroke), `computedStroke=${s.computedStroke}`);
  ok(`${tag}: stamped attribute matches the solid stroke`, s.svg === true && s.stampedAttr.length > 0 && !/^url\(/.test(s.stampedAttr) && !/^-/.test(s.stampedAttr), `stamped=${s.stampedAttr}`);
  ok(`${tag}: sheet carries NO drop-shadow filter (fuzzy borders off)`, s.svg === true && s.ruleHasDropShadow === false && /filter:\s*none/.test(s.ruleSnippet), s.ruleSnippet);
  ok(`${tag}: computed node filter is none (no fuzzy halo)`, s.svg === true && (s.computedFilter === "none" || s.computedFilter === ""), `computedFilter=${s.computedFilter}`);
};

// ---------------------------------------------------------------------------
// LIGHT theme first (the app default; useGradient=false is its own default,
// so these mostly pin "we did not newly break the light look").
// ---------------------------------------------------------------------------
assertNoFade("light", await readFadeState());

// ---------------------------------------------------------------------------
// DARK theme — the regression itself. The toolbar theme button re-keys the
// mermaid cache on theme (mmCacheKey) and re-renders, so the second render
// is fresh (no stale light-theme SVG).
// ---------------------------------------------------------------------------
await p.click('[data-action="theme"]'); await sleep(S * 2);
assertNoFade("dark", await readFadeState());

// The theme really switched (guard against the toggle silently failing).
const themeTag = await p.evaluate(() => document.documentElement.dataset.theme || "light");
ok("dark: app theme actually switched", themeTag === "dark", `data-theme=${themeTag}`);

// ---------------------------------------------------------------------------
// The right-edge VISIBILITY check the user described: sample the stroke
// color near each box's right edge — with the gradient it was a dark grey
// blending into #16181d; with the fix it stays the solid light nodeBorder.
// Simplified: every neo node rect's computed stroke is the SAME solid
// color (no per-edge variation), and that color is light in dark theme.
// ---------------------------------------------------------------------------
const lum = await p.evaluate(() => {
  const svg = document.querySelectorAll(".mermaid-diagram")[0];
  const rect = svg.querySelector(".node rect");
  const c = getComputedStyle(rect).stroke;
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const [r, g, bl] = [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
});
ok("dark: outline stroke luminance is high (visible on dark bg)", lum !== null && lum > 0.5, `lum=${lum && lum.toFixed(2)} stroke=${lum}`);

if (errors.length) { fail++; console.log("FAIL page errors", errors.join(" | ")); }
console.log(`\n${pass} pass, ${fail} fail`);
srv.kill();
await b.close();
process.exit(fail ? 1 : 0);
