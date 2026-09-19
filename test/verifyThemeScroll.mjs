/**
 * verifyThemeScroll.mjs — theme-switch scroll preservation + themed-scrollbar regression.
 *
 * Changing light/dark CSS must not move the editor or preview away from the
 * document position currently being viewed. It must ALSO re-theme the scrollbar
 * palette: on a Windows/WebView host the OS default scrollbar ignores the app
 * theme (staying grey/black in both), so the app now sets `--sb`/`--sb-hi` +
 * `scrollbar-color` + `::-webkit-scrollbar-thumb` per theme. This test asserts
 * the light theme resolves to a light thumb and dark to a dark thumb.
 * Run with `npm run verify-themescroll`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try { execSync(`kill $(lsof -ti tcp:4607) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const server = spawn("npx", ["vite", "preview", "--port", "4607", "--strictPort"], {
  stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true,
});
await sleep(1800);

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push("PAGEERROR: " + error.message));
page.on("console", (message) => { if (message.type() === "error" && !/favicon/i.test(message.text())) errors.push("CONSOLE: " + message.text()); });
await page.goto("http://localhost:4607/", { waitUntil: "networkidle" });
await sleep(400);

const text = "# Theme scroll\n\n" + Array.from({ length: 180 }, (_, i) =>
  `Section ${i + 1}: ${"lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(4)}\n`).join("");
await page.evaluate((value) => window.editor.newTab("Theme", value), text);
await sleep(300);

const scrollBoth = (fraction) => page.evaluate((f) => {
  const doc = window.editor.activeTab;
  for (const pane of [doc.editorScroll, doc.previewScroll]) {
    const max = pane.scrollHeight - pane.clientHeight;
    pane.scrollTop = Math.round(max * f);
  }
}, fraction);
const ratios = () => page.evaluate(() => {
  const doc = window.editor.activeTab;
  return [doc.editorScroll, doc.previewScroll].map((pane) => {
    const max = pane.scrollHeight - pane.clientHeight;
    return max > 0 ? pane.scrollTop / max : 0;
  });
});
const closeEnough = (actual, expected) => Math.abs(actual - expected) <= 0.05;
let pass = 0, fail = 0;
const ok = (name, condition, detail = "") => {
  if (condition) { pass++; console.log("ok  ", name, detail); }
  else { fail++; console.log("FAIL", name, detail); }
};

// Resolve the scrollbar palette the editor would paint: the `--sb` thumb
// color, the standard `scrollbar-color` thumb stop, and the
// `::-webkit-scrollbar-thumb` background (the WebKit/WebView engine we ship on).
// The local lum() helper maps an rgb()/rgba() OR #hex string to 0..1 relative
// luminance so a palette can be classified "light" vs "dark" without hardcoding.
// (Note: Chromium's `getComputedStyle(el, "::-webkit-scrollbar-thumb")` returns
// the `:hover` variant, so thresholds must tolerate base vs hover — they are
// deliberately wide, sitting in the clear gap between the light and dark sets.)
const sbState = () => page.evaluate(() => {
  const root = document.documentElement;
  const lum = (c) => {
    if (typeof c !== "string") return NaN;
    let r = 0, g = 0, b = 0;
    let m = c.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (m) { [r, g, b] = [+m[1], +m[2], +m[3]]; }
    else { m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i); if (m) { let h = m[1]; if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16); } else return NaN; }
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  let webkitThumbBg = "";
  try { webkitThumbBg = getComputedStyle(document.body, "::-webkit-scrollbar-thumb").backgroundColor; } catch { /* unsupported */ }
  return {
    scheme: getComputedStyle(root).colorScheme,
    sbVar: getComputedStyle(root).getPropertyValue("--sb").trim(),
    sbLum: lum(getComputedStyle(root).getPropertyValue("--sb").trim()),
    scrollbarColor: getComputedStyle(document.body).scrollbarColor,
    webkitThumbBg,
    webkitLum: lum(webkitThumbBg),
  };
});
// Light theme paints ~0.42–0.62 lum; dark theme ~0.08–0.12. 0.30/0.25 sit in
// the gap so base-vs-hover resolution never misclassifies.
const thumbIs = (s, kind) =>
  kind === "light"
    ? (Number.isFinite(s.sbLum) && s.sbLum > 0.3) && (Number.isFinite(s.webkitLum) && s.webkitLum > 0.3)
    : (Number.isFinite(s.sbLum) && s.sbLum < 0.25) && (Number.isFinite(s.webkitLum) && s.webkitLum < 0.25);

// ---- themed scrollbars ------------------------------------------------------
// Initial theme is light (no [data-theme]): the scrollbar palette must be light
// so it blends with the white surface (on Windows the OS default would be dark).
const lightSb = await sbState();
ok("light theme: --sb thumb resolves to a light color", thumbIs(lightSb, "light"), `--sb=${lightSb.sbVar} scrollbar-color=${lightSb.scrollbarColor} webkit=${lightSb.webkitThumbBg}`);
ok("light theme: ::-webkit-scrollbar-thumb bg is light", Number.isFinite(lightSb.webkitLum) && lightSb.webkitLum > 0.3, `webkit=${lightSb.webkitThumbBg}`);
ok("light theme: standard scrollbar-color thumb is light", thumbIs(lightSb, "light") === true && /rgb/.test(lightSb.scrollbarColor), `scrollbar-color=${lightSb.scrollbarColor}`);

await scrollBoth(0.35); await sleep(100);
const beforeDark = await ratios();
await page.click('[data-action="theme"]'); await sleep(250);
const afterDark = await ratios();
ok("editor stays at its position after switching dark", closeEnough(afterDark[0], beforeDark[0]), `was ${beforeDark[0].toFixed(3)} now ${afterDark[0].toFixed(3)}`);
ok("preview stays at its position after switching dark", closeEnough(afterDark[1], beforeDark[1]), `was ${beforeDark[1].toFixed(3)} now ${afterDark[1].toFixed(3)}`);

// After flipping to dark the same palette must now be dark — the regression this
// test exists for (dark mode was previously painting a light/OS scrollbar).
const darkSb = await sbState();
ok("dark theme: --sb thumb resolves to a dark color", thumbIs(darkSb, "dark"), `--sb=${darkSb.sbVar} scrollbar-color=${darkSb.scrollbarColor} webkit=${darkSb.webkitThumbBg}`);
ok("dark theme: ::-webkit-scrollbar-thumb bg is dark", Number.isFinite(darkSb.webkitLum) && darkSb.webkitLum < 0.25, `webkit=${darkSb.webkitThumbBg}`);

await scrollBoth(0.72); await sleep(100);
const beforeLight = await ratios();
await page.click('[data-action="theme"]'); await sleep(250);
const afterLight = await ratios();
ok("editor stays at its position after switching light", closeEnough(afterLight[0], beforeLight[0]), `was ${beforeLight[0].toFixed(3)} now ${afterLight[0].toFixed(3)}`);
ok("preview stays at its position after switching light", closeEnough(afterLight[1], beforeLight[1]), `was ${beforeLight[1].toFixed(3)} now ${afterLight[1].toFixed(3)}`);

// Round trip back to light: palette returns to light.
const backLight = await sbState();
ok("back to light: --sb thumb resolves to a light color again", thumbIs(backLight, "light"), `--sb=${backLight.sbVar} webkit=${backLight.webkitThumbBg}`);

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
console.log(`\n${pass} ok / ${fail} fail`);
await browser.close();
try { process.kill(-server.pid); } catch { /* already dead */ }
if (errors.length) fail = 1;
process.exit(fail ? 1 : 0);
