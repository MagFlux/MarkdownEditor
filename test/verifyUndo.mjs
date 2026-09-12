import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

const S = 900; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Self-contained: build, then serve the built output on an isolated port (idempotent)
try { execSync(`kill $(lsof -ti tcp:4299) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4299", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("ok  ", n); } else { fail++; console.log("FAIL", n); } };
const val = () => p.locator("textarea.input:visible").last().inputValue();
const undoEn = () => p.locator('button[data-action="undo"]').isEnabled();
const redoEn = () => p.locator('button[data-action="redo"]').isEnabled();
const newTab = async (n) => { await p.evaluate((nn) => window.editor.newTab("T" + nn, ""), n); await sleep(400); };
const type = async (txt) => { await p.locator("textarea.input:visible").last().click(); await p.keyboard.type(txt); await sleep(S); };

await p.goto("http://localhost:4299/", { waitUntil: "networkidle" });
await sleep(600);

// Phase 1: type -> undo -> redo
await newTab(1);
await type("hello world ");
ok("1a type -> value", (await val()) === "hello world ");
ok("1b type -> undo enabled", await undoEn());
await p.keyboard.press("Control+z"); await sleep(300);
ok("1c type -> undo empties", (await val()) === "");
ok("1d type -> redo enabled", await redoEn());
await p.keyboard.press("Control+Shift+z"); await sleep(300);
ok("1e type -> redo restores", (await val()) === "hello world ");

// Phase 2: type then Bold -> two undos separate the steps
await newTab(2);
await type("bold me ");
await p.locator('button[data-fmt="bold"]:visible').first().click(); await sleep(300);
ok("2a format applied", (await val()) === "bold **me** ");
await p.keyboard.press("Control+z"); await sleep(300);
ok("2b undo format", (await val()) === "bold me ");
await p.keyboard.press("Control+z"); await sleep(300);
ok("2c undo typing", (await val()) === "");

// Phase 3: coalescing = ONE undo step for a burst
await newTab(3);
await type("one two three ");
await p.keyboard.press("Control+z"); await sleep(300);
ok("3 one undo removes whole burst", (await val()) === "");

// Phase 4: toolbar buttons
await newTab(4);
await type("via button ");
await p.locator('button[data-action="undo"]').click(); await sleep(300);
ok("4a undoBtn click works", (await val()) === "");
await p.locator('button[data-action="redo"]').click(); await sleep(300);
ok("4b redoBtn click works", (await val()) === "via button ");

console.log(`\nPASS ${pass} / FAIL ${fail}`);
await b.close();
try { process.kill(-srv.pid); } catch { /* already dead */ }
if (errors.length) { console.log("PAGE ERRORS:", errors); fail++; }
process.exit(fail ? 1 : 0);
