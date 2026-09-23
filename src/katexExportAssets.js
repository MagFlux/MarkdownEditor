/**
 * katexExportAssets.js — browser-only KaTeX asset imports for the HTML export.
 *
 * Imported ONLY from src/main.js — never from anything in the
 * src/markdown.js module graph. test/test.mjs loads that whole graph under
 * plain Node ESM, which cannot resolve .css / ?raw / ?url module specs; the
 * app's own stylesheet import already lives in main.js for the same reason.
 *
 * The values are injected into math.js via setKatexExportAssets() at boot and
 * back katexExportCss(): when an exported document contains math, the export
 * embeds a fully SELF-CONTAINED KaTeX stylesheet — every woff2 font rewritten
 * to a base64 data: URI — so the exported file renders identically offline
 * (no CDN, no sibling font files).
 */
import katexCss from "katex/dist/katex.min.css?raw";
import f0 from "katex/dist/fonts/KaTeX_AMS-Regular.woff2?url";
import f1 from "katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?url";
import f2 from "katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?url";
import f3 from "katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?url";
import f4 from "katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?url";
import f5 from "katex/dist/fonts/KaTeX_Main-Bold.woff2?url";
import f6 from "katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?url";
import f7 from "katex/dist/fonts/KaTeX_Main-Italic.woff2?url";
import f8 from "katex/dist/fonts/KaTeX_Main-Regular.woff2?url";
import f9 from "katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?url";
import f10 from "katex/dist/fonts/KaTeX_Math-Italic.woff2?url";
import f11 from "katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?url";
import f12 from "katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?url";
import f13 from "katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?url";
import f14 from "katex/dist/fonts/KaTeX_Script-Regular.woff2?url";
import f15 from "katex/dist/fonts/KaTeX_Size1-Regular.woff2?url";
import f16 from "katex/dist/fonts/KaTeX_Size2-Regular.woff2?url";
import f17 from "katex/dist/fonts/KaTeX_Size3-Regular.woff2?url";
import f18 from "katex/dist/fonts/KaTeX_Size4-Regular.woff2?url";
import f19 from "katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?url";

/** KATEX_EXPORT_ASSETS — raw katex.min.css text + font-name → bundled URL. */
export const KATEX_EXPORT_ASSETS = {
  css: katexCss,
  fonts: {
    "KaTeX_AMS-Regular.woff2": f0,
    "KaTeX_Caligraphic-Bold.woff2": f1,
    "KaTeX_Caligraphic-Regular.woff2": f2,
    "KaTeX_Fraktur-Bold.woff2": f3,
    "KaTeX_Fraktur-Regular.woff2": f4,
    "KaTeX_Main-Bold.woff2": f5,
    "KaTeX_Main-BoldItalic.woff2": f6,
    "KaTeX_Main-Italic.woff2": f7,
    "KaTeX_Main-Regular.woff2": f8,
    "KaTeX_Math-BoldItalic.woff2": f9,
    "KaTeX_Math-Italic.woff2": f10,
    "KaTeX_SansSerif-Bold.woff2": f11,
    "KaTeX_SansSerif-Italic.woff2": f12,
    "KaTeX_SansSerif-Regular.woff2": f13,
    "KaTeX_Script-Regular.woff2": f14,
    "KaTeX_Size1-Regular.woff2": f15,
    "KaTeX_Size2-Regular.woff2": f16,
    "KaTeX_Size3-Regular.woff2": f17,
    "KaTeX_Size4-Regular.woff2": f18,
    "KaTeX_Typewriter-Regular.woff2": f19,
  },
};
