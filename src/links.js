/**
 * links.js — link detection and opening actions for the Markdown editor.
 *
 * The factory receives app state and environment callbacks so Ctrl+click and
 * keyboard opening keep the browser fallback alongside the Tauri path.
 */
import { openUrl as tauriOpenUrlApi } from "@tauri-apps/plugin-opener";

/**
 * createLinkHandlers — build link detection and opening actions.
 * @param {object} deps Link dependencies supplied by createApp.
 * @param {Function} deps.getActiveDoc Return the active tab document.
 * @param {Function} deps.isTauri Return whether Tauri is available.
 * @param {Function} [deps.openUrl] Open a URL in the browser fallback.
 * @returns {{findLinkToken: Function, tauriOpenUrl: Function, openAtCaret: Function}}
 */
export function createLinkHandlers({ getActiveDoc, isTauri, openUrl = (url, target) => window.open(url, target) }) {
  /**
   * findLinkToken — detect a Markdown link or bare URL at a caret position.
   * @param {string} text The full document text.
   * @param {number} pos The caret offset to probe.
   * @returns {{url: string, text: string}|null} The matched link or null.
   */
  function findLinkToken(text, pos) {
    {
      const i = text.lastIndexOf("[", pos);
      const open = i >= 0 && (i === pos || /\s|^/.test(text[i - 1] || ""));
      if (open) {
        const close = text.indexOf("](", i);
        if (close !== -1 && close - i < 200) {
          const end = text.indexOf(")", close);
          if (end !== -1 && end - i < 400) {
            const tok = text.slice(i, end + 1);
            const m = tok.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
            if (m) return { url: m[2], text: m[1] };
          }
        }
      }
    }
    {
      const L = text.slice(
        text.lastIndexOf("\n", pos - 1) + 1,
        (idx => idx === -1 ? text.length : idx)(text.indexOf("\n", pos)),
      );
      const off = pos - (text.lastIndexOf("\n", pos - 1) + 1);
      const trimmed = L.trim();
      if (/\S/.test(trimmed)) {
        const m = trimmed.match(/(^|\s)((?:https?:\/\/|mailto:)[^\s]+|www\.[^\s]+)/i);
        if (m && off > 0 && off < L.length) {
          const urlStart = L.indexOf(m[2]);
          if (off >= urlStart && off <= urlStart + m[2].length) {
            return { url: m[2], text: m[2] };
          }
        }
      }
    }
    return null;
  }

  /**
   * tauriOpenUrl — open a URL through Tauri's opener plugin when available.
   * @param {string} url Absolute URL to open.
   * @returns {Promise<boolean>} true on success, false on fallback or error.
   */
  async function tauriOpenUrl(url) {
    if (!isTauri()) return false;
    try {
      await tauriOpenUrlApi(url);
      return true;
    } catch { return false; }
  }

  /**
   * openAtCaret — open the link under the active editor caret.
   * @returns {Promise<void>}
   */
  async function openAtCaret() {
    const d = getActiveDoc(), input = d.input, text = d.input.value;
    const a = input.selectionStart;
    const tok = findLinkToken(text, a);
    if (!tok) return;
    let url = tok.url;
    if (/^mailto:/i.test(url)) {
      if (await tauriOpenUrl(url)) return;
      openUrl(url);
      return;
    }
    if (/^\/\//i.test(url)) url = "https:" + url;
    else if (/^www\./i.test(url)) url = "https://" + url;
    else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = "https://" + url;
    if (await tauriOpenUrl(url)) return;
    openUrl(url, "_blank");
  }

  return { findLinkToken, tauriOpenUrl, openAtCaret };
}
