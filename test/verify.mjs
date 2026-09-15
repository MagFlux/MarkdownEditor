/**
 * verify.mjs — UI smoke test (Playwright, Chromium).
 *
 * Exercises the basic multi-tab editor: tab create/switch/close, undo/redo,
 * the overlay highlight layer, and table rendering. Run with `npm run verify`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Screenshot output lives in <repo>/test/verify/; make sure it exists.
const HERE = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(HERE, "verify"), { recursive: true });

// Kill any preview server left over from a previous run (keeps `npm run verify` idempotent)
try { execSync(`kill $(lsof -ti tcp:4199) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }

execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4199"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({ });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

await page.goto("http://localhost:4199/");
await page.waitForTimeout(400);

const SHOT_DIR = join(HERE, "verify");
/** shot — capture a full-page screenshot as `${n}.png` in the verify dir. */
const shot = (n) => page.screenshot({ path: join(SHOT_DIR, `${n}.png`), fullPage: true });

// 1. initial render
await shot("01-initial");
const tabs = await page.locator(".tab").count();
console.log("initial tabs:", tabs);

// 2. new tab via Ctrl+T
const input = page.locator(".pane-group.active textarea.input");
await input.focus();
await page.keyboard.press("Control+t");
await page.waitForTimeout(100);
console.log("after ctrl+t tabs:", await page.locator(".tab").count());
await shot("02-second-tab");
const activeName = await page.locator(".tab.active .tname").textContent();
console.log("active tab name:", activeName);

// 3. type into second tab, underline via Ctrl+U
await page.keyboard.type("hello");
await page.keyboard.press("Control+u");
await page.waitForTimeout(100);
const v = await input.inputValue();
console.log("after ctrl+u value:", JSON.stringify(v));
await shot("03-underline");

// 4. table toggle
await page.keyboard.press("End");
await page.keyboard.press("Enter");
await input.click();
await page.locator('button[data-block="table"]').click();
await page.waitForTimeout(100);
await shot("04-table");
const v2 = await input.inputValue();
console.log("table present:", v2.includes("| -------- |"));

// 5. undo / redo
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
await page.waitForTimeout(100);
const afterUndo = await input.inputValue();
console.log("table gone after undo:", !afterUndo.includes("| -------- |"));
await page.keyboard.down("Control"); await page.keyboard.press("y"); await page.keyboard.up("Control");
await page.waitForTimeout(100);
console.log("table back after redo:", (await input.inputValue()).includes("| -------- |"));
await shot("05-redo");

// 6. tab switching: type in tab 1, verify independent
await page.locator(".tab").first().locator(".tname").click();
await page.waitForTimeout(100);
const v3 = await input.inputValue();
console.log("tab1 still has sample (no table):", !v3.includes("| -------- |"));
await shot("06-tab1");

// 7. active-tab preview shows underline + table (scope to active pane)
await page.locator(".tab").nth(1).locator(".tname").click(); // ensure 2nd tab active
await page.waitForTimeout(100);
const previewUnderline = await page.locator(".pane-group.active .preview u").count();
const previewTable = await page.locator(".pane-group.active .preview table").count();
console.log("active preview <u>:", previewUnderline, "active preview tables:", previewTable);

// 8. close 2nd tab (accept the unsaved-changes confirm)
page.once("dialog", (d) => d.accept());
await page.locator(".tab").nth(1).locator(".tclose").click();
await page.waitForTimeout(100);
console.log("tabs after close:", await page.locator(".tab").count());
await shot("07-closed");

console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();
try { process.kill(-srv.pid); } catch { /* already dead */ }
if (errors.length) process.exit(1);
