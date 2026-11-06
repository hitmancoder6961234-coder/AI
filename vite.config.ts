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
    rollupOptions: {
      output: {
        // Stable third-party libraries get their own files, so a change to the app's own code does not make every visitor download
        // (or invalidate the cache of) React, the graph library and KaTeX again. Same code, same load order, better caching.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-markdown"],
          "vendor-graph": ["cytoscape", "cytoscape-dagre"],
          "vendor-math": ["katex"],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
});
