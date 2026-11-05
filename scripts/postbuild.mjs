#!/usr/bin/env node
/**
 * After `vite build`: publish the original Darkness app (repo-root index.html) under /classic/ so a
 * static host (Vercel) serves it next to the new UI. The API server serves the same files live
 * (server/classic/serve.ts); both split the inline code into files (the CSP forbids inline script/style) and set a default backend URL so the original app talks to this
 * deployment's /classic-api without manual setup.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitClassicHtml } from "../server/classic/transform.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "classic");


if (!fs.existsSync(path.join(root, "index.html"))) {
  console.warn("[postbuild] root index.html not found - skipping /classic");
  process.exit(0);
}
fs.mkdirSync(out, { recursive: true });
// Same transformation the API server applies live: inline <style>/<script> become app.css / app.js, plus boot.js.
const split = splitClassicHtml(fs.readFileSync(path.join(root, "index.html"), "utf8"));
fs.writeFileSync(path.join(out, "index.html"), split.html);
for (const [name, body] of Object.entries(split.assets)) fs.writeFileSync(path.join(out, name), body);
if (fs.existsSync(path.join(root, "manifest.json"))) fs.copyFileSync(path.join(root, "manifest.json"), path.join(out, "manifest.json"));
if (fs.existsSync(path.join(root, "sw.js"))) {
  // The original service worker only skipped caching for URLs starting with /api/; /classic-api/api/* must be skipped too.
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8").replace(/url\.pathname\.startsWith\((['"])\/api\/\1\)/g, "url.pathname.includes('/api/')");
  fs.writeFileSync(path.join(out, "sw.js"), sw);
}
console.log("[postbuild] /classic published");
