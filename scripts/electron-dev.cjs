/**
 * electron-dev.cjs — `npm run electron:dev` orchestrator.
 *
 * Starts the Vite dev server (npm run dev), waits until port 5173 answers,
 * then launches Electron with VITE_DEV_SERVER_URL set so electron/main.cjs
 * loads the dev URL instead of app://dist/index.html. Kills Vite when the
 * Electron process exits (Ctrl+C kills both). Plain Node built-ins only —
 * no concurrently-style extra dependency.
 */
const { spawn, execSync } = require("node:child_process");
const net = require("node:net");

const PORT = 5173;
const ROOT = require("node:path").join(__dirname, "..");

/**
 * wait — sleep for `ms` milliseconds.
 * @param {number} ms The delay.
 * @returns {Promise<void>}
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * portOpen — whether something is listening on the dev port.
 * @param {number} port The port to probe.
 * @returns {Promise<boolean>} true when connectable.
 */
function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    sock.on("connect", () => { sock.destroy(); resolve(true); });
    sock.on("error", () => resolve(false));
  });
}

try { execSync(`kill $(lsof -ti tcp:${PORT}) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* nothing to kill */ }

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  cwd: ROOT,
  stdio: "inherit",
  detached: true,
  windowsHide: true,
});

let shuttingDown = false;
/** killVite — terminate the dev server (idempotent). */
function killVite() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { process.kill(-vite.pid); } catch { /* already gone */ }
}

/** main — wait for the dev server, launch Electron, wire teardown. */
async function main() {
  // Wait for the dev server (up to ~30 s), then start the Electron window.
  let ready = false;
  for (let i = 0; i < 150 && vite.exitCode === null; i++) {
    if (await portOpen(PORT)) { ready = true; break; }
    await wait(200);
  }
  if (!ready) {
    console.error("electron:dev — vite dev server did not come up on port " + PORT);
    killVite();
    process.exit(1);
  }

  const electronPath = require("electron");
  const electron = spawn(electronPath, ["."], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: "http://127.0.0.1:" + PORT },
    windowsHide: true,
  });

  electron.on("exit", (code) => { killVite(); process.exit(code === null ? 0 : code); });
}

main().catch((err) => {
  console.error("electron:dev failed:", err && (err.stack || err));
  killVite();
  process.exit(1);
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { killVite(); process.exit(0); });
}
