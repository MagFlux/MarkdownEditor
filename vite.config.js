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
  },
};
