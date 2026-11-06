/**
 * Serves the original Darkness single-page app (repo-root index.html) at /classic/.
 *
 * - A default backend URL is set (boot.js) so it talks to this deployment's /classic-api with no setup.
 * - The inline <style>/<script> blocks are served as app.css / app.js (see transform.mjs) so the CSP can forbid inline code.
 * - Visitors without a session are sent to the sign-in screen.
 * - The original service worker is patched: it only skipped caching for URLs starting with /api/, so it
 *   would have cached /classic-api/api/* responses. The patched copy skips anything containing /api/.
 */
import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import { splitClassicHtml, ASSET_TYPES } from "./transform.mjs";

/** The page and the files it references (app.css, app.js, boot.js), derived from index.html and cached until the file changes. */
let bundle: { mtimeMs: number; html: string; assets: Record<string, string> } | null = null;
function classicBundle(indexPath: string) {
  const mtimeMs = fs.statSync(indexPath).mtimeMs;
  if (!bundle || bundle.mtimeMs !== mtimeMs) bundle = { mtimeMs, ...splitClassicHtml(fs.readFileSync(indexPath, "utf8")) };
  return bundle;
}

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
    res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).send(classicBundle(p).html);
  };

  app.get(["/classic", "/classic/", "/classic/index.html"], page);

  // app.css / app.js / boot.js: what used to be inline <style>/<script> (the Content-Security-Policy forbids inline code).
  app.get(/^\/classic\/(app(?:-\d+)?\.(?:css|js)|boot\.js)$/, (req: Request, res: Response) => {
    const p = file("index.html");
    if (!fs.existsSync(p)) return res.status(404).end();
    const name = String(req.params[0]);
    const body = classicBundle(p).assets[name];
    if (body === undefined) return res.status(404).end();
    res.set({ "Content-Type": ASSET_TYPES[path.extname(name)] || "text/plain; charset=utf-8", "Cache-Control": "no-cache" }).send(body);
  });

  app.get("/classic/manifest.json", (_req, res) => {
    if (!fs.existsSync(file("manifest.json"))) return res.status(404).end();
    res.type("application/manifest+json").send(fs.readFileSync(file("manifest.json"), "utf8"));
  });

  app.get("/classic/sw.js", (_req, res) => {
    if (!fs.existsSync(file("sw.js"))) return res.status(404).end();
    res.set({ "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/classic/" }).send(patchClassicServiceWorker(fs.readFileSync(file("sw.js"), "utf8")));
  });
}
