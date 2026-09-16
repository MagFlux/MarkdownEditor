/**
 * history.js — undo and redo actions for the Markdown editor.
 *
 * The factory owns stack movement while the app supplies document state and the
 * callbacks needed to settle typing and refresh the rendered view.
 */

/**
 * createHistoryHandlers — build undo and redo actions for the active document.
 * @param {object} deps History dependencies supplied by createApp.
 * @param {Function} deps.getActiveDoc Return the active tab document.
 * @param {number} deps.coalesceMs Typing quiet period before settling a burst.
 * @param {Function} deps.setUndoRedoState Refresh the history button state.
 * @param {Function} deps.setSuppressInput Toggle the input-event guard.
 * @param {Function} deps.refresh Refresh the active document view.
 * @returns {{captureTypeSnapshot: Function, flushTypeCommit: Function, scheduleTypeSettle: Function, undo: Function, redo: Function}} History actions.
 */
export function createHistoryHandlers({ getActiveDoc, coalesceMs, setUndoRedoState, setSuppressInput, refresh }) {
  /** captureTypeSnapshot — snapshot the settled text at the start of a typing burst. */
  function captureTypeSnapshot(d) {
    if (d._typeMark) return;
    d._typeMark = { from: d._typeBase, fromSelS: d.input.selectionStart, fromSelE: d.input.selectionEnd };
  }

  /** flushTypeCommit — settle a pending typing burst into one undo step. */
  function flushTypeCommit(d) {
    if (d && d._typeSettle) { clearTimeout(d._typeSettle); d._typeSettle = 0; }
    if (d && d._typeMark) {
      d.undo.push({
        label: "type",
        from: d._typeMark.from, fromSelS: d._typeMark.fromSelS, fromSelE: d._typeMark.fromSelE,
        to: d.input.value, selS: d.input.selectionStart, selE: d.input.selectionEnd,
      });
      if (d.undo.length > 400) d.undo.shift();
      d._typeMark = null;
      d._typeBase = d.input.value;
    }
  }

  /** scheduleTypeSettle — debounce the end of a typing burst. */
  function scheduleTypeSettle(d) {
    if (d._typeSettle) clearTimeout(d._typeSettle);
    d._typeSettle = setTimeout(() => {
      d._typeSettle = 0;
      if (!d._typeMark) return;
      flushTypeCommit(d);
      if (d === getActiveDoc()) setUndoRedoState();
    }, coalesceMs);
  }

  /** commit — record and apply one programmatic text change. */
  function commit(label, to, selS, selE) {
    const d = getActiveDoc();
    if (!d) return;
    flushTypeCommit(d);
    d.undo.push({
      label, from: d.input.value,
      fromSelS: d.input.selectionStart, fromSelE: d.input.selectionEnd,
      to, selS, selE,
    });
    if (d.undo.length > 400) d.undo.shift();
    d.redo.length = 0;
    setSuppressInput(true);
    d.input.value = to;
    setSuppressInput(false);
    d.input.setSelectionRange(selS, selE);
    d.dirty = true;
    d._typeBase = d.input.value;
    d._lastVal = d.input.value;
    refresh();
  }

  /** undo — pop the last step off the undo stack and apply its from state. */
  function undo() {
    const d = getActiveDoc();
    if (!d) return;
    flushTypeCommit(d);
    if (!d.undo.length) return;
    const act = d.undo.pop();
    d.redo.push(act);
    setSuppressInput(true);
    d.input.value = act.from;
    setSuppressInput(false);
    d.input.setSelectionRange(act.fromSelS, act.fromSelE);
    d.dirty = true;
    d._typeBase = d.input.value;
    d._lastVal = d.input.value;
    refresh();
  }

  /** redo — pop the last step off the redo stack and apply its to state. */
  function redo() {
    const d = getActiveDoc();
    if (!d) return;
    flushTypeCommit(d);
    if (!d.redo.length) return;
    const act = d.redo.pop();
    d.undo.push(act);
    setSuppressInput(true);
    d.input.value = act.to;
    setSuppressInput(false);
    d.input.setSelectionRange(act.selS, act.selE);
    d.dirty = true;
    d._typeBase = d.input.value;
    d._lastVal = d.input.value;
    refresh();
  }

  return { captureTypeSnapshot, flushTypeCommit, scheduleTypeSettle, commit, undo, redo };
}
