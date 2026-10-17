/**
 * preload.cjs — Electron preload bridge for the editor bundle.
 *
 * The frontend speaks the shell-IPC wire contract the Playwright harnesses
 * stub (test/verifyTauriClose.mjs): every native operation is a `plugin:*`
 * command over `window.__TAURI_INTERNALS__.invoke`. This preload installs that
 * exact surface and translates it onto Electron IPC answered by
 * electron/main.cjs's `shell:invoke` router — so src/*.js needs no knowledge
 * of which shell hosts it. See src/shellapi.js for the command table.
 *
 * Runs with contextIsolation:false (main.cjs) so the callbacks registered via
 * transformCallback live in the same realm as the page — they can be invoked
 * directly when the main process delivers an event, with no bridge
 * serialization surprises for byte payloads (contextBridge would proxy them).
 * nodeIntegration stays off: the page never gets Node, only this bridge.
 */
const { ipcRenderer } = require("electron");

let cbSeq = 0;
const callbacks = new Map();  // transformCallback id → page callback
const listeners = new Map();  // event id → { event, fn }

const internals = {
  /* Mirrors what the shell injects. The Window wrapper (shellapi.js
     getCurrentWindow) reads `metadata.currentWindow.label`. */
  __TAURI_METADATA__: { currentWindow: { label: "main", id: 1 } },
  metadata: {
    currentWindow: { label: "main", id: 1 },
    currentWebview: { windowLabel: "main", label: "main", id: 1 },
  },
  plugins: {},
  /** transformCallback — store a page callback under a fresh id (event handle). */
  transformCallback(fn) { const id = ++cbSeq; callbacks.set(id, fn); return id; },
  /** unregisterCallback — drop a stored callback (unused by this app). */
  unregisterCallback(id) { callbacks.delete(id); },
  /** convertFileSrc — device path → loadable URL (unused by this app). */
  convertFileSrc(p, protocol) { return (protocol || "asset") + "://localhost/" + encodeURIComponent(p); },
  async invoke(cmd, args, options) {
    /* Event bookkeeping stays renderer-side: the handler id in the args is
       OUR transformCallback id, so intercept listen/unlisten to maintain the
       dispatch table while the main process tracks registrations (close flow
       counts them). The shell never sees real callbacks. */
    if (cmd === "plugin:event|listen") {
      const eventId = await ipcRenderer.invoke("shell:invoke", { cmd, args });
      listeners.set(eventId, { event: args && args.event, fn: callbacks.get(args && args.handler) });
      return eventId;
    }
    if (cmd === "plugin:event|unlisten") {
      const r = await ipcRenderer.invoke("shell:invoke", { cmd, args });
      listeners.delete(args && args.eventId);
      return r;
    }
    const res = await ipcRenderer.invoke("shell:invoke", { cmd, args, options });
    if (res && typeof res === "object" && "shellError" in res) {
      throw new Error(res.shellError);
    }
    return res ? res.data : null;
  },
};

/* Event delivery: the main process sends {event, payload, id} for events this
   window registered for (close-requested). Dispatch to every callback
   registered for the event name — the same shape the test stubs dispatch
   (they ignore target kinds, and so does this bridge: one window, one
   listener). */
ipcRenderer.on("shell:event", (e, data) => {
  const { event, payload, id } = data || {};
  for (const l of listeners.values()) {
    if (l.event === event && typeof l.fn === "function") {
      try {
        l.fn({ event, payload: payload === undefined ? null : payload, id: id === undefined ? 1 : id });
      } catch { /* a throwing listener must not kill the bridge */ }
    }
  }
});

/* Drag-drop File → absolute path (Electron removed File.path; webUtils is the
   supported replacement). Exposed as a page-world helper that shellapi's
   pathForFile() consults; absent in a plain browser, where dropped files have
   no disk path and the app reads file.text() instead. */
try {
  const { webUtils } = require("electron");
  window.__shellGetPathForFile = (file) => {
    try { return webUtils.getPathForFile(file) || null; } catch { return null; }
  };
} catch { /* webUtils unavailable — drop handler falls back to file.text() */ }

/* Platform facts the renderer cannot see about itself (the wheel diagnostics
   panel reports which compositor session the app is attached to). Absent in
   a plain browser — the panel then shows "browser-fallback". */
try {
  window.__SHELL_ENV = {
    waylandDisplay: process.env.WAYLAND_DISPLAY || null,
    ozoneHint: process.env.ELECTRON_OZONE_PLATFORM_HINT || null,
    nativeWheel: !!process.env.MD_NATIVE_WHEEL, // wheeloverride.js A/B hatch
  };
} catch { /* sandboxed preload — the panel falls back to its browser line */ }

window.__TAURI_INTERNALS__ = internals;
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener(event, eventId) { listeners.delete(eventId); },
};
