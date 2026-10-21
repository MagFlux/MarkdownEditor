/**
 * verifyTabClick.mjs — tab-strip interaction regressions.
 *
 * 1-2. Clicking an ALREADY-active tab is a no-op: the old activate() did
 *      input.focus()+refresh() on every click, refocusing the textarea
 *      (scrolled it into view — both panes jumped 90%→~25%) and re-running
 *      marked + mermaid. activate() now short-circuits when doc === activeTab.
 * 3.   A click ANYWHERE in a tab (its padding, not just the .tname text)
 *      activates it: the whole .tab paints itself clickable (cursor:pointer +
 *      hover background) but the old activation binding sat on .tname only, so
 *      clicks on the padding changed no cursor behavior yet did nothing.
 * 4.   Ctrl+Tab / Ctrl+Shift+Tab cycle forward/backward in tab-strip order with
 *      wrap-around, without inserting a tab character into the document.
 * 5.   Pointer-dragging a tab reorders BOTH the live tab model and the DOM
 *      (both directions), keeps the active tab active (a drag never activates
 *      the dragged tab), and persists the new order to the session so a
 *      restart restores it. Tabs are NOT native HTML5-draggable.
 * 6.   Right-click opens the in-app tab context menu: the title names the
 *      right-clicked tab; Reveal in folder is native-only and Copy path works
 *      in the browser fallback (both disabled for an unsaved tab); Escape and
 *      an outside click close it; Copy path writes the exact absolute path;
 *      Reveal calls the shell's `plugin:opener|reveal_item_in_dir` command and
 *      surfaces a native failure in the in-app error modal; a modified shortcut
 *      (Ctrl+Tab) dismisses the menu and still acts; a rejected Clipboard API
 *      falls back to execCommand and restores editor focus.
 * 7.   Pointer drag owns a custom fixed ghost and the body-level FIXED
 *      insertion line: the marker shows in the dragged tab's own slot and
 *      follows the cursor across the target midpoint; on pointerup the ghost,
 *      source dim and marker are removed SYNCHRONOUSLY (no native drag-image
 *      window lingering), then the drop reorders immediately. The gesture is
 *      window-level (works without DOM pointer capture), may start on the ×
 *      close button without closing, and an unmoved × click still closes.
 *      A WSLg relay (mouse pointerdown/up + pen pointermove with a different
 *      pointerId, isPrimary) must also drag — the reported "no ghost, can't
 *      reorder" on the WSLg launch path.
 *      Run with `npm run verify-tabclick`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

// Regression: clicking a tab that is ALREADY active must be a no-op — it must
// not move the scroll position (the old activate() did input.focus() + refresh(),
// which refocused the textarea and scrolled it into view = both panes jumped,
// e.g. 90% → ~25%), and it must not rewrite the preview DOM (the old refresh()
// → syncDom() re-ran marked + the debounced mermaid render, so a mermaid diagram
// on the page visibly re-rendered on every redundant tab click).
//
// Self-contained: build, then serve on an isolated port (idempotent).
const S = 450; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync(`kill $(lsof -ti tcp:4605) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4605", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push("CONSOLE: " + m.text()); });

let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (n, c, extra) => { if (c) { pass++; console.log("ok  ", n, extra ? "→ " + extra : ""); } else { fail++; console.log("FAIL", n, extra ? "→ " + extra : ""); } };

await p.goto("http://localhost:4605/", { waitUntil: "networkidle" });
await sleep(400);

// Tall doc with a rendered mermaid diagram (so we can prove the preview DOM is
// NOT rewritten by a redundant tab click).
await p.evaluate(() => {
  const ed = window.editor;
  const para = "Paragraph " + "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(4) + "\n\n";
  const lines = [];
  lines.push("# Long document");
  for (let i = 0; i < 120; i++) lines.push("Section " + (i + 1) + ": " + para.trim() + "\n");
  lines.push("```mermaid", "flowchart LR", "    A --> B --> C: done", "```");
  ed.setDocumentText(lines.join("\n"));
});
await sleep(S);

// A DOM probe: a custom attribute on the live preview node. If a redundant
// activate() rewrites the preview (syncDom → preview.innerHTML = …), this
// attribute is wiped, so its survival proves no re-render happened.
/** armProbe — tag the first preview child with `data-tcprobe` so a re-render wipe is detectable. */
const armProbe = () => p.evaluate(() => {
  const d = window.editor.activeTab;
  const first = d.preview.firstElementChild;
  if (first) first.setAttribute("data-tcprobe", "alive");
  return { probed: !!first, mermaid: d.preview.querySelectorAll(".mermaid-diagram").length };
});
/**
 * probe — read a pane's scroll ratio and its max.
 * @param {string} which — "e" (editor) or "p" (preview).
 * @returns {Promise<{ratio: number, max: number}>}
 */
const probe = (which) => p.evaluate((w) => {
  const d = window.editor.activeTab;
  const el = w === "e" ? d.editorScroll : d.previewScroll;
  const max = el.scrollHeight - el.clientHeight;
  return { ratio: max > 0 ? el.scrollTop / max : 0, max };
}, which);
/** setScroll — scroll both panes of the active tab to ~90% of their max. */
const setScroll = () => p.evaluate(() => {
  const d = window.editor.activeTab;
  for (const el of [d.editorScroll, d.previewScroll]) {
    const max = el.scrollHeight - el.clientHeight;
    if (max > 0) el.scrollTop = Math.round(max * 0.90);
  }
});

/** tabNames — the live tab model's order. */
const tabNames = () => p.evaluate(() => window.editor.tabs.map((t) => t.name));
/** domNames — the visible tab-strip order (scoped to .tabbar: the live drag
 * ghost is a .tab clone that lives on document.body during a drag). */
const domNames = () => p.locator(".tabbar .tab .tname").allTextContents();
/** idxOf — index of a tab by its visible name in the live model. */
const idxOf = (name) => p.evaluate((n) => window.editor.tabs.findIndex((t) => t.name === n), name);
/** activeName — the active tab's name. */
const activeName = () => p.evaluate(() => window.editor.activeTab && window.editor.activeTab.name);
/** rightClickTab — open the tab context menu on a named tab. */
const rightClickTab = async (name) => {
  const idx = await idxOf(name);
  await p.locator(".tab").nth(idx).click({ button: "right" });
  await sleep(120);
};
/**
 * dragTab — perform a REAL mouse/pointer drag from one named tab to the
 * left/right half of another. The app deliberately uses pointer events rather
 * than native HTML5 DnD, so locator.dragTo() is not applicable.
 * @param {string} fromName Source tab name.
 * @param {string} toName Target tab name.
 * @param {"before"|"after"} side Drop on the target's left/right half.
 */
const dragTab = async (fromName, toName, side) => {
  const from = await idxOf(fromName);
  const to = await idxOf(toName);
  const fromBox = await p.locator(".tabbar .tab").nth(from).boundingBox();
  const toBox = await p.locator(".tabbar .tab").nth(to).boundingBox();
  const fy = fromBox.y + fromBox.height / 2;
  const ty = toBox.y + toBox.height / 2;
  await p.mouse.move(fromBox.x + fromBox.width / 2, fy);
  await p.mouse.down();
  // Cross the app's 4px drag threshold before heading for the target.
  await p.mouse.move(fromBox.x + fromBox.width / 2 + 10, fy, { steps: 2 });
  const tx = side === "after" ? toBox.x + toBox.width - 3 : toBox.x + 3;
  await p.mouse.move(tx, ty, { steps: 8 });
  await p.mouse.up();
  await sleep(350); // let the debounced session save land
};

// ---------------------------------------------------------------------------
// CASE 1 — scroll is preserved across a redundant click on the ALREADY-active
// tab. Under the old activate() the textarea re-focus scrolled it into view and
// both panes jumped (90% → ~bottom); the fix short-circuits so they stay put.
// ---------------------------------------------------------------------------
await setScroll();
await sleep(S);
const e0 = await probe("e"), pr0 = await probe("p");
await armProbe();
const activeTabIdx = await p.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  return tabs.findIndex((t) => t.classList.contains("active"));
});
ok("1a active tab exists", activeTabIdx >= 0, "index " + activeTabIdx);
ok("1b both panes scrolled to ~90%", e0.max > 200 && pr0.max > 200 && e0.ratio > 0.8 && pr0.ratio > 0.8,
   "e=" + e0.ratio.toFixed(3) + " p=" + pr0.ratio.toFixed(3));

// Click the already-active tab (.tname), several times (user "flicking" it).
for (const i of [0, 1, 2]) {
  await p.locator(".tab").nth(activeTabIdx).locator(".tname").click();
  await sleep(520); // beat any rAF/marker settling
}
const e1 = await probe("e"), pr1 = await probe("p");
ok("1c editor scroll preserved after redundant click (no jump)", Math.abs(e1.ratio - e0.ratio) <= 0.05,
   "was " + e0.ratio.toFixed(3) + " now " + e1.ratio.toFixed(3));
ok("1d preview scroll preserved after redundant click (no jump)", Math.abs(pr1.ratio - pr0.ratio) <= 0.05,
   "was " + pr0.ratio.toFixed(3) + " now " + pr1.ratio.toFixed(3));

// ---------------------------------------------------------------------------
// CASE 2 — the preview DOM is NOT rewritten (no re-render). The probe attribute
// survives a redundant tab click, and the mermaid diagram count is unchanged.
// ---------------------------------------------------------------------------
const alive = await p.evaluate(() => {
  const d = window.editor.activeTab;
  const first = d.preview.firstElementChild;
  return { probe: first ? first.getAttribute("data-tcprobe") : null, mermaid: d.preview.querySelectorAll(".mermaid-diagram").length };
});
ok("2a preview DOM not rewritten on redundant click (probe alive)", alive.probe === "alive", "probe=" + alive.probe);
ok("2b mermaid diagram still rendered, count unchanged", alive.mermaid >= 1, "mermaid=" + alive.mermaid);

// ---------------------------------------------------------------------------
// CASE 3 — a click on the tab's PADDING (NOT the .tname span) activates the
// tab. The whole .tab advertises clickability (`.tab { cursor: pointer }` and
// the hover background cover the 12px left padding around the name), but the
// activation listener used to sit on .tname only — clicks there changed
// nothing ("pointer changes, click does nothing"). The listener now binds to
// the whole .tab element (the × close button stopPropagation()s in its own
// handler, so closing never also fires activation), and 3b-3d extend case 1-2's
// no-op contract to the same padding click when the tab is ALREADY active.
// ---------------------------------------------------------------------------
await p.evaluate(() => { window.editor.newTab("PadTab", "second tab content"); });
await sleep(S);
const firstName = await p.evaluate(() => window.editor.tabs[0].name);
// x=3px is inside the tab's 12px LEFT PADDING (the .tname span starts at
// ~13px), so this click can never land on the name span itself.
const padPos = { x: 3, y: 14 };
await p.locator(".tab").first().click({ position: padPos });
await sleep(S);
const afterPad = await p.evaluate(() => window.editor.activeTab.name);
ok("3a a click on the tab PADDING (not the name) activates the tab", afterPad === firstName, "active=" + afterPad);

// Redundant padding click on the NOW-active tab: same no-op contract as case 1.
await setScroll();
await sleep(S);
const e2 = await probe("e"), pr2 = await probe("p");
await armProbe();
await p.locator(".tab").first().click({ position: padPos });
await sleep(520);
const e3 = await probe("e"), pr3 = await probe("p");
const alive3 = await p.evaluate(() => {
  const d = window.editor.activeTab;
  const first = d.preview.firstElementChild;
  return { probe: first ? first.getAttribute("data-tcprobe") : null, mermaid: d.preview.querySelectorAll(".mermaid-diagram").length };
});
ok("3b editor scroll preserved after redundant PADDING click", Math.abs(e3.ratio - e2.ratio) <= 0.05,
   "was " + e2.ratio.toFixed(3) + " now " + e3.ratio.toFixed(3));
ok("3c preview scroll preserved after redundant PADDING click", Math.abs(pr3.ratio - pr2.ratio) <= 0.05,
   "was " + pr2.ratio.toFixed(3) + " now " + pr3.ratio.toFixed(3));
ok("3d preview DOM not rewritten after redundant PADDING click (probe alive)", alive3.probe === "alive", "probe=" + alive3.probe);

// ---------------------------------------------------------------------------
// CASE 4 — Ctrl+Tab / Ctrl+Shift+Tab cycle forward/backward in strip order,
// wrapping at both ends. The same shortcut must NOT insert a tab character into
// any document (the capture-phase indent handler ignores modified Tab).
// ---------------------------------------------------------------------------
await p.evaluate(async () => {
  const ed = window.editor;
  while (ed.tabs.length > 1) {
    const d = ed.tabs[ed.tabs.length - 1];
    d.dirty = false;
    await ed.closeTab(d);
  }
  ed.name = "Tab A";
});
await p.evaluate(() => {
  window.editor.newTab("Tab B", "");
  window.editor.newTab("Tab C", "");
});
await sleep(S);
ok("4a setup is [Tab A, Tab B, Tab C] with Tab C active",
  JSON.stringify(await tabNames()) === JSON.stringify(["Tab A", "Tab B", "Tab C"]) && (await activeName()) === "Tab C",
  "order=" + (await tabNames()).join(",") + " active=" + (await activeName()));

const textBeforeCycle = await p.evaluate(() => window.editor.tabs.map((t) => t.input.value));
await p.keyboard.press("Control+Tab");
await sleep(250);
ok("4b Ctrl+Tab from the last tab wraps to the first", (await activeName()) === "Tab A", "active=" + (await activeName()));
await p.keyboard.press("Control+Tab");
await sleep(250);
ok("4c Ctrl+Tab advances forward", (await activeName()) === "Tab B", "active=" + (await activeName()));
await p.keyboard.press("Control+Shift+Tab");
await sleep(250);
ok("4d Ctrl+Shift+Tab goes backward", (await activeName()) === "Tab A", "active=" + (await activeName()));
await p.keyboard.press("Control+Shift+Tab");
await sleep(250);
ok("4e Ctrl+Shift+Tab from the first tab wraps to the last", (await activeName()) === "Tab C", "active=" + (await activeName()));
const textAfterCycle = await p.evaluate(() => window.editor.tabs.map((t) => t.input.value));
ok("4f modified Tab never inserts a tab character into any document",
  JSON.stringify(textAfterCycle) === JSON.stringify(textBeforeCycle),
  "changed=" + (JSON.stringify(textAfterCycle) !== JSON.stringify(textBeforeCycle)));

// ---------------------------------------------------------------------------
// CASE 5 — drag-to-reorder moves the tab in BOTH directions (model + DOM),
// keeps the active tab active, and persists the new order to the session.
// ---------------------------------------------------------------------------
await p.evaluate(() => window.editor.activate(window.editor.tabs.find((t) => t.name === "Tab A")));
await sleep(250);
const nativeDragOff = await p.locator(".tabbar .tab").evaluateAll((els) => els.every((e) => e.draggable === false));
ok("5a tabs use pointer drag (native HTML5 drag is disabled)", nativeDragOff,
  "count=" + (await p.locator(".tabbar .tab").count()));

await dragTab("Tab A", "Tab C", "after");
const afterFirst = await tabNames();
ok("5b dragging the first tab past the last reorders the model", JSON.stringify(afterFirst) === JSON.stringify(["Tab B", "Tab C", "Tab A"]),
  "order=" + afterFirst.join(","));
ok("5c the DOM order matches the model", JSON.stringify(await domNames()) === JSON.stringify(afterFirst),
  "dom=" + (await domNames()).join(","));
ok("5d the dragged tab stays the active tab", (await activeName()) === "Tab A", "active=" + (await activeName()));
const persisted = await p.evaluate(() => JSON.parse(localStorage.getItem("mdeditor.session.v2")).tabs.map((t) => t.name));
ok("5e the new order is persisted to the session", JSON.stringify(persisted) === JSON.stringify(afterFirst),
  "session=" + persisted.join(","));

await dragTab("Tab C", "Tab B", "before");
const afterSecond = await tabNames();
ok("5f dragging in the other direction reorders again", JSON.stringify(afterSecond) === JSON.stringify(["Tab C", "Tab B", "Tab A"]),
  "order=" + afterSecond.join(","));
ok("5g dragging a non-active tab does not activate it", (await activeName()) === "Tab A",
  "active=" + (await activeName()));

// ---------------------------------------------------------------------------
// CASE 6 — the tab context menu. Unsaved tabs disable both items; a saved path
// enables Copy path (browser + native) and Reveal in folder (native only).
// Copy path writes the exact absolute path; Reveal drives the real wire
// command and an invocation failure surfaces in the in-app error modal.
// ---------------------------------------------------------------------------
await rightClickTab("Tab A");
ok("6a right-click opens the in-app menu", await p.locator(".tabmenu").isVisible());
ok("6b the menu title names the right-clicked tab", (await p.locator(".tabmenu-title").textContent()) === "Tab A",
  "title=" + (await p.locator(".tabmenu-title").textContent()));
ok("6c an unsaved tab disables Reveal and Copy path",
  (await p.locator('[data-tab-action="reveal"]').isDisabled()) && (await p.locator('[data-tab-action="copy"]').isDisabled()));
await p.keyboard.press("Escape");
await sleep(150);
ok("6d Escape closes the menu and returns focus to the editor",
  (await p.locator(".tabmenu").isHidden()) &&
  (await p.evaluate(() => !!document.activeElement && document.activeElement.classList.contains("input"))));

await p.evaluate(() => { window.editor.tabs.find((t) => t.name === "Tab C").path = "/tmp/tab-c.md"; });
await rightClickTab("Tab C");
ok("6e a saved tab enables Copy path but Reveal stays native-only in the browser",
  !(await p.locator('[data-tab-action="copy"]').isDisabled()) && (await p.locator('[data-tab-action="reveal"]').isDisabled()));

await p.evaluate(() => {
  window.__copiedPath = null;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text) => { window.__copiedPath = text; } },
  });
});
await rightClickTab("Tab C");
await p.locator('[data-tab-action="copy"]').click();
await sleep(200);
ok("6f Copy path writes the exact absolute path", (await p.evaluate(() => window.__copiedPath)) === "/tmp/tab-c.md",
  "copied=" + (await p.evaluate(() => window.__copiedPath)));
ok("6g a fired menu action closes the menu and returns focus to the editor",
  (await p.locator(".tabmenu").isHidden()) &&
  (await p.evaluate(() => !!document.activeElement && document.activeElement.classList.contains("input"))));

await rightClickTab("Tab C");
await p.locator(".statusbar").click();
await sleep(150);
ok("6h an outside click closes the menu", await p.locator(".tabmenu").isHidden());

await p.evaluate(() => {
  window.__revealCalls = [];
  window.__revealFail = false;
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      window.__revealCalls.push({ cmd, args });
      if (window.__revealFail) throw new Error("showItemInFolder failed");
      return null;
    },
    transformCallback: () => 1,
    metadata: { currentWindow: { label: "main" } },
  };
});
await rightClickTab("Tab C");
ok("6i Reveal in folder is enabled once the native shell is present", !(await p.locator('[data-tab-action="reveal"]').isDisabled()));
await p.locator('[data-tab-action="reveal"]').click();
await sleep(200);
const revealCall = await p.evaluate(() => window.__revealCalls[0]);
ok("6j Reveal invokes the shell's reveal_item_in_dir command with the file path",
  !!revealCall && revealCall.cmd === "plugin:opener|reveal_item_in_dir" &&
  JSON.stringify(revealCall.args) === JSON.stringify({ paths: ["/tmp/tab-c.md"] }),
  JSON.stringify(revealCall));

await p.evaluate(() => { window.__revealFail = true; });
await rightClickTab("Tab C");
await p.locator('[data-tab-action="reveal"]').click();
await sleep(250);
const errTitle = await p.locator(".savedlg h3").textContent();
ok("6k a native reveal failure surfaces in the in-app error modal", errTitle === "Reveal failed", "title=" + errTitle);
await p.locator(".savedlg .btn").last().click();
await sleep(200);

// The menu is open with focus on an item; a modified shortcut must dismiss it
// (not let it float over whatever the shortcut opens) and still act.
await rightClickTab("Tab C");
await p.keyboard.press("Control+Tab");
await sleep(300);
ok("6l Ctrl+Tab dismisses an open tab menu and still cycles",
  (await p.locator(".tabmenu").isHidden()) && (await activeName()) === "Tab C",
  "active=" + (await activeName()));

// Fallback path: when the async Clipboard API is unavailable/rejects, the
// throwaway-textarea execCommand path must still copy and hand focus back.
await p.evaluate(() => {
  window.__execCopies = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async () => { throw new Error("clipboard denied"); } },
  });
  document.execCommand = () => { window.__execCopies += 1; return true; };
});
await rightClickTab("Tab C");
await p.locator('[data-tab-action="copy"]').click();
await sleep(200);
ok("6m a rejected Clipboard API falls back to execCommand and returns focus",
  (await p.evaluate(() => window.__execCopies)) === 1 &&
  (await p.evaluate(() => !!document.activeElement && document.activeElement.classList.contains("input"))));

// ---------------------------------------------------------------------------
// CASE 7 — pointer drag owns the custom ghost AND the insertion marker. The
// marker is a body-level fixed line, so it must appear in the dragged tab's
// own slot (where the old edge classes were suppressed) and follow the cursor
// across a target's midpoint. On pointerup the ghost, source dim and marker
// must be gone in the SAME synchronous turn (no native drag-image window
// lingering for seconds), and the reorder applies immediately.
// ---------------------------------------------------------------------------
const cBox = await p.locator(".tabbar .tab").nth(await idxOf("Tab C")).boundingBox();
const bBox = await p.locator(".tabbar .tab").nth(await idxOf("Tab B")).boundingBox();
await p.mouse.move(cBox.x + cBox.width / 2, cBox.y + cBox.height / 2);
await p.mouse.down();
await p.mouse.move(cBox.x + cBox.width / 2 + 10, cBox.y + cBox.height / 2, { steps: 2 });
const started = await p.evaluate(() => {
  const ghost = document.querySelector(".tab-drag-ghost");
  const src = Array.from(document.querySelectorAll(".tabbar .tab")).find((el) => el.classList.contains("dragging"));
  const line = document.querySelector(".tab-drop-line");
  return {
    ghost: !!ghost,
    ghostName: ghost ? ghost.querySelector(".tname").textContent.trim() : null,
    dragging: !!src,
    lineVisible: !line.hidden,
  };
});
ok("7a pointer drag creates the custom ghost, dims the source and shows the line",
  started.ghost && started.ghostName === "Tab C" && started.dragging && started.lineVisible,
  "ghost=" + started.ghostName + " dragging=" + started.dragging + " line=" + started.lineVisible);

await p.mouse.move(bBox.x + 2, bBox.y + bBox.height / 2, { steps: 4 });
const lineAtLeft = await p.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll(".tabbar .tab"));
  const byName = (n) => tabs.find((el) => el.querySelector(".tname").textContent.trim() === n);
  const src = byName("Tab C"), dst = byName("Tab B");
  const line = document.querySelector(".tab-drop-line");
  return {
    visible: !line.hidden,
    lineX: line.getBoundingClientRect().left,
    prevRight: src.getBoundingClientRect().right,
    nextLeft: dst.getBoundingClientRect().left,
  };
});
ok("7b the marker shows in the dragged tab's own slot (between it and the hovered tab)",
  lineAtLeft.visible && lineAtLeft.lineX >= lineAtLeft.prevRight - 1 && lineAtLeft.lineX <= lineAtLeft.nextLeft + 1,
  "line=" + lineAtLeft.lineX.toFixed(1) + " gap=" + lineAtLeft.prevRight.toFixed(1) + ".." + lineAtLeft.nextLeft.toFixed(1));

await p.mouse.move(bBox.x + bBox.width - 2, bBox.y + bBox.height / 2, { steps: 4 });
const lineAtRight = await p.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll(".tabbar .tab"));
  const byName = (n) => tabs.find((el) => el.querySelector(".tname").textContent.trim() === n);
  const dst = byName("Tab B"), next = byName("Tab A");
  const line = document.querySelector(".tab-drop-line");
  return { lineX: line.getBoundingClientRect().left, targetRight: dst.getBoundingClientRect().right, nextLeft: next.getBoundingClientRect().left };
});
ok("7c the marker follows the cursor across the target midpoint",
  lineAtRight.lineX > lineAtLeft.lineX + 2 &&
  lineAtRight.lineX >= lineAtRight.targetRight - 1 && lineAtRight.lineX <= lineAtRight.nextLeft + 1,
  "was=" + lineAtLeft.lineX.toFixed(1) + " now=" + lineAtRight.lineX.toFixed(1));

await p.mouse.up();
const atDrop = await p.evaluate(() => {
  const line = document.querySelector(".tab-drop-line");
  return {
    ghost: document.querySelectorAll(".tab-drag-ghost").length,
    lineHidden: line.hidden,
    dragging: document.querySelectorAll(".tabbar .tab.dragging").length,
    order: Array.from(document.querySelectorAll(".tabbar .tab")).map((el) => el.querySelector(".tname").textContent.trim()),
  };
});
ok("7d pointerup removes the custom ghost, source dim and marker IMMEDIATELY",
  atDrop.ghost === 0 && atDrop.lineHidden && atDrop.dragging === 0,
  "ghost=" + atDrop.ghost + " lineHidden=" + atDrop.lineHidden + " dim=" + atDrop.dragging);
ok("7e the drop reorders immediately (no deferred dragend hop)",
  JSON.stringify(atDrop.order) === JSON.stringify(["Tab B", "Tab C", "Tab A"]),
  "order=" + atDrop.order.join(","));

await sleep(350);
const settled = await p.evaluate(() => ({
  model: window.editor.tabs.map((t) => t.name),
  dom: Array.from(document.querySelectorAll(".tabbar .tab")).map((el) => el.querySelector(".tname").textContent.trim()),
  session: JSON.parse(localStorage.getItem("mdeditor.session.v2")).tabs.map((t) => t.name),
}));
ok("7f model + DOM agree and the drop is persisted after the debounce",
  JSON.stringify(settled.model) === JSON.stringify(["Tab B", "Tab C", "Tab A"]) &&
  JSON.stringify(settled.dom) === JSON.stringify(settled.model) &&
  JSON.stringify(settled.session) === JSON.stringify(settled.model),
  "model=" + settled.model.join(",") + " dom=" + settled.dom.join(",") + " session=" + settled.session.join(","));

// 7g — the drag must NOT depend on DOM pointer capture. Some engines/launch
// modes drop it; the window-level pointermove/pointerup listeners keep the
// gesture alive after the cursor leaves the source tab.
await p.evaluate(() => {
  window.__origSetPC = Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture = function () { throw new Error("capture disabled for test"); };
});
try {
  await dragTab("Tab B", "Tab A", "after");
  const noCapture = await tabNames();
  ok("7g drag works when DOM pointer capture is unavailable", JSON.stringify(noCapture) === JSON.stringify(["Tab C", "Tab A", "Tab B"]),
    "order=" + noCapture.join(","));
} finally {
  await p.evaluate(() => { Element.prototype.setPointerCapture = window.__origSetPC; });
}

// 7h — a drag may start on the × close button too (native HTML5 DnD allowed
// it). The pointerdown must NOT set pointer capture there (a plain click has to
// reach the close handler), while the window-level move/up listeners still
// reorder and suppress the trailing close click. An unmoved click still closes.
await p.evaluate(() => { window.editor.newTab("Tab D", ""); });
await sleep(200);
const dIdx = await idxOf("Tab D");
const cIdx = await idxOf("Tab C");
const dClose = await p.locator(".tabbar .tab").nth(dIdx).locator(".tclose").boundingBox();
const cRect = await p.locator(".tabbar .tab").nth(cIdx).boundingBox();
await p.mouse.move(dClose.x + dClose.width / 2, dClose.y + dClose.height / 2);
await p.mouse.down();
await p.mouse.move(dClose.x + dClose.width / 2 + 10, dClose.y + dClose.height / 2, { steps: 2 });
await p.mouse.move(cRect.x + 3, cRect.y + cRect.height / 2, { steps: 8 });
await p.mouse.up();
await sleep(350);
const closeDrag = await tabNames();
ok("7h dragging from the close button reorders without closing the tab",
  JSON.stringify(closeDrag) === JSON.stringify(["Tab D", "Tab C", "Tab A", "Tab B"]),
  "order=" + closeDrag.join(","));
await p.locator(".tabbar .tab").nth(await idxOf("Tab D")).locator(".tclose").click();
await sleep(250);
ok("7i an unmoved click on the × still closes the tab",
  JSON.stringify(await tabNames()) === JSON.stringify(["Tab C", "Tab A", "Tab B"]),
  "order=" + (await tabNames()).join(","));

// 7j — WSLg's RDP input pipeline relays a physical drag as a MOUSE button
// press/release (pointerId 1) with the intervening MOTION tagged as a PEN
// pointer (pointerId 4, isPrimary true). The old strict pointerId guard
// discarded every move: no ghost appeared and the drop was a no-op. The
// gesture matcher must accept the primary relayed pointer too (while a
// secondary touch, isPrimary false, stays ignored). buttons:0 on the motion
// is the hard case — WSLg can report no held buttons on the relayed pen move.
const wslg = await p.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll(".tabbar .tab"));
  const src = tabs.find((el) => el.querySelector(".tname").textContent.trim() === "Tab C");
  const dst = tabs.find((el) => el.querySelector(".tname").textContent.trim() === "Tab B");
  const sr = src.getBoundingClientRect(), dr = dst.getBoundingClientRect();
  const y = sr.top + sr.height / 2;
  const fire = (target, type, opts) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, ...opts,
  }));
  fire(src.querySelector(".tname"), "pointerdown", {
    pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1,
    clientX: sr.left + sr.width / 2, clientY: y,
  });
  fire(window, "pointermove", {
    pointerId: 4, pointerType: "pen", isPrimary: true, button: -1, buttons: 0,
    clientX: sr.left + sr.width / 2 + 10, clientY: y,
  });
  const during = {
    ghost: document.querySelectorAll(".tab-drag-ghost").length,
    ghostName: document.querySelector(".tab-drag-ghost .tname")?.textContent.trim(),
    dragging: document.querySelectorAll(".tabbar .tab.dragging").length,
  };
  fire(window, "pointermove", {
    pointerId: 4, pointerType: "pen", isPrimary: true, button: -1, buttons: 0,
    clientX: dr.right - 2, clientY: y,
  });
  fire(window, "pointerup", {
    pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0,
    clientX: dr.right - 2, clientY: y,
  });
  return {
    during,
    after: {
      ghost: document.querySelectorAll(".tab-drag-ghost").length,
      lineHidden: document.querySelector(".tab-drop-line").hidden,
      order: window.editor.tabs.map((t) => t.name),
    },
  };
});
ok("7j a WSLg mouse-down/pen-motion drag (different pointerId, isPrimary) still reorders",
  wslg.during.ghost === 1 && wslg.during.ghostName === "Tab C" && wslg.during.dragging === 1 &&
  wslg.after.ghost === 0 && wslg.after.lineHidden &&
  JSON.stringify(wslg.after.order) === JSON.stringify(["Tab A", "Tab B", "Tab C"]),
  "during=" + JSON.stringify(wslg.during) + " after=" + JSON.stringify(wslg.after));

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
console.log(`\n${pass} ok / ${fail} fail`);
await b.close();
try { process.kill(-srv.pid); } catch { /* already dead */ }
if (errors.length) fail = 1;
process.exit(fail ? 1 : 0);
