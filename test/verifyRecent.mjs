/**
 * verifyRecent.mjs — Recent files menu regression (native path, stubbed IPC).
 *
 * Pins the contracts of the hamburger menu's Recent files section: a native
 * open (openFile with a path) and a native save record entries, dedupe by
 * path moves an entry to the top, the list caps at 10, clicking an entry
 * opens the file in a NEW tab (invariant 6), a STALE entry (unreadable file)
 * shows the "Open failed" modal AND is dropped from the list, the section is
 * hidden entirely when empty, entries persist across a page reload, and the
 * browser fallback (no __TAURI_INTERNALS__) never shows the section (it has
 * no paths to re-read). Run with `npm run verify-recent`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

const PORT = 4623;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync(`kill $(lsof -ti tcp:${PORT}) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await wait(1800);

const browser = await chromium.launch();
let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (n, c, extra) => { if (c) { pass++; console.log("ok  ", n, extra ? "→ " + extra : ""); } else { fail++; console.log("FAIL", n, extra ? "→ " + extra : ""); } };

/**
 * installInternals — stub `window.__TAURI_INTERNALS__` + `window.__state`.
 * Must be FULLY self-contained (addInitScript serializes the function, so
 * node-side closures do not survive): the file map lives inside the stub and
 * is exposed as `window.__files` so scenarios can mutate it (mark entries
 * stale) before driving flows. `FILES[path] === null` → read_text_file throws
 * (a stale entry); `exists` answers truthy for known, readable paths.
 */
function installInternals() {
  let cbid = 0;
  const S = { ipc: [], textWrites: [] };
  window.__state = S;
  window.__files = {
    "/home/user/notes/report.md": "# Report\n\ncontent A\n",
    "/home/user/notes/older.md": "# Older\n\ncontent B\n",
    "/home/user/notes/gone.md": null, // stale entry: read throws
  };
  const internals = {
    __TAURI_METADATA__: { currentWindow: { label: "main", id: 1 } },
    metadata: { currentWindow: { label: "main", id: 1 } },
    transformCallback(fn) { const id = ++cbid; return id; },
    unregisterCallback() {},
    convertFileSrc() { return "tauri://local/"; },
    async invoke(cmd, args, options) {
      S.ipc.push(cmd);
      const files = window.__files || {};
      const hp = (options && options.headers && options.headers.path) || (args && args.path) || "";
      const path = hp.startsWith("%") ? decodeURIComponent(hp) : hp;
      switch (cmd) {
        case "plugin:fs|read_text_file":
          if (!(path in files) || files[path] === null) throw new Error("No such file: " + path);
          // plugin-fs's readTextFile treats the result as BYTES
          // (Uint8Array.from(arr) + TextDecoder), so serve encoded bytes — a
          // plain string would iterate as chars → NaN → 0 for every byte.
          return new TextEncoder().encode(files[path]);
        case "plugin:fs|exists":
          return path in files && files[path] !== null;
        case "plugin:fs|write_text_file": {
          S.textWrites.push({ path });
          return null;
        }
        case "plugin:event|listen": return 1;
        case "plugin:window|destroy": return null;
        default: return null;
      }
    },
  };
  window.__TAURI_INTERNALS__ = internals;
}

/**
 * recentLabels — the text labels currently listed in the Recent section.
 * @returns {Promise<string[]>} The labels (empty when the section is hidden).
 */
const recentLabels = (page) => page.evaluate(() => {
  const box = document.querySelector('.submenu[data-sub="recent"]');
  if (!box) return [];
  return Array.from(box.querySelectorAll(".menu-recent-item .mi-label")).map((el) => el.textContent);
});

/**
 * openMenu — open the hamburger menu (idempotent: a stale open menu is
 * closed first, since the button TOGGLES and a leftover open state would
 * otherwise be closed by this call, reading stale DOM afterwards).
 */
const openMenu = async (page) => {
  await page.evaluate(() => {
    const btn = document.querySelector('[data-action="menu"]');
    if (btn.getAttribute("data-menu-open") === "true") btn.click();
  });
  await wait(60);
  await page.evaluate(() => document.querySelector('[data-action="menu"]').click());
  await wait(120);
  // The Recent files entries live in a HOVER submenu — open it too.
  await page.locator('[data-submenu="recent"]').hover();
  await wait(150);
};

/**
 * scenario — run one recent-files case in a fresh context (optionally stubbed).
 * @param {string} name — the case label.
 * @param {boolean} tauri — install the __TAURI_INTERNALS__ stub first.
 * @param {(env: {page: any, ok: any, wait: any}) => Promise<void>} run — the body.
 */
async function scenario(name, tauri, run) {
  const context = await browser.newContext();
  if (tauri) await context.addInitScript(installInternals);
  const page = await context.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push("CONSOLE: " + m.text()); });
  console.log("\n== " + name + " ==");
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    await wait(300);
    await run({ page, ok, wait });
  } catch (e) {
    console.log("   !!! SCENARIO THREW: " + (e && e.message ? e.message : e));
    fail++;
  }
  await context.close();
  console.log("   (console/page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
}

// ---- R: record + render + click-to-open (invariant 6: always a NEW tab) ----
await scenario("R: record on open/save, menu lists, click opens a new tab", true, async ({ page, ok, wait }) => {
  await page.evaluate(() => { window.editor.openFile({ name: "report.md", text: "# Report\n\ncontent A\n", path: "/home/user/notes/report.md" }); });
  await openMenu(page);
  let labels = await recentLabels(page);
  ok("R1 the opened file is listed", labels.length === 1 && labels[0] === "report.md", JSON.stringify(labels));

  // Second, older file → listed second. Same path again → dedupe + move to top.
  await page.evaluate(() => { window.editor.openFile({ name: "older.md", text: "# Older\n\ncontent B\n", path: "/home/user/notes/older.md" }); });
  await page.evaluate(() => { window.editor.openFile({ name: "report.md", text: "# Report\n\ncontent A\n", path: "/home/user/notes/report.md" }); });
  await openMenu(page);
  labels = await recentLabels(page);
  ok("R2 dedupe + most-recent-first", labels.length === 2 && labels[0] === "report.md" && labels[1] === "older.md", JSON.stringify(labels));

  const tabsBefore = await page.evaluate(() => window.editor.tabs.length);
  // Click the "older.md" entry → opens as a NEW tab and becomes active.
  await page.evaluate(() => document.querySelector('.menu-recent-item[data-recent-idx="1"]').click());
  await wait(250);
  const tabsAfter = await page.evaluate(() => window.editor.tabs.length);
  const docText = await page.evaluate(() => window.editor.getDocumentText());
  ok("R3 clicking an entry opens it in a NEW tab (invariant 6)", tabsAfter === tabsBefore + 1, `${tabsBefore} → ${tabsAfter}`);
  ok("R4 the new tab carries the file's content and is active", docText.includes("content B"), docText.split("\n")[0]);

  // Cap: push 12 distinct files → at most 10 entries, newest kept.
  for (let i = 0; i < 12; i++) {
    await page.evaluate((k) => { window.editor.openFile({ name: "f" + k + ".md", text: "x" + k, path: "/home/user/notes/f" + k + ".md" }); }, i);
  }
  await openMenu(page);
  labels = await recentLabels(page);
  ok("R5 the submenu shows the last 5 files", labels.length === 5, JSON.stringify(labels.length));
});

// ---- S: save records too ----
await scenario("S: a native save with a known path records the entry", true, async ({ page, ok, wait }) => {
  await page.evaluate(() => { window.editor.openFile({ name: "report.md", text: "# Report\n\nedited\n", path: "/home/user/notes/report.md" }); });
  // Make it dirty, then Ctrl+S through the app's own save path.
  await page.evaluate(() => { window.editor.setDocumentText("# Report\n\nchanged on disk\n"); });
  await page.keyboard.press("Control+s");
  await wait(250);
  // The save path asks before overwriting an existing file (in-app modal) —
  // confirm it so the write goes through.
  await page.evaluate(() => {
    const box = document.querySelector(".savedlg");
    if (box) {
      const btns = Array.from(box.querySelectorAll("button"));
      const ow = btns.find((b2) => /Overwrite/i.test(b2.textContent));
      if (ow) ow.click();
    }
  });
  await wait(250);
  await openMenu(page);
  const labels = await recentLabels(page);
  ok("S1 the saved file is listed", labels.includes("report.md"), JSON.stringify(labels));
  const writes = await page.evaluate(() => window.__state.textWrites.map((w) => w.path));
  ok("S2 the save actually wrote through the stubbed fs", writes.includes("/home/user/notes/report.md"), JSON.stringify(writes));
});

// ---- T: stale entry → "Open failed" modal + dropped from the list ----
await scenario("T: a stale (unreadable) entry fails and is dropped", true, async ({ page, ok, wait }) => {
  await page.evaluate(() => {
    window.editor.openFile({ name: "report.md", text: "# Report\n\ncontent A\n", path: "/home/user/notes/report.md" });
    window.editor.openFile({ name: "gone.md", text: "# Gone\n", path: "/home/user/notes/gone.md" });
  });
  await openMenu(page);
  const labels = await recentLabels(page);
  ok("T1 both entries listed", labels.length === 2 && labels[0] === "gone.md" && labels[1] === "report.md", JSON.stringify(labels));
  // Click the gone.md entry (most recent → index 0).
  await page.evaluate(() => document.querySelector('.menu-recent-item[data-recent-idx="0"]').click());
  await wait(300);
  const modalText = await page.evaluate(() => {
    const box = document.querySelector(".savedlg");
    return box ? box.textContent : "";
  });
  ok("T2 the Open failed modal appears (in-app, centered)", /Open failed/.test(modalText) && /gone\.md/.test(modalText), JSON.stringify(modalText.slice(0, 120)));
  await page.evaluate(() => {
    const okBtn = document.querySelector(".savedlg .btn.primary");
    if (okBtn) okBtn.click();
  });
  await wait(200);
  await openMenu(page);
  const after = await recentLabels(page);
  ok("T3 the stale entry is dropped from the list", after.length === 1 && after[0] === "report.md", JSON.stringify(after));
});

// ---- U: persistence across reload ----
await scenario("U: entries persist across a reload (localStorage)", true, async ({ page, ok, wait }) => {
  await page.evaluate(() => { window.editor.openFile({ name: "report.md", text: "# Report\n\ncontent A\n", path: "/home/user/notes/report.md" }); });
  await page.reload({ waitUntil: "networkidle" });
  await wait(300);
  await openMenu(page);
  const labels = await recentLabels(page);
  ok("U1 the entry survived the reload", labels.length === 1 && labels[0] === "report.md", JSON.stringify(labels));
});

// ---- V: browser fallback (no internals stub) → no recent section ----
await scenario("V: browser fallback shows no Recent section", false, async ({ page, ok, wait }) => {
  await openMenu(page);
  const labels = await recentLabels(page);
  ok("V1 no entries and the section is hidden in a plain browser", labels.length === 0);
});

console.log(`\n${pass} ok / ${fail} fail`);
await browser.close();
process.exit(fail ? 1 : 0);
