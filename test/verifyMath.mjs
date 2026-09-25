/**
 * verifyMath.mjs — LaTeX math rendering verification (Playwright, Chromium).
 *
 * Pins the KaTeX pipeline end-to-end:
 *  - Live preview: a `$$…$$` display block and inline `$…$` render as KaTeX
 *    (synchronously — no flicker window like mermaid's), prose dollars
 *    ("$5 and $10") and math inside code regions stay literal, the fresh
 *    "$$\n\n$$" toolbar scaffold shows its markers (blank-fence guard), and
 *    invalid LaTeX paints in red (throwOnError:false).
 *  - HTML export: a math document embeds the SELF-CONTAINED KaTeX stylesheet
 *    (fonts as data: URIs — no CDN, no sibling files); a math-free document
 *    embeds no katex css at all (conditional-embedding pin).
 *  - PDF export: a math document rasterizes through html2canvas without
 *    errors (the output:"html" choice keeps the hidden MathML copy out of
 *    the raster).
 *
 * Run with `npm run verify-math`.
 */
import { chromium } from "playwright";
import { execSync, spawn } from "node:child_process";

const PORT = 4910;
try { execSync(`kill $(lsof -ti tcp:${PORT}) 2>/dev/null || true`, { stdio: "ignore" }); } catch {}
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await new Promise((r) => setTimeout(r, 1500));

let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (label, cond, extra) => { const c = !!cond; console.log((c ? "ok  " : "FAIL ") + label + (extra !== undefined ? "   → " + extra : "")); c ? pass++ : fail++; };
/** wait — sleep for `ms` milliseconds. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
setTimeout(() => { console.error("\nWATCHDOG: run stalled (>75s)"); process.exit(3); }, 75000);

/**
 * installInternals — minimal Tauri `__TAURI_INTERNALS__` stub (same shape as
 * verifyExport.mjs): records text/binary writes on `window.__state` and
 * auto-answers the picker's IPC so export flows complete headlessly.
 */
function installInternals() {
  const S = { textWrites: [], binaryWrites: [] };
  window.__state = S;
  window.__TAURI_INTERNALS__ = {
    __TAURI_METADATA__: { currentWindow: { label: "main", id: 1 } },
    transformCallback(fn) { return 1; },
    unregisterCallback() {},
    convertFileSrc() { return "tauri://local/"; },
    async invoke(cmd, args, options) {
      switch (cmd) {
        case "plugin:fs|write_text_file": {
          let bytes = args instanceof Uint8Array ? args : new Uint8Array();
          const hp = (options && options.headers && options.headers.path) || null;
          S.textWrites.push({ path: hp ? decodeURIComponent(hp) : null, bytes });
          return null;
        }
        case "plugin:fs|write_file": {
          let bytes = args instanceof Uint8Array ? args : new Uint8Array();
          const hp = (options && options.headers && options.headers.path) || null;
          S.binaryWrites.push({ path: hp ? decodeURIComponent(hp) : null, bytes });
          return null;
        }
        default: return null;
      }
    },
  };
}

/**
 * scenario — run one case in a fresh context (Tauri stubs installed).
 * @param {string} name — the scenario label.
 * @param {Function} run — async ({page}) body.
 */
async function scenario(name, run) {
  const context = await browser.newContext();
  await context.addInitScript(installInternals);
  const page = await context.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
  console.log("\n== " + name + " ==");
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    await wait(300);
    await run(page);
  } catch (e) {
    console.log("   !!! SCENARIO THREW: " + (e && e.message ? e.message : e));
    fail++;
  }
  await context.close();
  console.log("   (console/page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
  return errors;
}

const GAMMA_DOC = "# Math\n\n$$\\Gamma(z) = \\int_0^\\infty t^{z-1} e^{-t}\\,dt$$\n\nInline $e^{i\\pi} + 1 = 0$ math.\n";

// ---- R: live preview rendering -------------------------------------------
await scenario("R: preview renders block + inline math", async (page) => {
  await page.evaluate((doc) => window.editor.setDocumentText(doc), GAMMA_DOC);
  await wait(250);
  ok("R1 display math renders .katex-display", (await page.locator(".preview .katex-display").count()) === 1);
  ok("R2 inline math renders .katex", (await page.locator(".preview .katex").count()) === 2);
  ok("R3 no raw $$ left in the preview", !(await page.locator(".preview").innerHTML()).includes("$$"));
  // Keystroke elsewhere (syncDom rewrite) keeps the typeset math — math is
  // part of the synchronous html string, unlike mermaid's async restore.
  await page.evaluate((doc) => window.editor.setDocumentText(doc + "\nMore prose.\n"), GAMMA_DOC);
  await wait(250);
  ok("R4 math survives a preview rewrite", (await page.locator(".preview .katex-display").count()) === 1);
});

// ---- G: scanner guards in the live preview --------------------------------
await scenario("G: code regions + prose dollars stay literal", async (page) => {
  await page.evaluate(() => window.editor.setDocumentText(
    "```\n$$x$$\n```\n\ncode `$y^2$` inline\n\ncosts $5 and $10 total\n\n$$\n\n$$\n"
  ));
  await wait(250);
  ok("G1 no katex anywhere in a guards-only document", (await page.locator(".preview .katex").count()) === 0);
  const html = await page.locator(".preview").innerHTML();
  ok("G2 fence $$ stays visible", html.includes("$$x$$"));
  ok("G3 inline-code $ stays visible", html.includes("$y^2$"));
  ok("G4 currency dollars stay visible", html.includes("$5 and $10"));
  ok("G5 blank $$ scaffold shows its markers", html.includes("$$"));
  // Invalid latex paints red (katex 0.18: inline color:#cc0000 on the source).
  await page.evaluate(() => window.editor.setDocumentText("$$\\badcmd{x}$$\n"));
  await wait(250);
  const err = await page.locator(".preview .katex").first().innerHTML();
  ok("G6 invalid latex renders in red", /#cc0000|katex-error/.test(err), err.slice(0, 80));
});

// ---- E1: HTML export with math embeds the self-contained katex css --------
await scenario("E1: HTML export with math embeds inlined katex fonts", async (page) => {
  await page.evaluate((doc) => {
    const a = window.editor.activeTab;
    a.input.value = doc;
    a.name = "math_test.md";
    a.path = null;
    a.dirty = true;
  }, GAMMA_DOC);
  await page.locator('[data-action="menu"]').click();
  await wait(60);
  await page.locator('[data-submenu="export"]').hover(); // reveal the Export submenu
  await wait(150);
  await page.locator(".menu-item", { hasText: "As HTML" }).click();
  await page.waitForSelector(".picker-name", { timeout: 2500 });
  await page.locator(".picker-name input").fill("math_out.html");
  await page.locator(".savedlg button.primary").click();
  await wait(1200);
  const S = await page.evaluate(() => window.__state);
  ok("E1a write_text_file invoked", S.textWrites.length === 1, JSON.stringify(S.textWrites.map((w) => w.path)));
  if (S.textWrites.length) {
    const text = new TextDecoder().decode(S.textWrites[0].bytes);
    ok("E1b export contains typeset display math", text.includes("katex-display"));
    ok("E1c export contains typeset inline math", text.includes('class="katex"'));
    ok("E1d katex stylesheet embedded", text.includes(".katex"));
    ok("E1e fonts inlined as data: URIs (self-contained)", /data:font\/woff2;base64,/.test(text));
    ok("E1f no external font references left", !text.includes("url(fonts/"));
  }
});

// ---- E2: HTML export WITHOUT math embeds no katex css ----------------------
await scenario("E2: HTML export without math stays katex-free", async (page) => {
  await page.evaluate(() => {
    const a = window.editor.activeTab;
    a.input.value = "# Plain\n\nJust prose with $ signs that stay literal.\n";
    a.name = "plain.md";
    a.path = null;
    a.dirty = true;
  });
  await page.locator('[data-action="menu"]').click();
  await wait(60);
  await page.locator('[data-submenu="export"]').hover(); // reveal the Export submenu
  await wait(150);
  await page.locator(".menu-item", { hasText: "As HTML" }).click();
  await page.waitForSelector(".picker-name", { timeout: 2500 });
  await page.locator(".picker-name input").fill("plain_out.html");
  await page.locator(".savedlg button.primary").click();
  await wait(800);
  const S = await page.evaluate(() => window.__state);
  if (S.textWrites.length) {
    const text = new TextDecoder().decode(S.textWrites[0].bytes);
    ok("E2a no katex css embedded for math-free docs", !text.includes(".katex"));
    ok("E2b no font payload", !text.includes("data:font/woff2"));
  } else {
    ok("E2c export wrote a file", false);
  }
});

// ---- P: PDF export with math rasterizes without errors ---------------------
await scenario("P: PDF export with math", async (page) => {
  await page.evaluate((doc) => {
    const a = window.editor.activeTab;
    a.input.value = doc;
    a.name = "math_pdf.md";
    a.path = null;
    a.dirty = true;
  }, GAMMA_DOC);
  await page.locator('[data-action="menu"]').click();
  await wait(60);
  await page.locator('[data-submenu="export"]').hover(); // reveal the Export submenu
  await wait(150);
  await page.locator(".menu-item", { hasText: "As PDF" }).click();
  await page.waitForSelector(".picker-name", { timeout: 2500 });
  await page.locator(".picker-name input").fill("math_out.pdf");
  await page.locator(".savedlg button.primary").click();
  await wait(2500);
  const S = await page.evaluate(() => window.__state);
  ok("P1 write_file invoked for the pdf", S.binaryWrites.length === 1, JSON.stringify(S.binaryWrites.map((w) => w.path)));
  if (S.binaryWrites.length) {
    ok("P2 pdf payload is non-empty", S.binaryWrites[0].bytes.length > 1000, String(S.binaryWrites[0].bytes.length));
    ok("P3 pdf magic bytes", String.fromCharCode(...S.binaryWrites[0].bytes.slice(0, 5)) === "%PDF-");
  }
});

srv.kill("SIGKILL");
await browser.close();
console.log(`\nPASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
