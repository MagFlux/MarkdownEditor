/**
 * wheeldiag.js — passive live wheel diagnostics panel (Ctrl+Shift+D).
 *
 * The Linux "2-4 wheel notches dead, then scrolling catches up" report could
 * not be reproduced with ANY synthetic input: CDP mouseWheel and XTest button
 * presses both scroll from the very first notch. Synthetic devices carry no
 * XI2 smooth-scroll valuator and take different Chromium input code paths
 * than a real hardware wheel, so engine-level hypotheses proved worthless
 * without ground truth. This panel stops the guessing: the USER wheels while
 * it is open and the page logs every wheel event that actually reaches the
 * renderer — deltas, deltaMode, time gap, hit target — plus how far each
 * pane then really moved (sampled ~32 ms AND ~300 ms later, because
 * Chromium's smooth-wheel animation spreads one notch over several frames
 * and the split-view follower glides even longer).
 *
 * Three readouts discriminate the failure classes:
 *  - events arrive late/not at all      → input eaten before the renderer;
 *  - deltaY bursts of 0 / ±1            → X11 valuator re-baselining class
 *    (upstream issues.chromium.org/496255940);
 *  - many small deltaY per notch        → smoothing / downsampling stream.
 *
 * Passive by construction: capture-phase `{ passive: true }` wheel listener,
 * never preventDefault, DOM exists only while open (zero cost when closed).
 * Element-only DOM via textContent — no innerHTML, nothing user-controlled.
 */

/* createWheelDiag — build the (initially closed) floating diagnostics panel.
 *
 * @param {() => object|null} getActiveTab — returns the active tab (the
 *   object carrying `.editorScroll` / `.previewScroll` panes) or null when
 *   unavailable (browser tests, empty boot).
 * @returns {{
 *   toggle: () => void,
 *   open: () => void,
 *   close: () => void,
 *   isOpen: () => boolean,
 * }} controller to wire a keybind to.
 */
export function createWheelDiag(getActiveTab) {
  const MAX_ROWS = 12; // rows kept on screen (recent last, older trimmed)
  const MAX_LOG = 500; // rows kept for Copy (whole open session)
  const rows = []; // display queue: the same record objects as log's tail
  const log = []; // full session log for the Copy button
  let panel = null;
  let rowsEl = null;
  let countEl = null;
  let opened = false;
  let seq = 0;
  let lastT = 0;

  const fmt = (v) => (v === null || v === undefined ? "—" : String(v));
  const signed = (v) => (v === null || v === undefined ? "—" : (v > 0 ? "+" : "") + v);

  /** targetName — short "tag.class" string for a wheel event's hit target. */
  function targetName(ev) {
    const el = ev.target;
    if (!el || !el.tagName) return "unknown";
    const cls = typeof el.className === "string" && el.className
      ? "." + el.className.trim().split(/\s+/)[0]
      : "";
    return el.tagName.toLowerCase() + cls;
  }

  /** toText — one row's two-line text (dashes until the samples land). */
  function toText(rec) {
    return `#${rec.n} dt=${rec.dt}ms dy=${signed(rec.dy)}${rec.mode ? "(mode" + rec.mode + ")" : ""} dx=${signed(rec.dx)} tgt=${rec.tgt}\n` +
      `    edΔ32=${signed(rec.ed32)} edΔ300=${signed(rec.ed300)}  pvΔ32=${signed(rec.pv32)} pvΔ300=${signed(rec.pv300)}`;
  }

  /** envText — engine/compositor facts the wheel-stream rows need context. */
  function envText() {
    const se = document.scrollingElement;
    const sh = window.__SHELL_ENV;
    const shell = sh
      ? `wayland=${sh.waylandDisplay || "absent"} ozoneEnv=${sh.ozoneHint || "unset"}`
      : "browser-fallback";
    return `env dpr=${window.devicePixelRatio} viewport=${window.innerWidth}x${window.innerHeight} ` +
      `docOverflow=${se ? se.scrollHeight - se.clientHeight : "?"} ${shell}`;
  }

  /** renderCount — refresh the header's event counter. */
  function renderCount() {
    if (countEl) countEl.textContent = `events: ${seq}`;
  }

  /** addRowEl — append one row div (text set now and re-set on each sample). */
  function addRowEl(rec) {
    const div = document.createElement("div");
    div.className = "wheeldiag-row";
    div.style.cssText = "border-top:1px solid rgba(255,255,255,.08);padding:2px 0;white-space:pre";
    rec.el = div;
    div.textContent = toText(rec);
    rowsEl.appendChild(div);
    return div;
  }

  /** trimRows — remove the display queue's overflow from the front. */
  function trimRows() {
    while (rows.length > MAX_ROWS) {
      const old = rows.shift();
      if (old.el && old.el.parentNode) old.el.remove();
      old.el = null;
    }
  }

  /** onWheel — the (passive, capture) event recorder. */
  function onWheel(ev) {
    const d = getActiveTab();
    const now = performance.now();
    const rec = {
      n: ++seq,
      dt: lastT ? Math.round(now - lastT) : 0,
      dx: +(ev.deltaX || 0).toFixed(2),
      dy: +(ev.deltaY || 0).toFixed(2),
      mode: ev.deltaMode,
      tgt: targetName(ev),
      ed32: null, pv32: null, ed300: null, pv300: null,
      el: null,
    };
    lastT = now;
    log.push(rec);
    if (log.length > MAX_LOG) log.shift();
    rows.push(rec);
    addRowEl(rec);
    trimRows();
    renderCount();
    if (d && d.editorScroll && d.previewScroll) {
      const ed0 = d.editorScroll.scrollTop;
      const pv0 = d.previewScroll.scrollTop;
      // Two samples: ~2 frames (instant side) and 300 ms (smooth-wheel + the
      // follower's glide both settle within that on the lead pane's own
      // position; the FOLLOWER may still be gliding at 300 ms — the lead is
      // the sign we need most, the follower columns read as it behaves).
      setTimeout(() => {
        try {
          rec.ed32 = +(d.editorScroll.scrollTop - ed0).toFixed(1);
          rec.pv32 = +(d.previewScroll.scrollTop - pv0).toFixed(1);
          if (rec.el) rec.el.textContent = toText(rec);
        } catch { /* tab closed mid-sample */ }
      }, 32);
      setTimeout(() => {
        try {
          rec.ed300 = +(d.editorScroll.scrollTop - ed0).toFixed(1);
          rec.pv300 = +(d.previewScroll.scrollTop - pv0).toFixed(1);
          if (rec.el) rec.el.textContent = toText(rec);
        } catch { /* tab closed mid-sample */ }
      }, 300);
    }
  }

  /** open — build the panel DOM and attach the recorder. */
  function open() {
    if (opened) return;
    opened = true;
    panel = document.createElement("div");
    panel.className = "wheeldiag";
    panel.style.cssText =
      "position:fixed;top:10px;right:10px;z-index:9999;background:rgba(18,20,24,.94);" +
      "color:#e8eaee;font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;" +
      "padding:8px 10px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.35);" +
      "max-width:470px;user-select:text";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;gap:8px;align-items:center";
    const title = document.createElement("span");
    title.textContent = "wheel diagnostics (live) — Esc closes";
    title.style.cssText = "opacity:.85;flex:1";
    countEl = document.createElement("span");
    countEl.textContent = "events: 0";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy";
    copy.style.cssText = "font:inherit;padding:1px 8px;cursor:pointer";
    copy.addEventListener("click", () => {
      const out = ["wheel diagnostics", envText()]
        .concat(log.map(toText)).join("\n");
      navigator.clipboard.writeText(out).then(
        () => { copy.textContent = "Copied!"; setTimeout(() => { copy.textContent = "Copy"; }, 900); },
        () => { copy.textContent = "Copy failed"; setTimeout(() => { copy.textContent = "Copy"; }, 900); }
      );
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "Close";
    closeBtn.style.cssText = "font:inherit;padding:1px 8px;cursor:pointer";
    closeBtn.addEventListener("click", close);
    head.append(title, countEl, copy, closeBtn);
    const env = document.createElement("div");
    env.style.cssText = "opacity:.7;margin-top:4px;white-space:pre-wrap";
    env.textContent = envText();
    rowsEl = document.createElement("div");
    rowsEl.style.cssText = "margin-top:6px;max-height:56vh;overflow:auto";
    panel.append(head, env, rowsEl);
    document.body.appendChild(panel);
    document.addEventListener("keydown", onEsc, true);
    document.addEventListener("wheel", onWheel, { capture: true, passive: true });
    renderCount();
  }

  /** onEsc — Escape closes the panel (does not interfere with find/modals:
      they run the global capture handlers first and act on their own Escs). */
  function onEsc(ev) {
    if (ev.key === "Escape" && opened) close();
  }

  /** close — tear down the panel and the recorder (pending samples no-op). */
  function close() {
    if (!opened) return;
    opened = false;
    document.removeEventListener("keydown", onEsc, true);
    document.removeEventListener("wheel", onWheel, { capture: true });
    if (panel && panel.parentNode) panel.remove();
    panel = null;
    rowsEl = null;
    countEl = null;
    rows.length = 0;
  }

  return {
    toggle() { if (opened) close(); else open(); },
    open,
    close,
    isOpen: () => opened,
  };
}
