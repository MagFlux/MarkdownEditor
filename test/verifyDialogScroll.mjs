/**
 * verifyDialogScroll.mjs — Open/Save/Export dialog scroll-preservation
 * regression (native path, stubbed IPC, REAL mouse presses).
 *
 * Pins: opening the in-app file picker (Save toolbar button, Open toolbar
 * button, Export… menu items, and their Ctrl+S/Ctrl+O keybinds) must NEVER
 * move the open document's vertical position — neither pane, while the dialog
 * is up nor after it closes. The replayed bug: the toolbar buttons' trailing
 * `activeTab.input.focus()` ran after the picker had mounted while the button
 * press had already blurred the textarea, so it was a CAUSATIVE focus move
 * whose engine caret-into-view scroll parked `.editor-scroll` at the caret —
 * the document bottom for a caret at the end (and the top for one above the
 * viewport) — and the split-view follow chain dragged the preview with it.
 * The fix: the trailing focus stands down under a `.savedlg-backdrop` and is
 * scroll-held (focusKeepScroll, preventScroll) for save/open; every in-app
 * picker runs through pickPathKeepScroll (capture pane ratios before the modal
 * exists, re-assert them — echo-stamped — after it closes, and hand typing
 * focus back with preventScroll on a cancel: a plain focus() fires the reveal
 * scroll first, which was the reported CLOSE-flicker). Run with
 * `npm run verify-dialogscroll`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

const PORT = 4627;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync(`kill $(lsof -ti tcp:${PORT}) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }

execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true,
});
await wait(1800);

const browser = await chromium.launch();
let pass = 0, fail = 0;
const err = [];
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (n, c, extra) => {
  if (c) { pass++; console.log("ok  ", n, extra !== undefined ? "→ " + extra : ""); }
  else { fail++; console.log("FAIL", n, extra !== undefined ? "→ " + extra : ""); }
};

/**
 * installInternals — stub `window.__TAURI_INTERNALS__` so the NATIVE picker
 * path (createPathPicker over plugin-fs read_dir + api/path homeDir) actually
 * runs. Fully self-contained (addInitScript serializes the function). The
 * directory map lives in `window.__dirs`, the readable file bodies in
 * `window.__bodies`, and the *existing* save targets in `window.__exists`
 * (drives the overwrite modal). Writes are recorded on `window.__state.writes`.
 */
function installInternals() {
  let cbid = 0;
  const S = { ipc: [], writes: [] };
  window.__state = S;
  window.__dirs = {
    "/home/user": [
      { name: "notes", isDirectory: true, isFile: false },
      { name: "doc1.md", isDirectory: false, isFile: true },
    ],
    "/home/user/notes": [{ name: "report.md", isDirectory: false, isFile: true }],
  };
  window.__bodies = { "/home/user/notes/report.md": "# Report\n\nbody of the opened file\n" };
  window.__exists = ["/home/user/doc1.md"];
  window.__TAURI_INTERNALS__ = {
    __TAURI_METADATA__: { currentWindow: { label: "main", id: 1 } },
    transformCallback() { return ++cbid; },
    unregisterCallback() {},
    convertFileSrc() { return "tauri://local/"; },
    async invoke(cmd, args, options) {
      S.ipc.push(cmd);
      // plugin-fs serves disk paths through request headers (headers.path,
      // percent-encoded) with the command's own args.path EMPTY. Merge both,
      // preferring the header when present.
      const hp = (options && options.headers && options.headers.path) || (args && args.path) || "";
      const path = hp.startsWith("%") ? decodeURIComponent(hp) : hp;
      switch (cmd) {
        case "plugin:path|resolve_directory":
          return "/home/user";
        case "plugin:fs|read_dir": {
          const entries = window.__dirs[path];
          if (!entries) throw new Error("forbidden path: " + path);
          return entries;
        }
        // plugin-fs's readTextFile treats the result as BYTES
        // (Uint8Array + TextDecoder), so serve encoded bytes.
        case "plugin:fs|read_text_file": {
          const body = window.__bodies[path];
          if (body === undefined) throw new Error("No such file: " + path);
          return new TextEncoder().encode(body);
        }
        case "plugin:fs|exists":
          return window.__exists.includes(path);
        case "plugin:fs|write_text_file":
          S.writes.push({ path, kind: "text" });
          return null;
        case "plugin:fs|write_file":
          S.writes.push({ path, kind: "binary" });
          return null;
        case "plugin:event|listen":
          return 1;
        case "plugin:window|destroy":
          return null;
        default:
          return null;
      }
    },
  };
}

/**
 * longDoc — build the scrolling fixture text.
 * @param {number} lines Number of 23px source lines.
 * @returns {string} Markdown source.
 */
const longDoc = (lines) => {
  let t = "";
  for (let i = 1; i <= lines; i++) t += "line " + i + " of a long open document to force scrolling\n";
  return t;
};
/** FIXTURE — the shared long-document body (250 lines ≈ 5.7k px of content). */
const FIXTURE = longDoc(250);

/**
 * wireErrors — collect pageerror/console-error for a page (fail the run).
 * @param {any} p The Playwright page.
 */
function wireErrors(p) {
  p.on("pageerror", (e) => err.push("PAGEERROR: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) err.push("CONSOLE: " + m.text()); });
}

const context = await browser.newContext();
await context.addInitScript(installInternals);
const page = await context.newPage({ viewport: { width: 1280, height: 800 } });
wireErrors(page);
await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
await wait(300);

/**
 * resetDoc — put the active tab into a known state: long text, caret at
 * `caret` (collapsed, "start"|"end"), both panes parked at scroll RATIO
 * `ratio` with the value-based echo stamp (mirrors the other verify suites).
 * @param {{ratio: number, caret: "start"|"end"}} o Caret + pane placement.
 */
async function resetDoc({ ratio, caret }) {
  await page.evaluate(({ ratio, caret, doc }) => {
    const d = window.editor.activeTab;
    window.editor.setDocumentText(doc);
    const len = d.input.value.length;
    d.input.setSelectionRange(caret === "start" ? 0 : len, caret === "start" ? 0 : len);
    const set = (sc, key) => {
      const max = sc.scrollHeight - sc.clientHeight;
      if (max > 0) {
        d[key] = { deadline: performance.now() + 4000, value: ratio * max };
        sc.scrollTop = ratio * max;
      }
    };
    set(d.editorScroll, "__suppE");
    set(d.previewScroll, "__suppP");
  }, { ratio, caret, doc: FIXTURE });
  await wait(120);
}

/**
 * readPos — ratios (%) of both panes, whether the textarea is focused and
 * whether a dialog backdrop is mounted.
 * @returns {Promise<{e:number,p:number,focused:boolean,dialog:boolean}>}
 */
const readPos = () => page.evaluate(() => {
  const d = window.editor.activeTab;
  if (!d) return { e: 0, p: 0, focused: false, dialog: false };
  const pct = (sc) => { const m = sc.scrollHeight - sc.clientHeight; return m > 0 ? +(100 * sc.scrollTop / m).toFixed(1) : 0; };
  return {
    e: pct(d.editorScroll), p: pct(d.previewScroll),
    focused: document.activeElement === d.input,
    dialog: !!document.querySelector(".savedlg-backdrop"),
  };
});

/**
 * nearAt — ratio-tolerant compare (±0.5% absorbs rounding + clamping).
 * @param {number} a Expected ratio in %.
 * @param {number} b Actual ratio in %.
 */
const nearAt = (a, b) => Math.abs(a - b) <= 0.5;

/**
 * closePicker — close an open picker through its OWN Cancel button (Escape
 * leaves the picker's promise pending — a pre-existing leak unrelated to this
 * regression, so the suite cancels via the button like a save-cancel user).
 */
async function closePicker() {
  if (await page.locator(".savedlg-backdrop").count()) {
    await page.locator('.savedlg button.btn:has-text("Cancel")').first().click();
    await wait(300);
  }
}

// Baseline: the fixture must actually be scrollable at this viewport.
await resetDoc({ ratio: 0.05, caret: "end" });
const scrollable = await page.evaluate(() => {
  const d = window.editor.activeTab;
  return d.editorScroll.scrollHeight - d.editorScroll.clientHeight;
});
ok("fixture document is scrollable", scrollable > 3000, "maxScroll=" + scrollable);

// ---- 1: Open toolbar button — caret at end, 5% — must NOT jump to bottom ----
await resetDoc({ ratio: 0.05, caret: "end" });
const before1 = await readPos();
await page.locator('button[data-action="open"]').click();
await wait(500);
const after1 = await readPos();
ok("1a Open button opens the picker", after1.dialog);
ok("1b Open-button dialog does not move the editor pane", nearAt(before1.e, after1.e), `${before1.e}% → ${after1.e}%`);
ok("1c Open-button dialog does not move the preview pane", nearAt(before1.p, after1.p), `${before1.p}% → ${after1.p}%`);
await closePicker();
const closed1 = await readPos();
ok("1d position still held after the picker closes", nearAt(before1.e, closed1.e) && nearAt(before1.p, closed1.p), JSON.stringify(closed1));

// ---- 2: Save toolbar button — caret at end, 5% — must NOT jump to bottom ----
await resetDoc({ ratio: 0.05, caret: "end" });
const before2 = await readPos();
await page.locator('button[data-action="save"]').click();
await wait(500);
const after2 = await readPos();
ok("2a Save button opens the Save-As picker", after2.dialog);
ok("2b Save-button dialog does not move the editor pane", nearAt(before2.e, after2.e), `${before2.e}% → ${after2.e}%`);
ok("2c Save-button dialog does not move the preview pane", nearAt(before2.p, after2.p), `${before2.p}% → ${after2.p}%`);
await closePicker();

// ---- 3: Save toolbar button with the caret ABOVE the viewport (start, 50%) ----
// The engine's caret reveal with a top-anchored caret scrolls UP to the caret;
// the same preservation guarantee must hold in that direction too.
await resetDoc({ ratio: 0.5, caret: "start" });
const before3 = await readPos();
await page.locator('button[data-action="save"]').click();
await wait(500);
const after3 = await readPos();
ok("3a Save-button dialog does not chase the caret above", nearAt(before3.e, after3.e) && nearAt(before3.p, after3.p), JSON.stringify({ before: before3, after: after3 }));
await closePicker();

// ---- 4: Ctrl+S keybind (focus stays in the textarea) — still no movement ----
await resetDoc({ ratio: 0.05, caret: "end" });
const before4 = await readPos();
await page.keyboard.press("Control+s");
await wait(500);
const after4 = await readPos();
ok("4a Ctrl+S opens the picker", after4.dialog);
ok("4b Ctrl+S dialog does not move either pane", nearAt(before4.e, after4.e) && nearAt(before4.p, after4.p), JSON.stringify({ before: before4, after: after4 }));
await closePicker();

// ---- 5: Ctrl+O keybind — no movement ----
await resetDoc({ ratio: 0.05, caret: "end" });
const before5 = await readPos();
await page.keyboard.press("Control+o");
await wait(500);
const after5 = await readPos();
ok("5a Ctrl+O opens the picker", after5.dialog);
ok("5b Ctrl+O dialog does not move either pane", nearAt(before5.e, after5.e) && nearAt(before5.p, after5.p), JSON.stringify({ before: before5, after: after5 }));
await closePicker();

// ---- 6: Cancel returns typing focus with the scroll held ----
await resetDoc({ ratio: 0.05, caret: "end" });
await page.locator('button[data-action="save"]').click();
await wait(500);
const during6 = await readPos();
ok("6a the Save-As picker parks typing focus in its own Name input",
  await page.evaluate(() => !!(document.activeElement && document.activeElement.closest(".picker-name"))),
  "active=" + await page.evaluate(() => document.activeElement && document.activeElement.className));
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll(".savedlg .savedlg-btns .btn")).find((b) => /Cancel/i.test(b.textContent));
  if (btn) btn.click();
});
await wait(350);
const after6 = await readPos();
ok("6b Cancelled Save-As returns keyboard focus to the editor", after6.focused);
ok("6c Cancelled Save-As holds the pre-dialog scroll", nearAt(during6.e, after6.e) && nearAt(during6.p, after6.p), JSON.stringify({ during: during6, after: after6 }));

// ---- 7: Open-confirm opens the NEW tab at the top; the old tab's stored
// position must stay at its pre-dialog ratio when visited again ----
await resetDoc({ ratio: 0.5, caret: "end" });
const oldRatio7 = (await readPos()).e;
await page.locator('button[data-action="open"]').click();
await wait(500);
const opened7 = await readPos();
ok("7a Open picker open with the scroll held", opened7.dialog && nearAt(oldRatio7, opened7.e), JSON.stringify(opened7));
await page.locator('.savedlg .picker-list li', { hasText: "notes" }).first().click();
await wait(300);
await page.locator('.savedlg .picker-list li', { hasText: "report.md" }).first().click();
await wait(200);
await page.locator(".savedlg .btn.primary").click(); // the picker's Open confirm
await wait(400);
const opened7b = await page.evaluate(() => ({ tabs: window.editor.tabs.length, active: window.editor.activeTab.name }));
ok("7b confirming open creates the new active tab", opened7b.tabs === 2 && /report\.md/.test(opened7b.active), JSON.stringify(opened7b));
const newTop7 = await readPos();
ok("7c the opened file reads at the top (openAtTop untouched)", newTop7.e === 0, "e=" + newTop7.e);
await page.evaluate(() => { window.editor.tabs[0].tab.querySelector(".tname").click(); });
await wait(400);
const backRatio7 = (await readPos()).e;
ok("7d returning to the old tab restores its pre-dialog position", nearAt(oldRatio7, backRatio7), `${oldRatio7}% → ${backRatio7}%`);

// ---- 8: Save-As confirm (fresh file) — write completes, scroll untouched ----
await page.evaluate(() => { if (window.editor.tabs.length > 1) window.editor.closeTab(window.editor.tabs[window.editor.tabs.length - 1]); });
await wait(200);
await resetDoc({ ratio: 0.05, caret: "end" });
const before8 = await readPos();
await page.locator('button[data-action="save"]').click();
await wait(500);
await page.evaluate(() => {
  const input = document.querySelector(".savedlg .picker-name input");
  if (input) input.value = "out-fresh.md";
});
await page.locator(".savedlg .btn.primary").click();
await wait(400);
const after8 = await readPos();
const writes8 = await page.evaluate(() => window.__state.writes.filter((w) => /out-fresh\.md$/.test(w.path)).length);
ok("8a Save-As wrote the fresh file through the stubbed fs", writes8 === 1, JSON.stringify(writes8));
ok("8b Save-As confirm did not move either pane", nearAt(before8.e, after8.e) && nearAt(before8.p, after8.p), JSON.stringify({ before: before8, after: after8 }));

// ---- 9: Save-As to an EXISTING name routes through the overwrite modal ----
await resetDoc({ ratio: 0.05, caret: "end" });
// Case 8's Save-As gave the tab a known path, which would now take save()'s
// direct-write branch (no dialog). Detach the path so this is a real Save-As.
await page.evaluate(() => { window.editor.activeTab.path = null; });
await page.locator('button[data-action="save"]').click();
await wait(500);
await page.evaluate(() => {
  const input = document.querySelector(".savedlg .picker-name input");
  if (input) input.value = "doc1.md"; // exists per window.__exists
});
const during9 = await readPos();
await page.evaluate(() => {
  // Click the picker's Save button (the .btn.primary child). A Playwright
  // locator click re-waits on this freshly detached node; the in-page click
  // is deterministic.
  document.querySelector(".savedlg .btn.primary").click();
});
await wait(350);
const owModal9 = await page.evaluate(() => {
  const box = document.querySelector(".savedlg");
  return box ? /Overwrite existing file\?/.test(box.textContent) : false;
});
ok("9a the overwrite modal appears over the doc", owModal9);
const pos9 = await readPos();
ok("9b the overwrite modal alone did not move the panes", nearAt(during9.e, pos9.e) && nearAt(during9.p, pos9.p), JSON.stringify({ during: during9, pos: pos9 }));
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll(".savedlg .savedlg-btns .btn")).find((b) => /Overwrite/i.test(b.textContent));
  if (btn) btn.click();
});
await wait(400);
const after9 = await readPos();
ok("9c overwriting did not move either pane", nearAt(during9.e, after9.e) && nearAt(during9.p, after9.p), JSON.stringify({ during: during9, after: after9 }));

// ---- 10: Export → HTML uses the same picker (menu path) — no movement ----
await resetDoc({ ratio: 0.05, caret: "end" });
await page.evaluate(() => document.querySelector('[data-action="menu"]').click());
await wait(150);
await page.locator('[data-submenu="export"]').hover();
await wait(150);
const before10 = await readPos();
await page.locator('.submenu[data-sub="export"] [data-menu="html"]').click();
await wait(700);
const after10 = await readPos();
ok("10a Html export opens the Save-As picker", after10.dialog);
ok("10b the Export picker did not move either pane", nearAt(before10.e, after10.e) && nearAt(before10.p, after10.p), JSON.stringify({ before: before10, after: after10 }));
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll(".savedlg .savedlg-btns .btn")).find((b) => /Cancel/i.test(b.textContent));
  if (btn) btn.click();
});
await wait(300);
const closed10 = await readPos();
ok("10c closing the Export picker restores typing focus + position", closed10.focused && nearAt(before10.e, closed10.e) && nearAt(before10.p, closed10.p), JSON.stringify(closed10));

// ---- 11: everyday format buttons keep the CAUSATIVE trailing focus ----
// (guard against over-tightening: only dialog-opening actions are pinned).
// The caret is placed on a line VISIBLE at 5% so the caret-follow reveal is a
// no-op and the assertion is about focus, not scroll.
await resetDoc({ ratio: 0.05, caret: "end" });
await page.evaluate((doc) => {
  const d = window.editor.activeTab;
  const lines = doc.split("\n");
  const off = lines.slice(0, 13).join("\n").length + 1; // start of line 14
  d.input.setSelectionRange(off, off);
}, FIXTURE);
await wait(120);
const before11 = await readPos();
await page.locator('button[data-fmt="bold"]').click();
await wait(250);
const after11 = await readPos();
ok("11a a format button still causatively refocuses the editor", after11.focused);
ok("11b a format button keeps the visible position too", nearAt(before11.e, after11.e) && nearAt(before11.p, after11.p), JSON.stringify({ before: before11, after: after11 }));

console.log("\nERRORS:", err.length ? err : "none");
await browser.close();
try { process.kill(-srv.pid); } catch { /* already dead */ }
console.log(`\n${pass} ok / ${fail} fail`);
process.exit(fail || err.length ? 1 : 0);
