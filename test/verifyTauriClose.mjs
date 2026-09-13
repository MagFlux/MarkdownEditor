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
const ok = (label, cond, extra) => { const c = !!cond; console.log((c ? "ok  " : "FAIL ") + label + (extra !== undefined ? "   → " + extra : "")); c ? pass++ : fail++; };
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

// Pure function; runs INSIDE the page (contextified). Self-contained.
function installInternals() {
  let cbid = 0;
  const callbacks = new Map();
  const eventCbs = new Map();
    const S = { ipc: [], writes: [], destroyed: false, firedClose: 0, homeDir: 0, readDir: [] , readText: [], failingDirs: [] };
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
          // Fake an FS listing; used by the in-app save/open picker.
          // A couple of plausible entries so the list isn't empty.
          return [
            { name: "notes", isDirectory: true, isFile: false, isSymlink: false },
            { name: ".config", isDirectory: true, isFile: false, isSymlink: false },
            { name: "existing.md", isDirectory: false, isFile: true, isSymlink: false },
          ];
        }
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

async function scenario(name, run) {
  const context = await browser.newContext();
  await context.addInitScript(installInternals);
  const page = await context.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const log = (s) => { console.log("   " + s); };
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
  console.log("\n== " + name + " ==");
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await wait(300);
    const st = () => page.evaluate(() => window.__state);
    const emit = () => page.evaluate(() => window.__emitClose());
    await run({ page, st, emit, ok, wait, errors, log });
  } catch (e) {
    console.log("   !!! SCENARIO THREW: " + (e && e.message ? e.message : e));
    fail++;
  }
  await context.close();
  console.log("   (console/page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
}

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
  // A "Save cancelled" message modal should now be showing (with an OK button).
  const hasCancelMsg = !!(await page.$(".savedlg .savedlg-msg"));
  ok("A2d save-cancelled message modal shown in-app", hasCancelMsg);
  // Dismiss it.
  await byRole(page, "button", "OK", true).first().click({ timeout: 3000 }).catch(() => {});
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

await browser.close();
try { process.kill(-srv.pid); } catch {}
console.log(`\n${pass} ok / ${fail} fail`);
process.exit(fail ? 1 : 0);
