import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web UI lives in ./web ; the production bundle is emitted to ./dist and served by the API server.
export default defineConfig({
  root: "web",
  publicDir: "public",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
});
