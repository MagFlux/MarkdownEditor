/**
 * wheel-trace.cjs — launch the app with WAYLAND_DEBUG=1 and journal the raw
 * Wayland wire protocol to /tmp/opencode/wl-trace.log.
 *
 * Final ground-truth instrument for the WSLg wheel saga: the renderer's
 * passive listeners received NO wheel events for the first notches of every
 * real-wheel gesture (the Ctrl+Shift+D capture), and neither the GPU,
 * smooth-scrolling, protocol, nor non-passive listener changes moved it. The
 * only remaining unobserved boundary is WSLg itself — the RDP → WSLg Weston
 * pipeline carrying Windows mouse input into this WSL. This run logs
 * EVERYTHING the compositor actually sends us, so a real wheel test can be
 * classified afterward:
 *  - no wl_pointer.axis traffic during the dead notches  → WSLg's input
 *    pipeline ate them (FILE AT microsoft/wslg; app can do nothing);
 *  - axis events present with mangled attributes (axis_source=touchpad on a
 *    wheel, no discrete/value120, wild totals) → Chromium's ozone-wayland
 *    decode (report there / consider protocol or input-stack workarounds).
 * Read the journal after the window closes; grep for "wl_pointer".
 *
 * Run: npm run wheel-trace. Electron version unchanged; verbose output only
 * deviates stderr — nothing else differs from a normal run.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const file = process.env.WL_TRACE_LOG || "/tmp/opencode/wl-trace.log";
const out = fs.openSync(file, "w");
const cwd = path.join(__dirname, "..");

console.log("WAYLAND_DEBUG journal → " + file);
console.log("Wheel over the panes for ~10 seconds (slow notches AND a burst), then close the window.");

const child = spawn("npx", [
  "electron", ".",
  // Force the Wayland ozone platform as plain ARGV: env vars get scrubbed by
  // Electron at startup (verified in /proc/<pid>/environ), so an env-based
  // --ozone-platform override never reached the real process.
  "--ozone-platform=wayland",
], {
  stdio: ["ignore", out, out],
  env: { ...process.env, WAYLAND_DEBUG: "1" },
  cwd,
});

child.on("exit", () => {
  console.log("Window closed. Journal kept at " + file);
  process.exit(0);
});
