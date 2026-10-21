/**
 * tabbar.js — tab-bar interactions split out of markdown.js.
 *
 * Owns three behaviors that all operate on the live TABS array:
 *  - drag-to-reorder: pointer-driven (NOT native HTML5 DnD — Chromium's native
 *    drag-image window can linger for seconds after the drop on Linux). The
 *    tab strip delegates `pointerdown` (so every tab drags even if wireTab was
 *    missed) and window-level move/up/cancel listeners drive the gesture (so it
 *    does not depend on DOM pointer capture). A clone `.tab-drag-ghost` follows
 *    the pointer and is removed SYNCHRONOUSLY on pointerup/cancel. A body-level
 *    fixed accent line marks the insertion point in every gap/end, and the drop
 *    reorders both the DOM and TABS so Ctrl+Tab cycling and session persistence
 *    follow the new order.
 *  - the tab context menu: an in-app fixed-position menu (NOT a native OS
 *    menu) with "Reveal in folder" and "Copy path" for the right-clicked tab.
 *    Reveal is native-only (the shell's `reveal_item_in_dir` command); Copy
 *    path also works in the browser fallback.
 *  - Ctrl+Tab / Ctrl+Shift+Tab cycling in TABS order (wrapping at the ends).
 *
 * The menu is rendered as a normal DOM node so it follows the app theme and can
 * be driven by the Playwright harnesses. markdown.js supplies the tabs/active
 * tab accessors and the focus-restore callback, keeping this module free of
 * app-shell knowledge.
 */

/**
 * copyText — copy a string to the system clipboard.
 *
 * Prefers the async Clipboard API; falls back to a transient off-screen
 * textarea + execCommand for engines/origins where `navigator.clipboard` is
 * absent or rejects (some shells do not expose the async Clipboard API).
 * @param {string} text — the text to copy.
 * @returns {Promise<boolean>} true when one of the copy paths succeeded.
 */
async function copyText(text) {
  const prevFocus = document.activeElement;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the execCommand path */ }
  let ta = null;
  try {
    ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    return document.execCommand("copy");
  } catch { return false; }
  finally {
    if (ta) ta.remove();
    // Selecting the throwaway textarea stole focus; hand it back so typing
    // continues in the editor after the copy (preventScroll: no pane movement).
    if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === "function") {
      try { prevFocus.focus({ preventScroll: true }); } catch { /* focus is best-effort */ }
    }
  }
}

/**
 * createTabBarHandlers — wire drag-reorder, the tab context menu, and cycling.
 * @param {object} deps Injected app hooks.
 * @param {HTMLElement} deps.tabBar The `.tabbar` container.
 * @param {Function} deps.getTabs Returns the live TABS array (same identity).
 * @param {Function} deps.getActiveTab Returns the active doc or null.
 * @param {Function} deps.activate Activates a doc (markdown.js activate).
 * @param {Function} deps.focusEditor Restores typing focus without moving panes.
 * @param {Function} deps.saveSessionSoon Persists the tab order (debounced).
 * @param {Function} deps.isTauri Whether the native shell bridge is present.
 * @param {Function} deps.revealItemInDir Native "show in file manager" wrapper.
 * @param {Function} deps.messageModal Shows a centered in-app message dialog.
 * @returns {{wireTab: Function, cycle: Function, closeMenu: Function}}
 *   `wireTab(doc)` attaches per-tab handlers; `cycle(±1)` switches tabs;
 *   `closeMenu()` dismisses the context menu without restoring focus.
 */
export function createTabBarHandlers({
  tabBar,
  getTabs,
  getActiveTab,
  activate,
  focusEditor,
  saveSessionSoon,
  isTauri,
  revealItemInDir,
  messageModal,
}) {
  /* ---- context menu ---- */
  const menu = document.createElement("div");
  menu.className = "tabmenu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Tab actions");
  menu.innerHTML = `
    <div class="tabmenu-title"></div>
    <button class="tabmenu-item" type="button" role="menuitem" data-tab-action="reveal">Reveal in folder</button>
    <button class="tabmenu-item" type="button" role="menuitem" data-tab-action="copy">Copy path</button>`;
  (tabBar.parentElement || document.body).appendChild(menu);

  const titleEl = menu.querySelector(".tabmenu-title");
  const revealBtn = menu.querySelector('[data-tab-action="reveal"]');
  const copyBtn = menu.querySelector('[data-tab-action="copy"]');
  let menuDoc = null;
  let dragDoc = null;
  let dragArmedDoc = null;
  let dragGhost = null;
  let dragGrabX = 0;
  let dragGrabY = 0;
  let dragPointerId = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragArmed = false;
  let swallowClickUntil = 0;
  let lastDragX = 0;
  let lastDragY = 0;
  // The insertion marker is a body-level FIXED element, not a class on a tab:
  // it stays visible in the inter-tab gaps, at both ends, and even when the
  // target tab is the translucent drag source or its edge is clipped by the
  // strip's horizontal scroll.
  const dropLine = document.createElement("div");
  dropLine.className = "tab-drop-line";
  dropLine.hidden = true;
  dropLine.setAttribute("aria-hidden", "true");
  document.body.appendChild(dropLine);

  /**
   * closeMenu — hide the context menu.
   * @param {{restoreFocus?: boolean}} [opts] When true, return typing focus to
   *   the active editor (used for Escape, a fired action, or a modified
   *   shortcut; an outside click already focused its own target).
   * @returns {void}
   */
  function closeMenu({ restoreFocus = false } = {}) {
    if (menu.hidden) return;
    menu.hidden = true;
    menuDoc = null;
    if (restoreFocus) focusEditor();
  }

  /**
   * openMenu — show the context menu for one tab at viewport coordinates,
   * clamped inside the window, with items enabled per the tab's saved path
   * and the current shell.
   * @param {object} doc The right-clicked tab.
   * @param {number} x Viewport x (contextmenu clientX).
   * @param {number} y Viewport y (contextmenu clientY).
   * @returns {void}
   */
  function openMenu(doc, x, y) {
    closeMenu();
    menuDoc = doc;
    const path = doc.path || "";
    titleEl.textContent = doc.name || "untitled";
    revealBtn.disabled = !path || !isTauri();
    revealBtn.title = !path
      ? "Save this file first"
      : (!isTauri() ? "Available in the desktop app" : "Show this file in the system file manager");
    copyBtn.disabled = !path;
    copyBtn.title = path || "Save this file first";

    // Show first (fixed at the origin) so the menu has a measurable size, then
    // clamp the requested cursor position to the viewport. Same task → no
    // visible flash at the origin.
    menu.style.left = "0px";
    menu.style.top = "0px";
    menu.hidden = false;
    const pad = 8;
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(pad, Math.min(x, window.innerWidth - rect.width - pad)) + "px";
    menu.style.top = Math.max(pad, Math.min(y, window.innerHeight - rect.height - pad)) + "px";
    const firstEnabled = [...menu.querySelectorAll("button")].find((b) => !b.disabled);
    if (firstEnabled) firstEnabled.focus({ preventScroll: true });
  }

  menu.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button[data-tab-action]");
    if (!btn || btn.disabled) return;
    const action = btn.getAttribute("data-tab-action");
    const doc = menuDoc;
    closeMenu();
    if (!doc) return;
    // Hand focus back BEFORE the async work: if the action fails and opens the
    // error modal, the modal's return-focus target is the editor, not the
    // now-hidden menu button.
    focusEditor();
    if (action === "copy") {
      const ok = await copyText(doc.path || "");
      if (ok) return;
      await messageModal({
        title: "Copy failed",
        message: "Could not copy the file path to the clipboard.",
        kind: "error",
      });
      return;
    }
    if (action === "reveal") {
      try {
        await revealItemInDir(doc.path);
      } catch (err) {
        await messageModal({
          title: "Reveal failed",
          message: String((err && err.message) || err || "The file manager could not be opened."),
          kind: "error",
        });
      }
    }
  });

  // Outside click / another right-click closes. Capture phase so a toolbar or
  // tab click is not swallowed by the menu first.
  document.addEventListener("pointerdown", (ev) => {
    if (menu.hidden) return;
    if (menu.contains(ev.target)) return;
    closeMenu();
  }, true);

  // A completed pointer drag is followed by a synthetic click on the drop
  // target. Suppress that ONE click so dragging a non-active tab never
  // activates it (native HTML5 drag used to swallow this click for us). Any
  // NEW pointerdown is a fresh interaction and clears the suppression window so
  // an unrelated follow-up click is never swallowed.
  document.addEventListener("pointerdown", () => { swallowClickUntil = 0; }, true);
  document.addEventListener("click", (ev) => {
    if (Date.now() > swallowClickUntil) return;
    swallowClickUntil = 0;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }, true);

  // Escape owns the keyboard while the menu is open (capture, so the global
  // Escape handler does not ALSO clear the editor selection). Any other key
  // pressed while focus is still OUTSIDE the menu (both items disabled) closes
  // it and hands focus back to the editor; keys pressed on a menu item belong
  // to the menu (arrow/Enter navigation).
  window.addEventListener("keydown", (ev) => {
    // Escape cancels an in-flight pointer drag before it can drop.
    if (dragDoc && ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      endDrag(false);
      return;
    }
    if (menu.hidden) return;
    // A centered modal outranks the menu: hide it without stealing focus back,
    // and let the modal's own Escape handler receive this key.
    if (document.querySelector(".savedlg-backdrop")) { closeMenu(); return; }
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu({ restoreFocus: true });
      return;
    }
    if (!menu.contains(ev.target)) closeMenu({ restoreFocus: true });
  }, true);

  window.addEventListener("resize", () => {
    closeMenu();
    if (dragDoc) markDrop(lastDragX, lastDragY);
  });
  window.addEventListener("blur", () => {
    // A pointer drag cannot receive its pointerup once the window loses focus.
    if (dragDoc) endDrag(false);
    dragArmed = false;
    dragArmedDoc = null;
    dragPointerId = null;
    closeMenu();
  });
  tabBar.addEventListener("scroll", () => {
    closeMenu();
    // Keep the marker pinned while the strip scrolls under a stationary cursor.
    if (dragDoc) markDrop(lastDragX, lastDragY);
  });

  /* ---- drag to reorder ---- */
  /** hideDropLine — hide the fixed insertion marker. */
  function hideDropLine() {
    dropLine.hidden = true;
  }

  /**
   * showDropLine — position the insertion marker for an insertion index.
   * A dedicated fixed element (rather than an inset edge on a tab) cannot be
   * lost to a tab's opacity/background paint or to the strip's overflow clip,
   * so the marker shows reliably in every gap and at both ends.
   * @param {number} at Insertion index in TABS (0..TABS.length).
   * @returns {void}
   */
  function showDropLine(at) {
    const tabs = getTabs();
    if (!tabs.length) { hideDropLine(); return; }
    const bar = tabBar.getBoundingClientRect();
    const clamped = Math.max(0, Math.min(at, tabs.length));
    const ref = tabs[Math.min(clamped, tabs.length - 1)].tab.getBoundingClientRect();
    let x;
    if (clamped === 0) {
      x = tabs[0].tab.getBoundingClientRect().left - 1;
    } else if (clamped === tabs.length) {
      x = tabs[tabs.length - 1].tab.getBoundingClientRect().right + 1;
    } else {
      x = (tabs[clamped - 1].tab.getBoundingClientRect().right
        + tabs[clamped].tab.getBoundingClientRect().left) / 2;
    }
    x = Math.max(bar.left + 2, Math.min(x, bar.right - 3));
    dropLine.style.left = Math.round(x) + "px";
    dropLine.style.top = Math.round(ref.top) + "px";
    dropLine.style.height = Math.round(ref.height) + "px";
    dropLine.hidden = false;
  }

  /**
   * dropIndexAt — translate a viewport x coordinate into an insertion index
   * (0..TABS.length) by comparing against each tab's midpoint.
   * @param {number} x Viewport x.
   * @returns {number} Insertion index in the CURRENT tab order.
   */
  function dropIndexAt(x) {
    const tabs = getTabs();
    for (let i = 0; i < tabs.length; i++) {
      const r = tabs[i].tab.getBoundingClientRect();
      if (x < r.left + r.width / 2) return i;
    }
    return tabs.length;
  }

  /**
   * inDropZone — whether viewport coordinates are inside the tab-strip drop
   * band. A few px of vertical slack keeps the release forgiving without
   * accepting a drop down in the editor.
   * @param {number} x Viewport x.
   * @param {number} y Viewport y.
   * @returns {boolean} true when the point is a valid tab-drop location.
   */
  function inDropZone(x, y) {
    const r = tabBar.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top - 4 && y <= r.bottom + 4;
  }

  /**
   * markDrop — move the insertion marker to the pointer, or hide it when the
   * pointer leaves the strip.
   * Unlike the old edge classes this SHOWS in the dragged tab's own slot too:
   * the marker reflects the computed drop position at all times instead of
   * disappearing exactly where a drop would be a no-op.
   * @param {number} x Viewport x.
   * @param {number} y Viewport y.
   * @returns {void}
   */
  function markDrop(x, y) {
    lastDragX = x;
    lastDragY = y;
    if (!dragDoc || !inDropZone(x, y)) { hideDropLine(); return; }
    showDropLine(dropIndexAt(x));
  }

  /**
   * placeGhost — park the custom drag preview under the pointer, preserving
   * the grab offset within the source tab.
   * @param {number} x Viewport x.
   * @param {number} y Viewport y.
   * @returns {void}
   */
  function placeGhost(x, y) {
    if (!dragGhost) return;
    dragGhost.style.left = Math.round(x - dragGrabX) + "px";
    dragGhost.style.top = Math.round(y - dragGrabY) + "px";
  }

  /** removeGhost — detach the custom drag preview immediately. */
  function removeGhost() {
    if (!dragGhost) return;
    dragGhost.remove();
    dragGhost = null;
  }

  /**
   * beginDrag — start a pointer-driven tab drag after the movement threshold.
   * Creates our OWN fixed drag preview instead of leaving it to the platform:
   * Chromium's native HTML5 drag-image window can survive the drop by seconds,
   * while this element is removed synchronously in endDrag().
   * @param {object} doc The tab being dragged.
   * @param {PointerEvent} ev The pointermove that crossed the threshold.
   * @returns {void}
   */
  function beginDrag(doc, ev) {
    const rect = doc.tab.getBoundingClientRect();
    dragDoc = doc;
    dragGrabX = ev.clientX - rect.left;
    dragGrabY = ev.clientY - rect.top;
    doc.tab.classList.add("dragging");
    closeMenu();
    const ghost = doc.tab.cloneNode(true);
    ghost.classList.remove("dragging");
    ghost.classList.add("tab-drag-ghost");
    ghost.removeAttribute("draggable");
    ghost.setAttribute("aria-hidden", "true");
    ghost.querySelectorAll("button").forEach((b) => { b.tabIndex = -1; });
    ghost.style.boxSizing = "border-box";
    ghost.style.width = rect.width + "px";
    ghost.style.height = rect.height + "px";
    dragGhost = ghost;
    document.body.appendChild(ghost);
    placeGhost(ev.clientX, ev.clientY);
    markDrop(ev.clientX, ev.clientY);
  }

  /**
   * endDrag — finish/cancel a pointer drag. Removes the custom ghost, the
   * source dim and the insertion line SYNCHRONOUSLY, then applies the reorder
   * (no native drag image is involved, so there is nothing left to linger).
   * @param {boolean} drop true for pointerup, false for Escape/blur/cancel.
   * @param {number} [x] Release x; defaults to the last tracked position.
   * @param {number} [y] Release y; defaults to the last tracked position.
   * @returns {void}
   */
  function endDrag(drop, x = lastDragX, y = lastDragY) {
    const doc = dragDoc;
    if (!doc) {
      dragArmed = false;
      dragArmedDoc = null;
      dragPointerId = null;
      return;
    }
    const pid = dragPointerId;
    const shouldDrop = !!drop && inDropZone(x, y);
    const at = shouldDrop ? dropIndexAt(x) : -1;
    doc.tab.classList.remove("dragging");
    removeGhost();
    hideDropLine();
    dragDoc = null;
    dragArmed = false;
    dragArmedDoc = null;
    dragPointerId = null;
    // The release that follows Escape/cancel must not become a tab click
    // either; any fresh pointerdown clears this window (see above).
    swallowClickUntil = Date.now() + 300;
    if (pid != null) {
      try { doc.tab.releasePointerCapture(pid); } catch { /* already released */ }
    }
    if (shouldDrop) reorderTo(doc, at);
  }

  /**
   * reorderTo — move a tab to an insertion index in BOTH TABS and the DOM and
   * persist the order. Moves ONLY the dragged node (listeners/active/dirty
   * state survive); the custom ghost has already been detached.
   * @param {object} doc The dragged tab.
   * @param {number} at Insertion index in the pre-move order (0..TABS.length).
   * @returns {boolean} true when the order changed.
   */
  function reorderTo(doc, at) {
    const tabs = getTabs();
    const from = tabs.indexOf(doc);
    if (from === -1) return false;
    const clamped = Math.max(0, Math.min(at, tabs.length));
    let to = clamped;
    if (to > from) to--;
    if (to === from) return false;
    tabs.splice(from, 1);
    tabs.splice(to, 0, doc);
    const next = tabs[to + 1];
    tabBar.insertBefore(doc.tab, next ? next.tab : null);
    saveSessionSoon();
    return true;
  }

  /**
   * onPointerDown — arm a possible tab drag. A normal click never crosses the
   * movement threshold, so activation/close still work unchanged.
   * @param {object} doc The pressed tab.
   * @param {PointerEvent} ev The pointerdown.
   * @returns {void}
   */
  function onPointerDown(doc, ev) {
    if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    // Only the PRIMARY pointer may arm a drag. A second finger must never
    // replace the first one's gesture; WSLg's relayed motion is still primary
    // (see isGesturePointer).
    if (!ev.isPrimary) return;
    if (dragDoc) return;
    // A fresh pointerdown is always a new gesture. Do NOT refuse it because an
    // earlier gesture left `dragArmed` set (a pointerup released outside the
    // app/window is never delivered) — that would wedge every later drag.
    if (dragArmed && dragArmedDoc && dragArmedDoc !== doc) {
      try { dragArmedDoc.tab.releasePointerCapture(dragPointerId); } catch { /* ignore */ }
    }
    // Dragging by the close button is allowed too (native HTML5 DnD allowed it):
    // only suppress capture there, so a plain click still reaches the × click
    // handler. A real drag suppresses the click in endDrag().
    const onClose = !!ev.target.closest(".tclose");
    dragArmed = true;
    dragArmedDoc = doc;
    dragPointerId = ev.pointerId;
    dragStartX = ev.clientX;
    dragStartY = ev.clientY;
    swallowClickUntil = 0;
    // Best-effort capture; the window-level move/up listeners are the real
    // guarantee (some environments drop or ignore DOM pointer capture).
    if (!onClose) {
      try { doc.tab.setPointerCapture(ev.pointerId); } catch { /* best-effort */ }
    }
  }

  /**
   * isGesturePointer — whether a pointer event belongs to the active drag
   * gesture.
   *
   * A strict `pointerId` match is not enough on WSLg: its RDP input pipeline
   * sends the button press/release as pointerId 1 / pointerType "mouse", but
   * relays the intervening motion as pointerId 4 / pointerType "pen" (still
   * isPrimary). The old id-only guard discarded every move, so no ghost ever
   * appeared and the drop was a no-op — the reported "no ghost, can't
   * reorder" on the WSLg launch path. Accept the primary pointer as the relay
   * half of the gesture; a SECOND touch reports isPrimary false and is still
   * ignored, so it cannot hijack the drag.
   * @param {PointerEvent} ev The pointer event to classify.
   * @returns {boolean} true when the event continues the armed gesture.
   */
  function isGesturePointer(ev) {
    return dragPointerId != null && (ev.pointerId === dragPointerId || ev.isPrimary);
  }

  /**
   * onWindowPointerMove — advance an armed/dragging pointer ANYWHERE in the
   * window. These listeners deliberately live on `window`, not on the tab: if
   * an engine drops DOM pointer capture (or starts the pointer outside the
   * source element), a tab-local pointermove listener would never see the
   * gesture after the cursor leaves the tab. Window-level capture makes the
   * drag independent of `setPointerCapture`.
   * @param {PointerEvent} ev The pointermove.
   * @returns {void}
   */
  function onWindowPointerMove(ev) {
    if (!dragArmed || !isGesturePointer(ev)) return;
    // A pointerup released outside the window is never delivered. Clear the
    // stale arm on the next hover move (no pressed buttons) instead of letting
    // it spawn a ghost from an unrelated mouse move. Only the SAME pointer id
    // is evidence of a missed release: WSLg's relayed pen motion carries a
    // DIFFERENT id and can legitimately report buttons 0 while the physical
    // button is still down, so it must continue the gesture instead.
    if (!dragDoc && ev.buttons === 0 && ev.pointerId === dragPointerId) {
      dragArmed = false;
      dragArmedDoc = null;
      dragPointerId = null;
      return;
    }
    const doc = dragDoc || dragArmedDoc;
    if (!doc) return;
    if (!dragDoc) {
      if (Math.hypot(ev.clientX - dragStartX, ev.clientY - dragStartY) < 4) return;
      beginDrag(doc, ev);
      return;
    }
    if (ev.cancelable) ev.preventDefault();
    placeGhost(ev.clientX, ev.clientY);
    markDrop(ev.clientX, ev.clientY);
  }

  /**
   * onWindowPointerUp — drop at the release position (inside the strip only),
   * or finish a plain click without starting a drag.
   * @param {PointerEvent} ev The pointerup.
   * @returns {void}
   */
  function onWindowPointerUp(ev) {
    if (!isGesturePointer(ev)) return;
    if (dragDoc) { endDrag(true, ev.clientX, ev.clientY); return; }
    const armedDoc = dragArmedDoc;
    dragArmed = false;
    dragArmedDoc = null;
    dragPointerId = null;
    if (armedDoc) {
      try { armedDoc.tab.releasePointerCapture(ev.pointerId); } catch { /* best-effort */ }
    }
  }

  /**
   * onWindowPointerCancel — abort the drag without reordering.
   * @param {PointerEvent} ev The pointercancel.
   * @returns {void}
   */
  function onWindowPointerCancel(ev) {
    if (!isGesturePointer(ev)) return;
    endDrag(false);
  }

  window.addEventListener("pointermove", onWindowPointerMove, { capture: true, passive: false });
  window.addEventListener("pointerup", onWindowPointerUp, true);
  window.addEventListener("pointercancel", onWindowPointerCancel, true);

  // Delegated tab interactions: binding to the STRIP (not each tab) means a
  // tab always drags / opens its menu even if wireTab() was missed for it. The
  // guard keeps the body-level drag ghost (also a .tab) out of the source set.
  tabBar.addEventListener("pointerdown", (ev) => {
    const tabEl = ev.target instanceof Element ? ev.target.closest(".tab") : null;
    if (!tabEl || tabEl.parentElement !== tabBar) return;
    const doc = getTabs().find((t) => t.tab === tabEl);
    if (doc) onPointerDown(doc, ev);
  });
  tabBar.addEventListener("contextmenu", (ev) => {
    const tabEl = ev.target instanceof Element ? ev.target.closest(".tab") : null;
    if (!tabEl || tabEl.parentElement !== tabBar) return;
    const doc = getTabs().find((t) => t.tab === tabEl);
    if (!doc) return;
    ev.preventDefault();
    openMenu(doc, ev.clientX, ev.clientY);
  });

  /**
   * wireTab — mark one tab as non-native-draggable. All pointer/context-menu
   * handling is delegated on tabBar above, so a missing wireTab() call can
   * never leave a tab undraggable.
   * @param {object} doc A tab created by makeTab (needs doc.tab).
   * @returns {void}
   */
  function wireTab(doc) {
    doc.tab.removeAttribute("draggable");
  }

  /**
   * cycle — activate the next/previous tab in TABS order, wrapping at the ends.
   * @param {number} dir +1 forward (Ctrl+Tab), -1 backward (Ctrl+Shift+Tab).
   * @returns {object|null} The activated doc, or null with fewer than 2 tabs.
   */
  function cycle(dir) {
    const tabs = getTabs();
    if (tabs.length < 2) return null;
    const active = getActiveTab();
    const from = Math.max(0, tabs.indexOf(active));
    const to = (from + (dir < 0 ? -1 : 1) + tabs.length) % tabs.length;
    closeMenu();
    activate(tabs[to]);
    return tabs[to];
  }

  return { wireTab, cycle, closeMenu };
}
