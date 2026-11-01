#!/usr/bin/env node
/**
 * After `vite build`: publish the original Darkness app (repo-root index.html) under /classic/ so a
 * static host (Vercel) serves it next to the new UI. The API server serves the same files live
 * (server/classic/serve.ts); both inject a default backend URL so the original app talks to this
 * deployment's /classic-api without manual setup.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "classic");

const INJECT = `<script>try{if(!localStorage.getItem('darkness-api-url'))localStorage.setItem('darkness-api-url',location.origin+'/classic-api')}catch(e){}</script>`;

if (!fs.existsSync(path.join(root, "index.html"))) {
  console.warn("[postbuild] root index.html not found - skipping /classic");
  process.exit(0);
}
fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
fs.writeFileSync(path.join(out, "index.html"), html.replace(/<head([^>]*)>/i, `<head$1>${INJECT}`));
if (fs.existsSync(path.join(root, "manifest.json"))) fs.copyFileSync(path.join(root, "manifest.json"), path.join(out, "manifest.json"));
if (fs.existsSync(path.join(root, "sw.js"))) {
  // The original service worker only skipped caching for URLs starting with /api/; /classic-api/api/* must be skipped too.
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8").replace(/url\.pathname\.startsWith\((['"])\/api\/\1\)/g, "url.pathname.includes('/api/')");
  fs.writeFileSync(path.join(out, "sw.js"), sw);
}
console.log("[postbuild] /classic published");
