/**
 * shellapi.js — the desktop-shell IPC layer for the editor bundle.
 *
 * The app was converted from the Tauri shell to Electron (electron/main.cjs +
 * electron/preload.cjs). To keep the conversion low-risk, the frontend keeps
 * speaking the SAME wire contract the Playwright harnesses stub — every native
 * operation is a command over `window.__TAURI_INTERNALS__.invoke`:
 *
 *   plugin:fs|read_text_file   { path, options }                → BYTES (decoded below)
 *   plugin:fs|write_text_file  <bytes>, { headers: { path } }  → null   (UTF-8 text write)
 *   plugin:fs|write_file       <bytes>, { headers: { path } }  → null   (binary write)
 *   plugin:fs|read_dir         { path, options }               → [DirEntry]
 *   plugin:fs|exists           { path, options }               → boolean
 *   plugin:path|resolve_directory { directory }                 → home dir string
 *   plugin:opener|open_url     { url, with }                   → null
 *   plugin:opener|open_path    { path, with }                  → null
 *   plugin:opener|reveal_item_in_dir { paths }                 → null
 *   plugin:event|listen        { event, target, handler }      → event id
 *   plugin:event|unlisten      { event, eventId }              → null
 *   plugin:window|destroy      { label }                       → force-close
 *
 * The preload shim (electron/preload.cjs) implements the renderer side of this
 * contract; `test/verifyTauriClose.mjs` (+ verifyExport / verifyMath /
 * verifyDialogScroll / verifyRecent) stub it with the same command names, so
 * the Playwright harnesses exercise the same code paths the real app runs.
 *
 * The functions below replicate — verbatim where possible — the wrapper
 * semantics of the previously-used @tauri-apps/api + plugin packages:
 * readTextFile treats the invoke result as BYTES (Uint8Array + TextDecoder);
 * the write wrappers TextEncoder/encode text and carry the destination path
 * URL-encoded in `options.headers.path` (a Windows path like `C:\Users\…`
 * survives URL-encoding; a header value is never mangled by the transport).
 *
 * IMPORTANT (invariants 2 & 8 in AGENTS.md): this module is imported
 * STATICALLY into the single Vite bundle. Never convert it to a dynamic
 * import(); a failed runtime chunk fetch silently disables save/open, export,
 * and the window-close guard.
 *
 * Node-importable (test.mjs loads this graph): no top-level `window` access —
 * the shell global is read lazily inside each call, after the isTauri() gates.
 */

/**
 * invoke — send one shell command through the shell bridge.
 * @param {string} cmd The plugin command (e.g. "plugin:fs|read_text_file").
 * @param {any} [args] Command arguments; bytes for the write commands, an object otherwise.
 * @param {object} [options] Request options (the write wrappers carry the
 *   destination path URL-encoded in `options.headers.path`).
 * @returns {Promise<any>} The command's result; rejects with the shell's error message.
 * @throws When there is no shell bridge (plain browser — callers must guard with isTauri()).
 */
async function invoke(cmd, args = {}, options) {
  if (typeof window === "undefined" || !window.__TAURI_INTERNALS__) {
    throw new Error("shell bridge unavailable");
  }
  return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
}

/**
 * transformCallback — register a callback with the shell bridge and get its id
 * (the event system's handle; the shell dispatches events to the id).
 * @param {Function} cb The callback to register.
 * @param {boolean} [once=false] Reserved (single-shot semantics; unused here).
 * @returns {number} The callback id.
 */
function transformCallback(cb, once = false) {
  return window.__TAURI_INTERNALS__.transformCallback(cb, once);
}

/**
 * readTextFile — read an entire file as a UTF-8 string.
 *
 * The bridge returns BYTES (as the old Tauri plugin did — a plain string would
 * iterate as chars → garbage via Uint8Array.from), so decode them here.
 * @param {string} path Absolute file path.
 * @param {object} [options] Options forwarded with the command (unused today).
 * @returns {Promise<string>} The file contents as text.
 */
async function readTextFile(path, options) {
  const arr = await invoke("plugin:fs|read_text_file", { path, options });
  const bytes = arr instanceof ArrayBuffer ? arr : Uint8Array.from(arr);
  return new TextDecoder(options?.encoding ?? "utf-8").decode(bytes);
}

/**
 * writeTextFile — write a UTF-8 string to a file, creating or overwriting it.
 *
 * The text is encoded to bytes here and the destination path travels
 * URL-encoded in `options.headers.path` (see the module docstring).
 * @param {string} path Absolute destination path.
 * @param {string} data The UTF-8 text to write.
 * @param {object} [options] Options forwarded with the command (unused today).
 * @returns {Promise<void>} Resolves when the bytes are on disk.
 */
async function writeTextFile(path, data, options) {
  const encoder = new TextEncoder();
  await invoke("plugin:fs|write_text_file", encoder.encode(data), {
    headers: { path: encodeURIComponent(path) },
  });
}

/**
 * writeFile — write raw binary bytes to a file, creating or overwriting it.
 * Used by the PDF export (jsPDF ArrayBuffer → Uint8Array).
 * @param {string} path Absolute destination path.
 * @param {Uint8Array|ArrayBuffer} data The binary payload.
 * @param {object} [options] Options forwarded with the command (unused today).
 * @returns {Promise<void>} Resolves when the bytes are on disk.
 */
async function writeFile(path, data, options) {
  await invoke("plugin:fs|write_file", data, {
    headers: { path: encodeURIComponent(path) },
  });
}

/**
 * readDir — list one directory's entries (files + folders, dot-entries included).
 * @param {string} path Absolute directory path.
 * @param {object} [options] Options forwarded with the command (unused today).
 * @returns {Promise<Array<{name: string, path: string, isDirectory: boolean, isFile: boolean, isSymlink: boolean}>>} The entries.
 */
async function readDir(path, options) {
  return await invoke("plugin:fs|read_dir", {
    path: path instanceof URL ? path.toString() : path,
    options,
  });
}

/**
 * exists — whether a native path exists (file or directory).
 * @param {string} path Absolute path to probe.
 * @param {object} [options] Options forwarded with the command (unused today).
 * @returns {Promise<boolean>} true when the path exists.
 */
async function exists(path, options) {
  return await invoke("plugin:fs|exists", { path, options });
}

/**
 * homeDir — resolve the user's home directory (the picker's opening dir).
 *
 * `21` is the shell's BaseDirectory.Home ordinal (the same value the old
 * @tauri-apps/api path.js sent for homeDir()).
 * @returns {Promise<string>} The home directory path.
 */
async function homeDir() {
  return invoke("plugin:path|resolve_directory", { directory: 21 });
}

/**
 * openUrl — open a URL in the user's default browser/handler (links, mailto).
 * @param {string} url Absolute URL to open.
 * @param {string} [openWith] Reserved (app override; unused today).
 * @returns {Promise<void>} Resolves when the OS accepted the URL.
 */
async function openUrl(url, openWith) {
  await invoke("plugin:opener|open_url", { url, with: openWith });
}

/**
 * revealItemInDir — show a file in the system file manager (native only).
 *
 * The Electron main process answers `plugin:opener|reveal_item_in_dir` with
 * `shell.showItemInFolder(paths[0])`; the browser fallback has no equivalent
 * (the tab context menu disables the item when `isTauri()` is false).
 * @param {string} path Absolute path of the file to reveal.
 * @returns {Promise<void>} Resolves when the shell accepted the request.
 */
async function revealItemInDir(path) {
  await invoke("plugin:opener|reveal_item_in_dir", { paths: [path] });
}

/**
 * pathForFile — resolve a File object (drag & drop) to its absolute disk path.
 *
 * The shell injects `window.__shellGetPathForFile` (Electron's webUtils
 *.getPathForFile — `File.path` was removed from Electron). Falls back to
 * `file.path` for engines that still carry it, and to null in a plain browser
 * (where dropped files have no disk path and the app reads `file.text()`).
 * @param {File} file A File object from a drop event.
 * @returns {string|null} The absolute path, or null when unavailable.
 */
function pathForFile(file) {
  if (typeof window !== "undefined" && window.__shellGetPathForFile) {
    const p = window.__shellGetPathForFile(file);
    if (p) return p;
  }
  return (file && file.path) || null;
}

/* ---- window API (mirrors @tauri-apps/api window.js) ---- */

/**
 * shellWindow — a minimal Window facade for the current shell window.
 *
 * The app uses exactly three operations: listen (events), onCloseRequested
 * (the close-confirm walk), and destroy (the actual close). The
 * onCloseRequested wrapper reproduces the shell wrapper contract
 * (`await handler(evt); if (!evt.isPreventDefault()) await this.destroy()`),
 * i.e. it AUTO-DESTROYS the window unless the handler preventDefaults — see
 * AGENTS.md invariant 3 for why the handler must never call close() itself.
 * @param {string} label The window label from shell metadata.
 * @returns {{label: string, listen: Function, onCloseRequested: Function, destroy: Function}} The window facade.
 */
function shellWindow(label) {
  return {
    label,
    /**
     * listen — register an event listener on this window.
     * @param {string} event Event name (e.g. "tauri://close-requested").
     * @param {Function} handler Called with {event, id, payload}.
     * @returns {Promise<Function>} Resolves to the unlisten function.
     */
    async listen(event, handler) {
      const eventId = await invoke("plugin:event|listen", {
        event,
        target: { kind: "Window", label: this.label },
        handler: transformCallback(handler),
      });
      return async () => {
        await invoke("plugin:event|unlisten", { event, eventId });
      };
    },
    /**
     * onCloseRequested — register the window-close confirm handler.
     *
     * Wrapper contract: run the handler, then destroy() unless the handler
     * called evt.preventDefault(). The event object mirrors the shell's
     * CloseRequestedEvent (event/id fields + preventDefault()/isPreventDefault()).
     * @param {Function} handler The close-confirm handler (async ok).
     * @returns {Promise<Function>} Resolves to the unlisten function.
     */
    async onCloseRequested(handler) {
      return this.listen("tauri://close-requested", async (event) => {
        const evt = {
          event: event.event,
          id: event.id,
          _preventDefault: false,
          /** preventDefault — mark the close request as cancelled. */
          preventDefault() { this._preventDefault = true; },
          /** isPreventDefault — whether the close request was cancelled. */
          isPreventDefault() { return this._preventDefault; },
        };
        await handler(evt);
        if (!evt.isPreventDefault()) {
          await this.destroy();
        }
      });
    },
    /**
     * destroy — force-close the window (no close-requested re-emit; the
     * shell skips the renderer's beforeunload, exactly like the old shell).
     * @returns {Promise<void>} Resolves when the close was requested.
     */
    async destroy() {
      return invoke("plugin:window|destroy", { label: this.label });
    },
  };
}

/**
 * getCurrentWindow — the Window facade for the current shell window.
 *
 * Reads the label from shell metadata at CALL time (the shell global may be
 * injected after this module loads — e.g. the test harnesses install it via
 * addInitScript, and the Electron preload runs before the bundle anyway).
 * @returns {{label: string, listen: Function, onCloseRequested: Function, destroy: Function}} The window facade.
 */
function getCurrentWindow() {
  return shellWindow(window.__TAURI_INTERNALS__.metadata.currentWindow.label);
}

export {
  invoke,
  transformCallback,
  readTextFile,
  writeTextFile,
  writeFile,
  readDir,
  exists,
  homeDir,
  openUrl,
  revealItemInDir,
  pathForFile,
  getCurrentWindow,
};
