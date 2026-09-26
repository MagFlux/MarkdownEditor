/**
 * verifyTauriClose.mjs — native Tauri path verification.
 *
 * Injects the exact `window.__TAURI_INTERNALS__` a bundler app receives and
 * drives the real @tauri-apps api/IPC: save→picker→write+close, picker-cancel,
 * save-discard-cancel, known-path direct write, open→picker→new tab, navigate
 * into forbidden dir, Home button, the hidden (dot) folder picker entry, and
 * the picker list's scroll reset on every directory entry (top-pinned).
 * Run with `npm run verify-tauri` (needs the built dist).
 */
// Native (Tauri) path verification — injects the exact `window.__TAURI_INTERNALS__`
// a bundler app receives, driving the REAL @tauri-apps api + IPC code.
//
// Real plugin command shapes (node_modules/@tauri-apps/*):
//   plugin:fs|write_text_file : content = 1st positional arg (bytes),
//                               path    = options.headers.path (URL-encoded)
//   plugin:fs|read_text_file  : { path, options }
//   plugin:fs|read_dir        : { path, options }   → [DirEntry]
//   plugin:path|resolve_directory : { directory }   (homeDir())   → path string
//   plugin:window|destroy     : the onCloseRequested *wrapper* issues this only when
//                               the handler did NOT preventDefault() → the close.
//   plugin:window|close       : re-emits close-requested (NOT what we want to close).
//
// IMPORTANT — the save/open dialogs are rendered IN-APP (see src/markdown.js):
//   - Save-As: the user types a filename and clicks Save, or picks an existing
//     file from the in-list and hits Save (which accepts the current name).
//   - Open: the user clicks a file in the list and hits Open.
// So the picker must be driven from the UI: type/click, then click the button.
//
// The internals MUST be page-local (Playwright contextifies addInitScript args, so
// Node-side Maps would never see the page's `listen` registrations). The page
// exposes __emitClose() (simulates the OS close button) and reads __state.
import { chromium } from "playwright";
import { execSync, spawn } from "node:child_process";

const PORT = 4905;
try { execSync(`kill $(lsof -ti tcp:${PORT}) 2>/dev/null || true`, { stdio: "ignore" }); } catch {}
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", String(PORT)], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await new Promise((r) => setTimeout(r, 1500));

let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (label, cond, extra) => { const c = !!cond; console.log((c ? "ok  " : "FAIL ") + label + (extra !== undefined ? "   → " + extra : "")); c ? pass++ : fail++; };

/**
 * wait — sleep for `ms` milliseconds.
 * @param {number} ms — the delay.
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
// Global watchdog: if the whole thing wedges, dump the current line and bail
// instead of hanging forever (Playwright can wait indefinitely on a bad click).
setTimeout(() => {
  console.error("\nWATCHDOG: run stalled (>55s). dumping state & aborting.");
  try {
    // Best-effort: show which scenario is active + any captured page errors.
    process.stderr.write("[watchdog] no further diagnostics\n");
  } catch {}
  process.exit(3);
}, 55000);

/**
 * installInternals — install a stub `window.__TAURI_INTERNALS__` (+ `__state` log) inside
 * the page. Injected via addInitScript so Playwright contextifies it once. Records
 * IPC, text writes, window-destroy, and close-request emissions on `__state`.
 * read_dir serves a default fake listing unless `window.__fsListings[path]`
 * (test-injected per-path listings, set by scenarios) provides one first.
 */
function installInternals() {
  let cbid = 0;
  const callbacks = new Map();
  const eventCbs = new Map();
    const S = { ipc: [], writes: [], destroyed: false, firedClose: 0, homeDir: 0, readDir: [] , readText: [], failingDirs: [], existing: ["/home/user/existing.md"] };
   /** emitClose — increment the close counter and fire all close-requested listeners. */
   function emitClose() {
      S.firedClose++;
      for (const id of (eventCbs.get("tauri://close-requested") || [])) {
        const cb = callbacks.get(id); if (cb) cb({ event: "tauri://close-requested", payload: null, id: 1 });
      }
    }
  const internals = {
    __TAURI_METADATA__ : { currentWindow: { label: "main", id: 1 } },
    metadata: { currentWindow: { label: "main", id: 1 } },
    transformCallback(fn) { const id = ++cbid; callbacks.set(id, fn); return id; },
    unregisterCallback(id) { callbacks.delete(id); },
    convertFileSrc(path, protocol) { return `tauri://` + protocol + "/" + encodeURIComponent(path); },
    async invoke(cmd, args, options) {
      S.ipc.push(cmd);
      switch (cmd) {
        case "plugin:event|listen": {
          const ev = args.event;
          if (!eventCbs.has(ev)) eventCbs.set(ev, []);
          eventCbs.get(ev).push(args.handler);
          return 1;
        }
        case "plugin:path|resolve_directory":
          // homeDir() — returns the user's home directory path (Linux).
          S.homeDir++;
          return "/home/user";
        case "plugin:fs|read_dir": {
          const p = args && args.path;
          S.readDir.push(p);
          // Fault injection: if the test flagged this dir as forbidden, reject —
          // simulates an out-of-scope / permission-denied read.
          if (Array.isArray(S.failingDirs) && S.failingDirs.includes(p)) {
            return Promise.reject(new Error("path not allowed"));
          }
          // Test-injected per-path listings (scenario I's scrollable dirs)
          // take precedence over the default 3-entry listing below.
          const injected = window.__fsListings && window.__fsListings[p];
          if (injected) return injected;
          // Fake an FS listing; used by the in-app save/open picker.
          // A couple of plausible entries so the list isn't empty.
          return [
            { name: "notes", isDirectory: true, isFile: false, isSymlink: false },
            { name: ".config", isDirectory: true, isFile: false, isSymlink: false },
            { name: "existing.md", isDirectory: false, isFile: true, isSymlink: false },
          ];
        }
        case "plugin:fs|exists":
          return S.existing.includes(args && args.path);
        case "plugin:fs|write_text_file": {
          let bytes = args;
          if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
          const text = (bytes && bytes.byteLength !== undefined) ? new TextDecoder().decode(bytes)
                                                                : (typeof args === "string" ? args : "");
          const hp = (options && options.headers && options.headers.path) || null;
          const path = hp ? (hp.startsWith("%") ? decodeURIComponent(hp) : hp) : null;
          S.writes.push({ path, text });
          return null;
        }
        case "plugin:fs|read_text_file": {
          S.readText.push(args && args.path);
          // readTextFile() does `bytes instanceof ArrayBuffer ? bytes : Uint8Array.from(arr)`
          // then decodes — so return BYTES, not a string.
          return new TextEncoder().encode("# read from tauri");
        }
        case "plugin:window|destroy": S.destroyed = true; return null;
        case "plugin:window|close": emitClose(); return null;
        default: return null;
      }
    },
  };
  window.__TAURI_INTERNALS__ = internals;
  window.__emitClose = emitClose;
  window.__state = S;
}

/**
 * scenario — run one test case in a fresh browser context with Tauri stubs.
 * @param {string} name — the scenario label.
 * @param {(env: {page: any, st: any, emit: any, ok: any, wait: any, errors: any, log: any}) => Promise<void>} run — the case body.
 */
async function scenario(name, run) {
  const context = await browser.newContext();
  await context.addInitScript(installInternals);
  const page = await context.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  /** log — print an indented status line. */
  const log = (s) => { console.log("   " + s); };
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
  console.log("\n== " + name + " ==");
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await wait(300);
    /** st — read the stub `window.__state` (IPC/writes/destroy/close log). */
    const st = () => page.evaluate(() => window.__state);

    /** emit — fire the stub close-requested event (simulates a window close). */
    const emit = () => page.evaluate(() => window.__emitClose());
    await run({ page, st, emit, ok, wait, errors, log });
  } catch (e) {
    console.log("   !!! SCENARIO THREW: " + (e && e.message ? e.message : e));
    fail++;
  }
  await context.close();
  console.log("   (console/page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
}

/**
 * byRole — a Playwright `getByRole` locator for an accessible-role element.
 * @param {import('playwright-chromium').Page} page — the page.
 * @param {string} role — the ARIA role (e.g. "button").
 * @param {string} name — the accessible name.
 * @param {boolean} [exact] — exact-name match (default true).
 * @returns {import('playwright-chromium').Locator}
 */
function byRole(page, role, name, exact = true) {
  return page.getByRole(role, { name, exact });
}

// ---- A: dirty, choose SAVE → picker confirms → real write + window closes ----
await scenario("A: SAVE → in-app picker → write + close", async ({ page, st, emit, ok, wait }) => {
  await page.evaluate(() => { const a = window.editor.activeTab; a.input.value = "hello from tauri save"; a.dirty = true; a.name = "DocA.md"; a.path = null; });
  await emit();
  await page.waitForSelector(".savedlg", { timeout: 2500 });
  ok("A1 close prompt appeared (registered natively)", true);
  // Step 1: pick "Save" in the save/discard dialog.
  await byRole(page, "button", "Save", true).click();
  await wait(300);
  // Step 2: picker appeared (save-mode has a name input row).
  await page.waitForSelector(".picker-name", { timeout: 2500 });
  ok("A1b in-app Save-As picker appeared (no native dialog)", true);
  ok("A1c picker is a .savedlg inside the webview (centered by construction)",
     !!(await page.$(".savedlg.picker") || await page.$(".savedlg .picker-name")));
  // Step 3: type a filename, click the picker's Save.
  await page.locator(".picker-name input").fill("tauri_save.md");
  // The picker's Save button is the `.btn.primary` inside the picker (not the
  // save-discard dialog's — that one has already closed).
  await page.locator(".savedlg button.primary").click();
  await wait(300);
  let S = await st();
  const w = S.writes[S.writes.length - 1];
  ok("A2 Save issued a real Tauri write (fs/write_text_file)", S.writes.length >= 1, JSON.stringify(S.writes));
  ok("A3 written contents match the document", !!(w && w.text === "hello from tauri save"), JSON.stringify(w));
  ok("A4 picked path is under the home dir (or typed absolute path)",
     !!(w && /^\/(home\/user|tmp)\//.test(w.path || "")), JSON.stringify(w));
  S = await st();
  ok("A5 window actually closed (wrapper auto-destroyed)", S.destroyed === true, "destroyed=" + S.destroyed + " firedClose=" + S.firedClose);
});

// ---- A2: dirty, choose SAVE → picker CANCELLED → stays open ----
await scenario("A2: SAVE → picker cancelled → stays open", async ({ page, st, emit, ok, wait }) => {
  await page.evaluate(() => { const a = window.editor.activeTab; a.input.value = "keep me"; a.dirty = true; a.name = "Keep.md"; a.path = null; });
  await emit();
  await page.waitForSelector(".savedlg", { timeout: 2500 });
  await byRole(page, "button", "Save", true).first().click({ timeout: 3000 });
  await page.waitForSelector(".picker-name", { timeout: 2500 });
  // Cancel the picker (picker's own Cancel button — save-discard is already gone).
  await byRole(page, "button", "Cancel", true).first().click({ timeout: 3000 });
  await wait(200);
  const S = await st();
  // Cancelled picker → save() returns false → closeApp returns false →
  // no preventDefault is skipped, so the wrapper does NOT destroy.
  ok("A2a picker cancel: window did NOT close", S.destroyed === false, "destroyed=" + S.destroyed);
  ok("A2b picker cancel: nothing written to disk", S.writes.length === 0, JSON.stringify(S.writes));
  const val = await page.evaluate(() => window.editor.activeTab && window.editor.activeTab.input.value);
  ok("A2c picker cancel: tab intact with content", val === "keep me", JSON.stringify({ val }));
  // Cancelling the picker must NOT pop a redundant "Save cancelled" message —
  // the cancel already communicated it. Assert no extra info/error modal remains.
  const hasCancelMsg = !!(await page.$(".savedlg .savedlg-msg"));
  ok("A2d picker cancel: no redundant 'save cancelled' message modal", hasCancelMsg === false);
});

// ---- A3: Save-As existing file -> overwrite confirmation gates the write ----
await scenario("A3: existing Save-As file requires overwrite confirmation", async ({ page, st, emit, ok, wait }) => {
  await page.evaluate(() => { const a = window.editor.activeTab; a.input.value = "replacement"; a.dirty = true; a.name = "Replace.md"; a.path = null; });
  await emit();
  await page.waitForSelector(".savedlg", { timeout: 2500 });
  await byRole(page, "button", "Save", true).click();
  await page.waitForSelector(".picker-name", { timeout: 2500 });
  await page.locator(".picker-list li", { hasText: "existing.md" }).first().click();
  await page.locator(".savedlg button.primary").click();
  await page.waitForSelector('.savedlg h3:has-text("Overwrite existing file?")', { timeout: 2500 });
  let S = await st();
  ok("A3a overwrite prompt appears before writing", S.writes.length === 0, JSON.stringify(S));
  await byRole(page, "button", "Cancel", true).click();
  await wait(200);
  S = await st();
  ok("A3b overwrite cancel leaves the window open", S.destroyed === false, "destroyed=" + S.destroyed);
  ok("A3c overwrite cancel leaves the file untouched", S.writes.length === 0, JSON.stringify(S.writes));
  ok("A3d overwrite cancel keeps the tab dirty", await page.evaluate(() => window.editor.activeTab.dirty === true));
  await emit();
  await page.waitForSelector(".savedlg", { timeout: 2500 });
  await byRole(page, "button", "Save", true).click();
  await page.waitForSelector(".picker-name", { timeout: 2500 });
  await page.locator(".picker-list li", { hasText: "existing.md" }).first().click();
  await page.locator(".savedlg button.primary").click();
  await page.waitForSelector('.savedlg h3:has-text("Overwrite existing file?")', { timeout: 2500 });
  await byRole(page, "button", "Overwrite", true).click();
  await wait(200);
  S = await st();
  ok("A3e overwrite confirmation permits the write", S.writes.length === 1, JSON.stringify(S.writes));
  ok("A3f overwrite confirmation closes the window", S.destroyed === true, "destroyed=" + S.destroyed);
});

// ---- B: dirty, choose CANCEL at save-discard → window stays, nothing written ----
await scenario("B: CANCEL (save-discard) → stays open", async ({ page, st, emit, ok, wait }) => {
  await page.evaluate(() => { const a = window.editor.activeTab; a.input.value = "keep me please"; a.dirty = true; a.name = "B.md"; a.path = null; });
  await emit();
  await page.waitForSelector(".savedlg", { timeout: 2500 });
  // Click the save-discard dialog's Cancel (NOT the picker's — picker hasn't opened yet).
  await byRole(page, "button", "Cancel", true).click();
  await wait(200);
  const S = await st();
  ok("B1 cancel: window did NOT close", S.destroyed === false, "destroyed=" + S.destroyed);
  const tabs = await page.locator(".tab").count();
  const val = await page.evaluate(() => window.editor.activeTab && window.editor.activeTab.input.value);
  ok("B2 cancel: tab intact with content", tabs === 1 && val === "keep me please", JSON.stringify({ tabs, val }));
  ok("B3 cancel: nothing written to disk", S.writes.length === 0, JSON.stringify(S.writes));
  ok("B4 cancel (save-discard): picker never opened", !S.ipc.includes("plugin:path|resolve_directory") && !S.ipc.includes("plugin:fs|read_dir"), "ipc=" + JSON.stringify(S.ipc));
});

// ---- C: tab with a known path → writes straight, no picker ----
await scenario("C: SAVE to known path (no picker)", async ({ page, st, emit, ok, wait }) => {
  await page.evaluate(() => { const a = window.editor.activeTab; a.input.value = "direct write"; a.dirty = true; a.path = "/tmp/direct.md"; });
  await emit();
  await page.waitForSelector(".savedlg", { timeout: 2500 });
  await byRole(page, "button", "Save", true).click();
  await wait(300);
  const S = await st();
  const w = S.writes[S.writes.length - 1];
  ok("C1 saved directly to the tab's path", !!(w && w.path === "/tmp/direct.md"), JSON.stringify(w));
  // Known path → save() never opens the picker, so resolve_directory and
  // read_dir are never called.
  ok("C2 no in-app picker invoked (no resolve_directory / read_dir)",
     !S.ipc.includes("plugin:path|resolve_directory") && !S.ipc.includes("plugin:fs|read_dir"),
     "ipc=" + JSON.stringify(S.ipc));
  ok("C3 window closed after direct save", S.destroyed === true, "destroyed=" + S.destroyed);
});

// ---- D: open() → in-app picker → click file → new tab with fs/read_text_file ----
await scenario("D: OPEN → picker → new tab from disk", async ({ page, st, ok, wait }) => {
  const beforeTabs = await page.locator(".tab").count();
  // open() resolves/rejects only when the picker is confirmed/cancelled, so we
  // MUST return a non-promise value here or evaluate() would await forever.
  await page.evaluate(() => { window.editor.open(); return true; });
  await page.waitForSelector(".savedlg", { timeout: 2500 });
  // open-mode picker has no name row.
  ok("D1 open() picked the in-app picker (no native dialog)", true);
  ok("D2 open-mode picker has no filename row", !!(await page.$(".picker-list")) && !(await page.$(".picker-name")));
  // Click the file row "existing.md".
  const fileRow = page.locator(".picker-list li", { hasText: "existing.md" });
  await fileRow.first().click({ timeout: 3000 });
  await wait(100);
  await page.locator(".savedlg button.primary").first().click({ timeout: 3000 });
  await wait(300);
  const S = await st();
  ok("D3 read_text_file invoked with the picked path", S.readText.length >= 1, JSON.stringify(S.readText));
  const tabs = await page.locator(".tab").count();
  const activeName = await page.evaluate(() => window.editor.activeTab && window.editor.activeTab.name);
  const activeText = await page.evaluate(() => window.editor.activeTab && window.editor.activeTab.input.value);
  ok("D4 a new tab was created (open always opens a new tab)", tabs === beforeTabs + 1, JSON.stringify({ tabs, beforeTabs }));
  ok("D5 new tab has the file name", activeName === "existing.md", JSON.stringify({ activeName }));
  ok("D6 new tab got the file content", activeText === "# read from tauri", JSON.stringify({ activeText }));
});

// ---- E: open() → picker cancelled → no new tab, no read ----
await scenario("E: OPEN → picker cancelled → no new tab", async ({ page, st, ok, wait }) => {
  const beforeTabs = await page.locator(".tab").count();
  await page.evaluate(() => { window.editor.open(); return true; });
  await page.waitForSelector(".savedlg", { timeout: 2500 });
  await byRole(page, "button", "Cancel", true).first().click({ timeout: 3000 });
  await wait(200);
  const S = await st();
  const tabs = await page.locator(".tab").count();
  ok("E1 cancel: no new tab created", tabs === beforeTabs, JSON.stringify({ tabs, beforeTabs }));
  ok("E2 cancel: no read_text_file invoked", S.readText.length === 0, JSON.stringify(S.readText));
  ok("E3 cancel: window did not close", S.destroyed === false, "destroyed=" + S.destroyed);
});

// ---- F: navigate into a FORBIDDEN dir → crumb stays on last readable dir ----
await scenario("F: forbidden dir → UI keeps last readable path", async ({ page, st, ok, wait }) => {
  await page.evaluate(() => { window.editor.open(); return true; });
  await page.waitForSelector(".savedlg", { timeout: 2500 });
  // Baseline: crumb shows the home dir that opened (homeDir resolves to /home/user).
  const cur0 = await page.locator(".picker-pathbar .crumb-cur").first().textContent();
  ok("F0 picker opened at home dir", /user$/.test(cur0.trim()), JSON.stringify({ cur0 }));
  // Flag the notes/ directory as forbidden (simulates out-of-scope read).
  await page.evaluate(() => { window.__state.failingDirs = ["/home/user/notes"]; });
  // Enter the forbidden dir (click the "notes" folder row).
  const notesRow = page.locator(".picker-list li", { hasText: "notes" });
  await notesRow.first().click({ timeout: 3000 });
  await wait(250);
  const S = await st();
  ok("F1 read_dir was attempted on the forbidden dir", S.readDir.includes("/home/user/notes"), JSON.stringify(S.readDir));
  // The UI must NOT have adopted the forbidden path — crumb still shows home.
  const cur1 = await page.locator(".picker-pathbar .crumb-cur").first().textContent();
  ok("F2 crumb did NOT move into the forbidden dir (still on home)", !/notes/.test(cur1.trim()) && /user$/.test(cur1.trim()), JSON.stringify({ cur1 }));
  // An error status is shown explaining the read failed.
  const status = await page.locator(".picker-status").first().textContent();
  ok("F3 an error status explains the read failure", /cannot read/i.test(status || ""), JSON.stringify({ status }));
  // The list is unchanged (still lists home's contents, not the forbidden child).
  const rows = await page.locator(".picker-list li").count();
  ok("F4 list still shows the last readable dir's entries", rows >= 2, JSON.stringify({ rows }));
  // Cleanup: dismiss the picker.
  await byRole(page, "button", "Cancel", true).first().click({ timeout: 3000 }).catch(() => {});
});

// ---- G: Home button always present + jumps back to the home dir from anywhere ----
await scenario("G: Home button always available + returns to home", async ({ page, st, ok, wait }) => {
  await page.evaluate(() => { window.editor.open(); return true; });
  await page.waitForSelector(".picker-list", { timeout: 2500 });
  const homeBtn = page.locator('.picker-pathbar .ctrl[aria-label="Home directory"]');
  const upBtn = page.locator('.picker-pathbar .ctrl[aria-label="Go up"]');

  // G1/G2: both navigation controls render at the opening (home) directory.
  ok("G1 Home button present at opening (home) dir", (await homeBtn.count()) === 1, "n=" + (await homeBtn.count()));
  ok("G2 Up button present alongside Home", (await upBtn.count()) === 1, "n=" + (await upBtn.count()));

  // Navigate INTO a subdir to prove the controls are not location-dependent.
  await page.locator(".picker-list li", { hasText: "notes" }).first().click({ timeout: 3000 });
  await wait(200);
  const G3st = await st();
  ok("G3 navigated into subdir (read_dir hit /home/user/notes)", G3st.readDir.includes("/home/user/notes"), JSON.stringify(G3st.readDir));
  ok("G4 Home button STILL present after navigating away from home", (await homeBtn.count()) === 1);
  const cur = await page.locator(".picker-pathbar .crumb-cur").first().textContent();
  ok("G5 crumb current is the notes subdir", /notes$/.test(cur.trim()), JSON.stringify(cur));

  // Click Home → picker must jump back to the user's home directory.
  await homeBtn.first().click({ timeout: 3000 });
  await wait(200);
  const G6st = await st();
  const homeReads = G6st.readDir.filter((p) => p === "/home/user");
  ok("G6 Home click re-loaded the home dir (read_dir /home/user again)", homeReads.length >= 2, JSON.stringify(G6st.readDir));
  const cur2 = await page.locator(".picker-pathbar .crumb-cur").first().textContent();
  ok("G7 crumb current back on the home dir", /user$/.test(cur2.trim()) && !/notes/.test(cur2.trim()), JSON.stringify(cur2));

  // Cleanup: cancel.
  await byRole(page, "button", "Cancel", true).first().click({ timeout: 3000 }).catch(() => {});
});

// ---- H: picker must be able to ENTER a hidden (leading-dot) folder ----
// Regression guard for the fs-scope fix in src-tauri/tauri.conf.json:
// `plugins.fs.requireLiteralLeadingDot: false` makes the scope's `**` glob
// match dot-path segments on Unix. The stub doesn't enforce the real scope,
// so we assert the UI-level contract instead: the picker lists dot-dirs and
// drives read_dir() into a dot-path without hiding or refusing them. A future
// change that re-adds a leading-dot filter (in render() or goToDir()) will
// break this, so it surfaces here.
await scenario("H: hidden (dot) folder is navigable in the picker", async ({ page, st, ok, wait }) => {
  await page.evaluate(() => { window.editor.open(); return true; });
  await page.waitForSelector(".picker-list", { timeout: 2500 });
  // Clear any fault injection from an earlier scenario.
  await page.evaluate(() => { window.__state.failingDirs = []; });

  // H1: the listing includes a dot-prefixed directory (not filtered out).
  const dotRow = page.locator(".picker-list li", { hasText: ".config" });
  ok("H1 dot folder listed in the picker", (await dotRow.count()) >= 1, "n=" + (await dotRow.count()));

  // H2: clicking it drives read_dir on the dot-path (state.cwd adopts it).
  await dotRow.first().click({ timeout: 3000 });
  await wait(200);
  const H2st = await st();
  ok("H2 read_dir was invoked on the dot-path",
     H2st.readDir.some((p) => p === "/home/user/.config"),
     JSON.stringify(H2st.readDir));
  // H3: the crumb adopts the dot-folder as the current dir (not stuck on home).
  const cur = await page.locator(".picker-pathbar .crumb-cur").first().textContent();
  ok("H3 crumb current is the dot-folder", /\.config$/.test(cur.trim()), JSON.stringify(cur));
  // H4: no error status — the read succeeded.
  const status = await page.locator(".picker-status").first().textContent();
  ok("H4 no read error shown for the dot-folder", !/cannot read/i.test(status || ""), JSON.stringify(status));

  // Cleanup: cancel.
  await byRole(page, "button", "Cancel", true).first().click({ timeout: 3000 }).catch(() => {});
});

// ---- I: entering a directory always shows the NEW listing from the TOP ----
// Regression guard for the picker list's scroll reset: the <ul class=
// "picker-list"> is created once per picker and only its content is rebuilt
// per directory (render()'s list.innerHTML=""). Browsers retain a scrollable's
// scrollTop across an innerHTML swap — the offset is only clamped against the
// NEW content at the next layout — so a directory entered after scrolling the
// previous one down opened MID-LIST ("every time a new folder is entered the
// vertical view isn't always at the top"). The fix pins list.scrollTop = 0
// before the swap in render(); every entry path (folder click, crumb click,
// Home, Up) funnels through goToDir → render, so the pin covers all of them.
// The stub serves the tall homes via window.__fsListings (test-injected
// listings, checked BEFORE the default 3-entry fake).
await scenario("I: dir entry always opens the new listing at the TOP", async ({ page, st, ok, wait }) => {
  // Inject directories tall enough to scroll: the HOME dir lists 40 dirs
  // (the list viewport is 260px ≈ 10-12 rows, so it scrolls) ending with
  // "sub"; the SUB dir lists 30 files (also scrollable). /home is injected
  // too for the crumb-click case.
  await page.evaluate(() => {
    window.__fsListings = {
      "/home/user": [
        ...Array.from({ length: 39 }, (_, i) => ({
          name: "d" + String(i).padStart(2, "0"), isDirectory: true, isFile: false, isSymlink: false,
        })),
        { name: "sub", isDirectory: true, isFile: false, isSymlink: false },
      ],
      "/home/user/sub": Array.from({ length: 30 }, (_, i) => ({
        name: "f" + String(i).padStart(2, "0") + ".md", isDirectory: false, isFile: true, isSymlink: false,
      })),
      "/home": Array.from({ length: 20 }, (_, i) => ({
        name: "u" + String(i).padStart(2, "0"), isDirectory: true, isFile: false, isSymlink: false,
      })),
    };
  });
  await page.evaluate(() => { window.editor.open(); return true; });
  await page.waitForSelector(".picker-list", { timeout: 2500 });
  await wait(300); // goToDir's async read_dir → render must have completed.

  /** listState — the <ul>'s scrollTop and whether "d00" (its first row) is visible. */
  const listState = () => page.evaluate(() => {
    const l = document.querySelector(".picker-list");
    return {
      st: l ? l.scrollTop : -1,
      view: l ? l.clientHeight : 0,
      full: l ? l.scrollHeight : 0,
    };
  });

  // I1: home listing starts at the top.
  const s0 = await listState();
  ok("I1 home listing starts at the top", s0.st === 0, JSON.stringify(s0));

  // I2: scroll the home list to the BOTTOM, then enter "sub".
  await page.evaluate(() => {
    const l = document.querySelector(".picker-list");
    l.scrollTop = l.scrollHeight; // scroll far down (40 rows >> 260px viewport)
  });
  await wait(80);
  const s1a = await listState();
  ok("I2a home list did scroll down (fixture sanity)", s1a.st > 0, JSON.stringify(s1a));
  // Scroll-to and click the "sub" row (Playwright's real click keeps the
  // engine's scroll intact; the row sits at the sorted end of the home list).
  await page.locator(".picker-list li", { hasText: "sub" }).first().scrollIntoViewIfNeeded();
  await page.locator(".picker-list li", { hasText: "sub" }).first().click({ timeout: 3000 });
  await wait(350); // read_dir + render
  const s2 = await listState();
  // CONTRACT: the new listing (30 files ≈ 700px of content in a 260px
  // viewport) must be pinned to its TOP. The OLD scrollTop at the end of the
  // home listing was ~255px; a regression (stale offset surviving the
  // innerHTML swap) would land the sub listing ~250px down (row ~10), NOT
  // ≤1px — so this assertion genuinely separates fix from regression.
  ok("I2b entering a folder opens the new listing at the TOP (≤1px)",
     s2.st <= 1, JSON.stringify(s2));

  // I3: scroll the sub listing down, then go UP — the SAME scrollable, so the
  // stale-offset hazard is identical; the pin must cover goUp too. The parent
  // (home) listing is 40 rows tall, so a stale offset would survive here.
  await page.evaluate(() => {
    const l = document.querySelector(".picker-list");
    l.scrollTop = l.scrollHeight;
  });
  await wait(80);
  await page.locator('.picker-pathbar .ctrl[aria-label="Go up"]').first().click({ timeout: 3000 });
  await wait(350);
  const s3 = await listState();
  ok("I3 go-up opens the parent listing at the TOP (≤1px)", s3.st <= 1, JSON.stringify(s3));

  // I4: scroll down, then Home — same contract for the Home control.
  await page.evaluate(() => {
    const l = document.querySelector(".picker-list");
    l.scrollTop = l.scrollHeight;
  });
  await wait(80);
  await page.locator('.picker-pathbar .ctrl[aria-label="Home directory"]').first().click({ timeout: 3000 });
  await wait(350);
  const s4 = await listState();
  ok("I4 Home opens the home listing at the TOP (≤1px)", s4.st <= 1, JSON.stringify(s4));

  // I5: scroll down, then click the root ("/") crumb — same contract for the
  // breadcrumb pathbar. The injected /home listing is 20 dirs tall, so a
  // stale offset would survive the swap here too.
  await page.evaluate(() => {
    const l = document.querySelector(".picker-list");
    l.scrollTop = l.scrollHeight;
  });
  await wait(80);
  await page.locator('.picker-pathbar [data-crumb="/home"]').first().click({ timeout: 3000 }).catch(() => {});
  await wait(350);
  const s5 = await listState();
  ok("I5 crumb click opens the target listing at the TOP (≤1px)", s5.st <= 1, JSON.stringify(s5));

  // Cleanup: cancel.
  await byRole(page, "button", "Cancel", true).first().click({ timeout: 3000 }).catch(() => {});
});

await browser.close();
try { process.kill(-srv.pid); } catch {}
console.log(`\n${pass} ok / ${fail} fail`);
process.exit(fail ? 1 : 0);
