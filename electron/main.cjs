/**
 * main.cjs — the Electron main process (the desktop shell).
 *
 * Replaces the former Tauri Rust shell. The frontend (dist bundle) speaks the
 * same shell-IPC wire contract the Playwright harnesses stub
 * (test/verifyTauriClose.mjs): every native operation is a `plugin:*` command
 * over `window.__TAURI_INTERNALS__.invoke`, installed by electron/preload.cjs
 * and answered HERE by the `shell:invoke` IPC router below:
 *
 *   plugin:fs|read_text_file   { path }                → file BYTES (Uint8Array)
 *   plugin:fs|write_text_file  <bytes> {headers.path}  → null (UTF-8 text write)
 *   plugin:fs|write_file       <bytes> {headers.path}  → null (binary write, PDF)
 *   plugin:fs|read_dir         { path }                → [DirEntry] (dot dirs included)
 *   plugin:fs|exists           { path }                → boolean
 *   plugin:path|resolve_directory { directory }        → home dir (21/`~`)
 *   plugin:opener|open_url     { url }                 → shell.openExternal
 *   plugin:opener|open_path    { path }                → shell.openPath
 *   plugin:event|listen        { event }               → event id (registry)
 *   plugin:event|unlisten      { event, eventId }      → null
 *   plugin:window|destroy      { label }               → FORCE close (skips
 *                                 beforeunload — the same semantics the
 *                                 Tauri destroy() had; see the close handler)
 *
 * The window-close confirm walk is preserved exactly: the OS close is
 * preventDefault-ed and the renderer's close-requested listener (registered
 * through `plugin:event|listen`) is delivered the event; the wrapper in
 * src/shellapi.js then calls `plugin:window|destroy` unless the handler
 * preventDefault-ed. AGENTS.md invariants 2–7 document the contracts.
 *
 * Loading: production serves the Vite build (dist/) over the privileged
 * `app://` protocol — a `file://` load would fail CORS for the ES-module
 * bundle, and the dev server is used when VITE_DEV_SERVER_URL is set
 * (`npm run electron:dev`).
 */
const { app, BrowserWindow, Menu, ipcMain, shell, protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = fs.promises;
const os = require("node:os");

const DIST = path.join(__dirname, "..", "dist");
const DEV_URL = process.env.VITE_DEV_SERVER_URL || null;
// The close-requested event name (the shell window API's TauriEvent constant,
// kept verbatim: src/shellapi.js and the test stubs register listeners for it).
const CLOSE_REQUESTED = "tauri://close-requested";

/** trace — opt-in main-process lifecycle journal (ELECTRON_TRACE=1). The
    close-chain (intercept → event delivery → destroy) is otherwise invisible
    to the outside; the probe/journal makes it debuggable headlessly. */
function trace(msg) {
  if (process.env.ELECTRON_TRACE) {
    try { console.log("[shell-trace]", msg); } catch { /* stderr closed */ }
  }
}

/* The bundle is served over `app://` so ES-module scripts, CSS, and the KaTeX
   woff2 fonts load with a real origin (file:// + <script type=module> is
   CORS-blocked in Chromium). Privileges must be registered BEFORE app ready. */
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

/* Production CSP — mirrors the old Tauri config (tauri.conf.json app.security.csp)
   plus the bits the app needs (inline styles: mermaid SVG sheets, KaTeX spans,
   the overlay) and data: fonts/images. Dev loads via http and is not CSP'd
   (vite's HMR websocket needs ws://). Applied as a response header by the
   app:// handler, never as a page <meta>. */
const APP_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

let win = null;
/* Shell event registry: webContents id → Map<event name, Set<event id>>.
   The main process only needs the COUNT (decides "walk vs close" on window
   close); actual dispatch is renderer-side (preload keeps the callbacks). */
const shellListeners = new Map();
let shellEventSeq = 0;

/** warnMissingBuild — explain a missing dist/ in a dialog (helps first runs). */
function warnMissingBuild() {
  try {
    const { dialog } = require("electron");
    dialog.showErrorBox(
      "Markdown Editor",
      "The built frontend (dist/index.html) was not found.\n\nRun `npm run build` (or `npm run electron:start`) first, then start the app again."
    );
  } catch { /* headless/test env — nothing to show */ }
}

/**
 * handleAppProtocol — serve dist/ over app://<host>/<path>.
 *
 * The host segment is decorative (any host maps to dist/); only the pathname
 * is used, resolved and contained against the dist root (no `..` escapes).
 * Missing index.html → 503 with a build hint; missing assets → 404.
 * @param {Electron.ProtocolRequest} request The incoming request.
 * @returns {Promise<Response>} The file contents with proper MIME + CSP.
 */
async function handleAppProtocol(request) {
  const root = path.resolve(DIST);
  const u = new URL(request.url);
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
  if (!rel) rel = "index.html";
  const fp = path.resolve(root, rel);
  if (fp !== root && !fp.startsWith(root + path.sep)) {
    return new Response("Forbidden", { status: 403, headers: { "content-type": "text/plain" } });
  }
  let data = null;
  try {
    data = await fsp.readFile(fp);
  } catch {
    if (rel === "index.html") {
      warnMissingBuild();
      return new Response(
        "<html><body><h3>Build missing</h3><p>dist/index.html not found — run <code>npm run build</code> first.</p></body></html>",
        { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  }
  const ext = path.extname(fp).toLowerCase();
  return new Response(data, {
    headers: {
      "content-type": MIME[ext] || "application/octet-stream",
      "content-length": String(data.byteLength),
      "content-security-policy": APP_CSP,
    },
  });
}

/* ---- shell IPC handlers (the `plugin:*` command set) ---- */

/**
 * headerPath — the write commands' destination path. plugin-fs carries it
 * URL-encoded in options.headers.path (a Windows path must survive the
 * transport), with a plain args.path fallback; decode defensively.
 * @param {any} args The command arguments.
 * @param {object} [options] The request options.
 * @returns {string|null} The decoded absolute path, or null.
 */
function headerPath(args, options) {
  let p = (options && options.headers && options.headers.path) || (args && args.path) || "";
  if (!p) return null;
  if (p.includes("%")) { try { p = decodeURIComponent(p); } catch { /* keep as-is */ } }
  return p;
}

/**
 * toBuffer — normalize an invoke payload into a Node Buffer for disk writes.
 * Accepts the shapes the wrappers send (Uint8Array from TextEncoder / jsPDF,
 * ArrayBuffer, or a plain string) over structured-clone IPC.
 * @param {any} args The write payload.
 * @returns {Buffer} The bytes to write.
 */
function toBuffer(args) {
  if (args instanceof ArrayBuffer) return Buffer.from(new Uint8Array(args));
  if (ArrayBuffer.isView(args)) {
    return Buffer.from(args.buffer, args.byteOffset, args.byteLength);
  }
  if (typeof args === "string") return Buffer.from(args, "utf8");
  return Buffer.from(new Uint8Array());
}

/**
 * readDirEntries — list a directory the way the picker expects (DirEntry
 * shape: name/path/isDirectory/isFile/isSymlink). Dot (hidden) entries are
 * listed naturally — the old Tauri `requireLiteralLeadingDot:false` scope
 * quirk has no equivalent here; nothing filters them.
 * @param {string} dir Absolute directory path.
 * @returns {Promise<Array<object>>} The entries.
 */
async function readDirEntries(dir) {
  if (!dir) throw new Error("no path");
  const dirents = await fsp.readdir(dir, { withFileTypes: true });
  return dirents.map((d) => ({
    name: d.name,
    path: path.join(dir, d.name),
    isDirectory: d.isDirectory(),
    isFile: d.isFile(),
    isSymlink: d.isSymbolicLink(),
  }));
}

/**
 * resolveDirectory — map the shell's BaseDirectory ordinal (21 = Home, the
 * value @tauri-apps/api's homeDir() sent) to the OS home directory.
 * @param {number|string} directory The directory selector.
 * @returns {Promise<string>} The resolved path.
 */
async function resolveDirectory(directory) {
  if (directory === 21 || directory === "~" || directory === undefined || directory === null) {
    return os.homedir();
  }
  return String(directory);
}

/**
 * openExternalUrl — open a URL with the system handler. Scheme allowlist
 * (http/https/mailto) mirrors the old opener plugin's default behavior;
 * anything else rejects (links.js falls back, or does nothing — no shell
 * command execution from document links).
 * @param {string} url The URL to open.
 * @returns {Promise<void>}
 */
async function openExternalUrl(url) {
  if (!/^https?:\/\//i.test(String(url || "")) && !/^mailto:/i.test(String(url || ""))) {
    throw new Error("unsupported url: " + url);
  }
  await shell.openExternal(String(url));
}

/**
 * registerShellListener — record that this window registered a listener for
 * an event (the close walk counts them). Returns the event id the renderer
 * keys its callback on.
 * @param {Electron.WebContents} sender The registering webContents.
 * @param {string} event The event name.
 * @returns {number} The event id.
 */
function registerShellListener(sender, event) {
  let perWin = shellListeners.get(sender.id);
  if (!perWin) { perWin = new Map(); shellListeners.set(sender.id, perWin); }
  let ids = perWin.get(event);
  if (!ids) { ids = new Set(); perWin.set(event, ids); }
  const id = ++shellEventSeq;
  ids.add(id);
  return id;
}

/**
 * unregisterShellListener — drop one registered listener by id.
 * @param {Electron.WebContents} sender The webContents that unlistens.
 * @param {number} eventId The event id returned by registerShellListener.
 * @returns {void}
 */
function unregisterShellListener(sender, eventId) {
  const perWin = shellListeners.get(sender.id);
  if (!perWin) return;
  for (const [event, ids] of perWin) {
    if (ids.delete(eventId) && ids.size === 0) perWin.delete(event);
  }
  if (perWin.size === 0) shellListeners.delete(sender.id);
}

/**
 * deliverCloseRequested — ask the renderer to run its close-confirm walk.
 * Sends the close-requested event through the shim; the app's handler then
 * either preventDefaults (stay open) or lets the wrapper call destroy.
 * @param {Electron.BrowserWindow} win The window whose close was requested.
 * @returns {void}
 */
function deliverCloseRequested(win) {
  win.webContents.send("shell:event", { event: CLOSE_REQUESTED, payload: null, id: 1 });
}

/**
 * dispatch — route one shell command to its native handler.
 * @param {Electron.IpcMainInvokeEvent} event The invoke event (finds windows).
 * @param {string} cmd The plugin command.
 * @param {any} args Command arguments.
 * @param {object} [options] Request options (headers for the write commands).
 * @returns {Promise<any>} The command result (null for fire-and-forget ops).
 */
async function dispatch(event, cmd, args, options) {
  switch (cmd) {
    case "plugin:fs|read_text_file":
    case "plugin:fs|read_file": {
      const p = headerPath(args, options) || (args && args.path);
      if (!p) throw new Error("no path");
      return await fsp.readFile(p);
    }
    case "plugin:fs|write_text_file":
    case "plugin:fs|write_file": {
      const p = headerPath(args, options);
      if (!p) throw new Error("no path");
      // The payload IS the bytes (first positional arg, plugin-fs shape).
      await fsp.writeFile(p, toBuffer(args));
      return null;
    }
    case "plugin:fs|read_dir":
      return await readDirEntries(args && args.path);
    case "plugin:fs|exists": {
      try {
        await fsp.stat(headerPath(args, options) || (args && args.path));
        return true;
      } catch {
        return false;
      }
    }
    case "plugin:path|resolve_directory":
      return await resolveDirectory(args && args.directory);
    case "plugin:opener|open_url":
      return await openExternalUrl(args && args.url);
    case "plugin:opener|open_path":
      if (!args || !args.path) throw new Error("no path");
      return await shell.openPath(String(args.path));
    case "plugin:opener|reveal_item_in_dir":
      if (args && Array.isArray(args.paths)) shell.showItemInFolder(args.paths[0]);
      return null;
    case "plugin:event|listen":
      trace("plugin:event|listen " + (args && args.event) + " (target " + JSON.stringify(args && args.target) + ")");
      return registerShellListener(event.sender, (args && args.event) || "");
    case "plugin:event|unlisten":
      unregisterShellListener(event.sender, args && args.eventId);
      return null;
    case "plugin:event|emit":
    case "plugin:event|emit_to":
      return null; // renderer→shell emit is unused by this app
    case "plugin:window|destroy": {
      // FORCE close: skips 'close' + beforeunload — matches the Tauri
      // destroy() semantics the wrapper relies on (the close walk has already
      // saved the session via closeApp(), so skipping beforeunload is safe).
      const w = BrowserWindow.fromWebContents(event.sender);
      trace("plugin:window|destroy (label=" + (args && args.label) + ", found=" + !!w + ")");
      if (w) { w.__forceClose = true; w.destroy(); }
      return null;
    }
    case "plugin:window|close": {
      // close() re-requests a close — same shape as the OS close button.
      const w = BrowserWindow.fromWebContents(event.sender);
      if (w) requestClose(w);
      return null;
    }
    default:
      return null;
  }
}

/**
 * requestClose — run the close-requested flow for a window: deliver the event
 * to the renderer when it registered a listener (the confirm walk); otherwise
 * close directly (nothing is watching — mirrors the shell closing a window
 * that never registered a close-requested handler, e.g. during startup).
 * @param {Electron.BrowserWindow} win The window to close.
 * @returns {void}
 */
function requestClose(win) {
  const perWin = shellListeners.get(win.webContents.id);
  const hasClose = perWin && perWin.get(CLOSE_REQUESTED) && perWin.get(CLOSE_REQUESTED).size > 0;
  trace("requestClose → " + (hasClose ? "deliver close-requested to renderer" : "no listener — close directly"));
  if (hasClose) {
    deliverCloseRequested(win);
  } else {
    win.__allowClose = true;
    win.close();
  }
}

/**
 * createWindow — build and show the editor window.
 *
 * Dimensions/title/min sizes come from the old tauri.conf.json window config
 * (1200×780, min 720×400). The preload installs the shell bridge
 * (contextIsolation off so page callbacks live in the same realm as the
 * bridge — no bridge serialization surprises for byte payloads or event
 * callbacks; nodeIntegration stays off so the page itself has no Node).
 * @returns {Electron.BrowserWindow} The created window.
 */
function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 720,
    minHeight: 400,
    title: "Markdown Editor",
    backgroundColor: "#f5f5f5",
    show: false,
    // Window icon hint: dev/Linux only (packaged Linux gets the icon from the
    // .desktop entry + hicolor files — build/ is not packed into the asar).
    icon: app.isPackaged ? undefined : path.join(__dirname, "..", "build", "icons", "128x128.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  /* Close-confirm flow (AGENTS.md invariant 3): intercept the OS close,
     deliver close-requested to the renderer, and only close for real when the
     renderer calls destroy (or nothing is watching). Never close() from here
     into the walk — that would re-request close and deadlock the window. */
  const wcId = win.webContents.id; // capture NOW — after 'closed' the window object reads as destroyed
  win.on("close", (e) => {
    if (win.__forceClose || win.__allowClose) {
      trace("close → sanctioned (force=" + !!win.__forceClose + " allow=" + !!win.__allowClose + ")");
      return;
    }
    e.preventDefault();
    trace("close → intercepted (webContents " + wcId + ")");
    requestClose(win);
  });
  win.on("closed", () => {
    // `win` is destroyed here; use the id captured at creation (reading
    // win.webContents would throw "Object has been destroyed").
    shellListeners.delete(wcId);
    trace("closed (webContents " + wcId + ")");
    win = null;
  });

  /* Navigation hardening: the app is a local bundle — never let it navigate
     the window away (dropped files, stray window.open). External URLs go to
     the system handler instead. */
  win.webContents.on("will-navigate", (e, url) => {
    const allowed = (DEV_URL && url.startsWith(DEV_URL)) || url.startsWith("app://");
    if (!allowed) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadURL("app://editor/index.html");
  }
  win.once("ready-to-show", () => win.show());

  // Dev-only nicety: F12 toggles devtools (the old Tauri dev build had logs).
  if (!app.isPackaged) {
    win.webContents.on("before-input-event", (e, input) => {
      if (input.type === "keyDown" && input.key === "F12") {
        win.webContents.toggleDevTools();
        e.preventDefault();
      }
    });
  }
  return win;
}

/* ---- app lifecycle ---- */

app.setName("Markdown Editor");
if (process.platform === "win32") app.setAppUserModelId("com.mssok.markdowneditor");

/* Menu: none on Windows/Linux (matches the old Tauri shell — the editor's
   own keybinds own every shortcut). macOS needs the standard app/edit menu
   (no menubar = no Cmd+C/V/Copy-Paste at all there), including Quit, which
   funnels through app.quit → window close → the close-confirm walk. */
if (process.platform === "darwin") {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ] },
    { role: "editMenu" },
    { role: "windowMenu" },
  ]));
} else {
  Menu.setApplicationMenu(null);
}

ipcMain.handle("shell:invoke", async (event, payload) => {
  const { cmd, args, options } = payload || {};
  try {
    return { ok: true, data: await dispatch(event, cmd, args, options) };
  } catch (err) {
    // Structured error return (not a throw): keeps the exact message —
    // Electron's ipc rejection prefixes messages, and the picker surfaces
    // them verbatim ("Cannot read <dir> — path not allowed").
    return { ok: false, shellError: (err && err.message) || String(err) };
  }
});

app.whenReady().then(() => {
  protocol.handle("app", handleAppProtocol);
  createWindow();
});

app.on("window-all-closed", () => {
  // Standard shell behavior: quit when the last window closes, except on
  // macOS (window stays available via the Dock).
  trace("window-all-closed (platform " + process.platform + ")");
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => trace("will-quit"));
app.on("quit", () => trace("quit"));

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
