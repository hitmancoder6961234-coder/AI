/**
 * Turns the original single-file Darkness app (repo-root index.html, ~400 KB with one huge inline <style> and one huge inline
 * <script>) into a page that works under a Content-Security-Policy which forbids inline script and inline style elements:
 *
 *   - every inline <style>   -> /classic/app.css  (app-2.css, ... if there are several)
 *   - every inline <script>  -> /classic/app.js   (app-2.js, ...), in the same position so execution order is unchanged
 *   - the default-backend bootstrap that used to be injected as an inline script -> /classic/boot.js
 *
 * Plain .mjs on purpose: it is imported by the server (server/classic/serve.ts) AND run by scripts/postbuild.mjs at build time,
 * so both publish byte-identical output.
 */

/** Points the app at this deployment's /classic-api the first time it is opened. */
export const BOOT_JS = "try{if(!localStorage.getItem('darkness-api-url'))localStorage.setItem('darkness-api-url',location.origin+'/classic-api')}catch(e){}\n";

// One pass, in document order, over attribute-less blocks (those are the app's own). A single pass matters: the app's script
// contains strings such as '<style>...</style>' (it generates web pages), and those must stay inside the script file.
const BLOCK_RE = /<(style|script)>([\s\S]*?)<\/\1>/gi;

/**
 * @param {string} html the original index.html
 * @returns {{ html: string, assets: Record<string, string> }} the page and every file it now references (relative to /classic/)
 */
export function splitClassicHtml(html) {
  /** @type {Record<string, string>} */
  const assets = { "boot.js": BOOT_JS };
  let nStyle = 0;
  let nScript = 0;
  let out = html.replace(BLOCK_RE, (_m, tag, body) => {
    if (tag.toLowerCase() === "style") {
      nStyle++;
      const name = nStyle === 1 ? "app.css" : `app-${nStyle}.css`;
      assets[name] = body.replace(/^\r?\n/, "");
      return `<link rel="stylesheet" href="${name}">`;
    }
    nScript++;
    const name = nScript === 1 ? "app.js" : `app-${nScript}.js`;
    assets[name] = body.replace(/^\r?\n/, "");
    return `<script src="${name}"></script>`;
  });
  // the bootstrap must run before the app script, so it goes first in <head>
  out = out.replace(/<head([^>]*)>/i, `<head$1><script src="boot.js"></script>`);
  return { html: out, assets };
}

export const ASSET_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};
