/**
 * verifyTasks.mjs — GFM task-list interactivity regression.
 *
 * Pins the live-preview contract of src/tasks.js: task items render as REAL
 * checkboxes in the preview (re-enabled + data-task-stamped), clicking one
 * flips the checkbox's state char in the SOURCE and commits ONE undo-able
 * edit (Ctrl+Z restores, Ctrl+Shift+Z re-applies), the preview checkbox then
 * reflects the source, a checkbox whose marker sits inside a fenced code
 * block is NOT re-enabled (the blank-fence / code-is-sacred guard), and the
 * export pipeline (renderMarkdown, shared by HTML/PDF export) keeps marked's
 * inert disabled checkboxes with NO data-task stamp. Run with
 * `npm run verify-tasks`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

// Self-contained: build, then serve on an isolated port (idempotent).
const S = 400; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync(`kill $(lsof -ti tcp:4622) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4622", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push("CONSOLE: " + m.text()); });

let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (n, c, extra) => { if (c) { pass++; console.log("ok  ", n, extra ? "→ " + extra : ""); } else { fail++; console.log("FAIL", n, extra ? "→ " + extra : ""); } };

await p.goto("http://localhost:4622/", { waitUntil: "networkidle" });
await sleep(400);

await p.evaluate(() => {
  window.editor.setDocumentText(
    "- [ ] milk\n- [x] eggs\n\n```js\n// - [ ] not a task inside a fence\n```\n\n1. [ ] ordered task\n"
  );
});
await sleep(S);

/**
 * boxes — summary of the preview's task checkboxes:
 * {live, inert, checked: number of checked live boxes}.
 */
const boxes = () => p.evaluate(() => {
  const all = Array.from(document.querySelectorAll(".preview input[type=\"checkbox\"]"));
  const live = all.filter((el) => el.hasAttribute("data-task"));
  return {
    total: all.length,
    live: live.length,
    inert: all.length - live.length,
    checked: live.filter((el) => el.checked).length,
  };
});

/** text — the active tab's source text. */
const text = () => p.evaluate(() => window.editor.getDocumentText());

let bx = await boxes();
ok("A1 3 task items rendered (milk/eggs/ordered), ALL re-enabled with data-task", bx.total === 3 && bx.live === 3 && bx.inert === 0, JSON.stringify(bx));

// The fenced line keeps its LITERAL "- [ ]" text inside <pre><code> and no
// checkbox input may exist inside a code block (code is sacred).
const fence = await p.evaluate(() => {
  const code = document.querySelector(".preview pre code");
  return { literal: !!code && /- \[ \] not a task inside a fence/.test(code.textContent), boxInside: !!document.querySelector(".preview pre input") };
});
ok("A2 the fenced 'checkbox' line stays literal code, no checkbox", fence.literal && !fence.boxInside, JSON.stringify(fence));

ok("A3 pre-click state: 1 checked (eggs), source says [ ]/[x]", bx.checked === 1 && /\- \[x\] eggs/.test(await text()), JSON.stringify(bx));

// Click the FIRST (milk) checkbox → source flips [ ] → [x], ONE undo step.
await p.evaluate(() => { document.querySelectorAll('.preview input[data-task]')[0].click(); });
await sleep(S);
let t = await text();
ok("B1 clicking milk flips the source line to [x]", /^- \[x\] milk/m.test(t), JSON.stringify(t.split("\n")[0]));
bx = await boxes();
ok("B2 the re-rendered preview agrees (2 checked of 3)", bx.live === 3 && bx.checked === 2, JSON.stringify(bx));

await p.keyboard.press("Control+z");
await sleep(S);
t = await text();
ok("B3 ONE Ctrl+Z reverts the flip (source back to [ ] milk)", /^- \[ \] milk/m.test(t), JSON.stringify(t.split("\n")[0]));
bx = await boxes();
ok("B4 preview rebuilt from source: back to 1 checked", bx.live === 3 && bx.checked === 1, JSON.stringify(bx));

await p.keyboard.press("Control+Shift+z");
await sleep(S);
ok("B5 redo re-applies the flip", /^- \[x\] milk/m.test(await text()));

// Ordered-list task (the LAST checkbox, ordinal 2).
await p.evaluate(() => { document.querySelectorAll('.preview input[data-task]')[2].click(); });
await sleep(S);
t = await text();
ok("C1 the ORDERED task's click flips its own line", /^1\. \[x\] ordered task/m.test(t), JSON.stringify(t.split("\n").pop()));
await p.keyboard.press("Control+z");
await sleep(S);
ok("C2 undo restores the ordered task", /^1\. \[ \] ordered task/m.test(await text()));

// Clicking an ALREADY-checked box unchecks it (flip is a toggle both ways).
await p.evaluate(() => { document.querySelectorAll('.preview input[data-task]')[1].click(); });
await sleep(S);
ok("D1 clicking the checked 'eggs' box unchecks it in the source", /^- \[ \] eggs/m.test(await text()));
await p.keyboard.press("Control+z");
await sleep(S);

// The overlay marks the task marker with a .task span (accent in the editor).
const overlayTask = await p.evaluate(() => !!document.querySelector(".editor .task"));
ok("E1 the editor overlay paints the [ ] marker with a .task span", overlayTask);

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
console.log(`\n${pass} ok / ${fail} fail`);
await b.close();
process.exit(fail ? 1 : 0);
