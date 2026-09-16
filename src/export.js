/**
 * export.js — PDF and standalone HTML export helpers.
 *
 * The export pipeline is independent of tab state, so it lives outside the
 * createApp closure. The factory receives the few app-owned callbacks it needs
 * for the active document, in-app picker, overwrite confirmation, and errors.
 * All library imports remain static so Vite still emits one Tauri-loadable
 * bundle.
 */
import { marked } from "marked";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { renderMermaidInNode, renderMermaidInHtml } from "./mermaid.js";

const EXPORT_PREVIEW_CSS = `
body.preview{max-width:62rem;margin:0 auto;padding:14px 28px 60px;font-size:16px;
  line-height:1.65;color:#1a1d21;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#fff}
.preview h1{font-size:30px;line-height:1.25;margin:.2em 0 .5em;font-weight:700}
.preview h2{font-size:24px;margin:.9em 0 .5em;font-weight:700}
.preview h3{font-size:19px;margin:.9em 0 .4em;font-weight:600}
.preview h4{font-size:16px;margin:.9em 0 .4em;font-weight:600}
.preview p{margin:.55em 0}
.preview code{background:#eef1f5;color:#c25e4a;padding:1px 5px;border-radius:5px;font-size:.9em}
.preview pre{background:#eef1f5;padding:12px 14px;border-radius:8px;overflow:auto;margin:.6em 0}
.preview pre code{background:none;padding:0;color:#1a1d21}
.preview blockquote{border-left:3px solid #2f6feb;margin:.6em 0;padding:2px 14px;color:#4a5568}
.preview a{color:#2f6feb}
.preview hr{border:0;border-top:1px solid #e2e4e9;margin:1em 0}
.preview ul,.preview ol{padding-left:1.6em;margin:.5em 0}
.preview li{margin:.15em 0}
.preview img{max-width:100%;border-radius:6px}
.preview table{border-collapse:collapse;margin:.7em 0;width:100%}
.preview th,.preview td{border:1px solid #e2e4e9;padding:6px 12px;text-align:left}
.preview th{background:#f5f6f8;font-weight:600}
.preview u{text-decoration:underline}
.preview s{text-decoration:line-through}
.preview .mermaid-diagram{margin:.8em 0;text-align:center}
.preview .mermaid-diagram svg{max-width:100%;height:auto}
.preview .mermaid-diagram-err{background:#fdecec;border-left:3px solid #d73a49;padding:8px 14px;border-radius:6px;font-size:.9em;color:#b02a37;margin:.6em 0}
`.trim();

/**
 * createExportHandlers — build the app-facing PDF and HTML export actions.
 * @param {object} deps App-owned state and persistence callbacks.
 * @returns {{exportAsHtml: Function, exportAsPdf: Function}} Export actions.
 */
export function createExportHandlers({
  getActiveDoc,
  isTauri,
  pickPath,
  confirmOverwriteIfNeeded,
  writeTextFile,
  writeFile,
  messageModal,
}) {
  /**
   * exportHtmlDoc — render Markdown to a self-contained HTML document.
   * @param {string} text Raw Markdown source.
   * @returns {Promise<string>} A complete standalone HTML document.
   */
  async function exportHtmlDoc(text) {
    let body = text.trim() ? marked.parse(text) : "<p>(empty document)</p>";
    try { body = await renderMermaidInHtml(body); } catch { /* keep raw fence */ }
    return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<style>\n${EXPORT_PREVIEW_CSS}\n</style>\n</head>\n<body class="preview">\n${body}\n</body>\n</html>\n`;
  }

  /**
   * renderPreviewCanvas — rasterize Markdown to a fixed-width canvas.
   * @param {string} text Raw Markdown source.
   * @param {number} [width=780] Render width in pixels.
   * @returns {Promise<HTMLCanvasElement>} The rasterized preview.
   */
  async function renderPreviewCanvas(text, width = 780) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-100000px;top:0;z-index:99999;pointer-events:none;";
    const body = document.createElement("div");
    body.className = "preview";
    body.style.width = width + "px";
    body.innerHTML = text.trim() ? marked.parse(text) : "<p>(empty document)</p>";
    host.appendChild(body);
    document.body.appendChild(host);
    try {
      await renderMermaidInNode(body);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return await html2canvas(body, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        width: body.clientWidth,
        height: body.scrollHeight,
      });
    } finally {
      document.body.removeChild(host);
    }
  }

  /** Trigger a browser download of a generated blob. */
  function downloadBlob(blob, filename) {
    const el = document.createElement("a");
    el.href = URL.createObjectURL(blob);
    el.download = filename;
    el.click();
    setTimeout(() => URL.revokeObjectURL(el.href), 1000);
  }

  /** Derive a default export filename from the document title. */
  function defaultExportName(doc, ext) {
    const base = (doc && doc.name) || "untitled";
    return base.replace(/\.[^./\\]+$/, "") + "." + ext;
  }

  /**
   * exportAsHtml — save a standalone HTML export through the app's save path.
   * @returns {Promise<boolean>} true on success, false on cancel/error.
   */
  async function exportAsHtml() {
    const doc = getActiveDoc();
    if (!doc) return false;
    const html = await exportHtmlDoc(doc.input.value);
    const filename = defaultExportName(doc, "html");
    if (isTauri()) {
      const { path } = await pickPath({ mode: "save", defaultFilename: filename, filters: [{ name: "HTML", extensions: ["html", "htm"] }] });
      if (!path) return false;
      try {
        if (!(await confirmOverwriteIfNeeded(path))) return false;
        await writeTextFile(path, html);
        return true;
      } catch (e) {
        await messageModal({ title: "Export failed", message: "Could not save “" + path + "”: " + ((e && (e.message || e)) || "unknown error"), buttons: [{ label: "OK", kind: "primary", value: "ok" }], kind: "error" });
        return false;
      }
    }
    downloadBlob(new Blob([html], { type: "text/html" }), filename);
    return true;
  }

  /**
   * exportAsPdf — rasterize the preview and write it as paginated A4 PDF.
   * @returns {Promise<boolean>} true on success, false on cancel/error.
   */
  async function exportAsPdf() {
    const doc = getActiveDoc();
    if (!doc) return false;
    const filename = defaultExportName(doc, "pdf");
    try {
      const host = await renderPreviewCanvas(doc.input.value);
      const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = pageW / host.width;
      const pxPerPage = pageH / ratio;
      for (let y = 0, pageIndex = 0; ; y += pxPerPage, pageIndex++) {
        const slicePx = Math.min(pxPerPage, host.height - y);
        if (slicePx <= 0) break;
        const slice = document.createElement("canvas");
        slice.width = host.width;
        slice.height = slicePx;
        const ctx = slice.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(host, 0, y, host.width, slicePx, 0, 0, host.width, slicePx);
        if (pageIndex > 0) pdf.addPage("a4", "portrait");
        pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, slicePx * ratio);
        if (y + pxPerPage >= host.height) break;
      }
      if (isTauri()) {
        const { path } = await pickPath({ mode: "save", defaultFilename: filename, filters: [{ name: "PDF", extensions: ["pdf"] }] });
        if (!path) return false;
        try {
          if (!(await confirmOverwriteIfNeeded(path))) return false;
          await writeFile(path, new Uint8Array(pdf.output("arraybuffer")));
          return true;
        } catch (e) {
          await messageModal({ title: "Export failed", message: "Could not save “" + path + "”: " + ((e && (e.message || e)) || "unknown error"), buttons: [{ label: "OK", kind: "primary", value: "ok" }], kind: "error" });
          return false;
        }
      }
      downloadBlob(pdf.output("blob"), filename);
      return true;
    } catch (e) {
      await messageModal({ title: "Export failed", message: "PDF export failed: " + ((e && (e.message || e)) || "unknown error"), buttons: [{ label: "OK", kind: "primary", value: "ok" }], kind: "error" });
      return false;
    }
  }

  return { exportAsHtml, exportAsPdf };
}
