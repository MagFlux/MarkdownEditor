/**
 * wheeloverride.js — duplicate suppression for the WSLg wheel rescue.
 *
 * Background (full saga in AGENTS.md): on this WSLg host Chromium's X11
 * wheel decode drops notches before the DOM; the shell therefore captures
 * notches at the X layer (electron/xwheel-daemon) and re-injects each one as
 * a synthetic `mouseWheel` via webContents.sendInputEvent. When Chromium's
 * own decode DOES deliver the same notch, the page receives TWO wheel
 * events — one engine-decoded (~±120 on this stack) and one synthetic
 * (exactly ±100, our signature) — and applying both made scrolling jumpy
 * and ~2x fast. Measured pair spacing: 6–25 ms.
 *
 * Current behavior — deliberately minimal:
 *  - Events are NOT preventDefault-ed or applied manually. They flow to
 *    Chromium's normal (smooth-scrolling) wheel path — native look & feel.
 *  - Only the SECOND half of a same-notch pair is suppressed: an event whose
 *    opposite-kind partner (synth ≈ |100|, engine = anything else) with the
 *    SAME sign arrived within PAIR_MS. Exactly one application per notch;
 *    synth-only notches (engine dropped them) apply their synthetic
 *    natively; engine-only notches (daemon missed) apply normally.
 *
 * Gating: the whole module is inert unless the shell marked this page as
 * running WITH the X11 rescue (`window.__MD_RESCUE`, set by main.cjs only
 * after the daemon spawns). On every other platform / launch this file
 * changes nothing — 100% native wheel handling. `__SHELL_ENV.nativeWheel`
 * (MD_NATIVE_WHEEL=1) remains as a manual A/B escape.
 */

/* installWheelOverride — attach the pair-suppression listener.
 *
 * @returns {void}
 */
export function installWheelOverride() {
  /** Pair window (ms): measured engine/synthetic gaps run 6–25 ms; 40 keeps
      margin without reaching genuine fast-spin spacing (~20 ms at the
      extreme, and those have no opposite-kind partner). */
  const PAIR_MS = 40;
  const last = {
    down: { synth: 0, engine: 0 },
    up: { synth: 0, engine: 0 },
  };
  window.addEventListener("wheel", (ev) => {
    if (ev.ctrlKey || ev.metaKey) return; // zoom / pinch stays with the engine
    if (window.__SHELL_ENV && window.__SHELL_ENV.nativeWheel) return; // A/B hatch
    if (!window.__MD_RESCUE) return; // rescue off → wholly native behavior
    const scroller = ev.target && ev.target.closest &&
      ev.target.closest(".editor-scroll, .preview-scroll");
    if (!scroller || !ev.deltaY) return;
    const sign = ev.deltaY > 0 ? "down" : "up";
    const isSynth = ev.deltaMode === 0 && Math.abs(ev.deltaY) === 100;
    const kind = isSynth ? "synth" : "engine";
    const other = isSynth ? "engine" : "synth";
    const now = performance.now();
    if (now - last[sign][other] < PAIR_MS) {
      ev.preventDefault(); // second half of a same-notch pair — already applied
      return;
    }
    last[sign][kind] = now; // let this one apply natively (smooth path)
  }, { passive: false, capture: true });
}
