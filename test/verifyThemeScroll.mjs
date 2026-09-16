/**
 * verifyThemeScroll.mjs — theme-switch scroll preservation regression.
 *
 * Changing light/dark CSS must not move the editor or preview away from the
 * document position currently being viewed. Run with `npm run verify-themescroll`.
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

await scrollBoth(0.35); await sleep(100);
const beforeDark = await ratios();
await page.click('[data-action="theme"]'); await sleep(250);
const afterDark = await ratios();
ok("editor stays at its position after switching dark", closeEnough(afterDark[0], beforeDark[0]), `was ${beforeDark[0].toFixed(3)} now ${afterDark[0].toFixed(3)}`);
ok("preview stays at its position after switching dark", closeEnough(afterDark[1], beforeDark[1]), `was ${beforeDark[1].toFixed(3)} now ${afterDark[1].toFixed(3)}`);

await scrollBoth(0.72); await sleep(100);
const beforeLight = await ratios();
await page.click('[data-action="theme"]'); await sleep(250);
const afterLight = await ratios();
ok("editor stays at its position after switching light", closeEnough(afterLight[0], beforeLight[0]), `was ${beforeLight[0].toFixed(3)} now ${afterLight[0].toFixed(3)}`);
ok("preview stays at its position after switching light", closeEnough(afterLight[1], beforeLight[1]), `was ${beforeLight[1].toFixed(3)} now ${afterLight[1].toFixed(3)}`);

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
console.log(`\n${pass} ok / ${fail} fail`);
await browser.close();
try { process.kill(-server.pid); } catch { /* already dead */ }
if (errors.length) fail = 1;
process.exit(fail ? 1 : 0);
