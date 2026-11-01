/**
 * Serves the original Darkness single-page app (repo-root index.html) at /classic/.
 *
 * - A default backend URL is injected so it talks to this deployment's /classic-api with no setup.
 * - Visitors without a session are sent to the sign-in screen.
 * - The original service worker is patched: it only skipped caching for URLs starting with /api/, so it
 *   would have cached /classic-api/api/* responses. The patched copy skips anything containing /api/.
 */
import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";

const INJECT = `<script>try{if(!localStorage.getItem('darkness-api-url'))localStorage.setItem('darkness-api-url',location.origin+'/classic-api')}catch(e){}</script>`;

export function patchClassicServiceWorker(src: string): string {
  return src.replace(/url\.pathname\.startsWith\((['"])\/api\/\1\)/g, "url.pathname.includes('/api/')");
}

export function registerClassicPages(app: Express, opts: { isSignedIn: (req: Request) => boolean; root?: string }): void {
  const root = opts.root || process.cwd();
  const file = (name: string) => path.join(root, name);

  const page = (req: Request, res: Response) => {
    // Express treats "/classic" and "/classic/" as one route; the app's relative URLs need the slash.
    if (req.path === "/classic") return res.redirect(301, "/classic/");
    if (!opts.isSignedIn(req)) return res.redirect(302, "/");
    const p = file("index.html");
    if (!fs.existsSync(p)) return res.status(404).send("Original Darkness app not found on this deployment.");
    const html = fs.readFileSync(p, "utf8").replace(/<head([^>]*)>/i, `<head$1>${INJECT}`);
    res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).send(html);
  };

  app.get(["/classic", "/classic/", "/classic/index.html"], page);

  app.get("/classic/manifest.json", (_req, res) => {
    if (!fs.existsSync(file("manifest.json"))) return res.status(404).end();
    res.type("application/manifest+json").send(fs.readFileSync(file("manifest.json"), "utf8"));
  });

  app.get("/classic/sw.js", (_req, res) => {
    if (!fs.existsSync(file("sw.js"))) return res.status(404).end();
    res.set({ "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/classic/" }).send(patchClassicServiceWorker(fs.readFileSync(file("sw.js"), "utf8")));
  });
}
