import { fileURLToPath, URL } from "node:url";

// Bind to 127.0.0.1 explicitly so Tauri's webview (which may resolve
// `localhost` to IPv6 ::1) can always reach the dev server.
export default {
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
  },
  preview: {
    port: 4173,
    host: "127.0.0.1",
  },
  build: {
    outDir: "dist",
    // Hard invariant (see AGENTS.md): the production bundle MUST be a single JS
    // file. jsPDF internally does `await import("dompurify")`, which Rollup would
    // otherwise code-split into a second runtime chunk — and a runtime chunk load
    // fails under the Tauri GTK custom protocol (the exact failure the invariant
    // exists to prevent). Force every dynamic import to inline into the one chunk.
    rollupOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
};
