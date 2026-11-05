import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test, { after, before } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";

process.env.LOG_FORMAT = "json";
const { logger, setLogSink } = await import("../server/observability/logger.js");
const csp = await import("../server/security/csp.js");
const { splitClassicHtml, BOOT_JS } = await import("../server/classic/transform.mjs");

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const directive = (policy: string, name: string): string[] => ((policy.split("; ").find((d) => d.startsWith(name + " ")) || "").split(" ").slice(1));

const ENV_KEYS = ["CSP_CONNECT_EXTRA", "CSP_IMG_EXTRA", "CSP_IMG_ALLOW_ALL", "CSP_UPGRADE_INSECURE", "CSP_CLASSIC_ALLOW_EVAL", "CSP_CLASSIC_STYLE_HASHES", "CSP_CLASSIC_STYLE_INLINE", "PRIVACY_CSP", "NODE_ENV"];
function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  try { return fn(); } finally { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

// ------------------------------------------------------------------------------------------------ the policy itself

test("app policy: scripts only from this origin, no inline, no eval, no inline handlers", () => {
  const p = withEnv({}, () => csp.buildCsp("app"));
  assert.deepEqual(directive(p, "default-src"), ["'self'"]);
  const scriptSrc = directive(p, "script-src");
  assert.ok(scriptSrc.includes("'self'"));
  for (const v of scriptSrc) assert.ok(["'self'", "'report-sample'"].includes(v), "unexpected script source " + v);
  assert.deepEqual(directive(p, "script-src-attr"), ["'none'"]);
  assert.ok(!/'unsafe-eval'/.test(p) && !/'wasm-unsafe-eval'/.test(p), "no eval");
  // style ELEMENTS are 'self' only; the one inline allowance is style="" attributes
  for (const v of directive(p, "style-src-elem")) assert.ok(["'self'", "'report-sample'"].includes(v), "unexpected style-elem source " + v);
  assert.deepEqual(directive(p, "style-src-attr"), ["'unsafe-inline'"]);
  assert.deepEqual(directive(p, "object-src"), ["'none'"]);
  assert.deepEqual(directive(p, "base-uri"), ["'self'"]);
  assert.deepEqual(directive(p, "form-action"), ["'self'"]);
  assert.deepEqual(directive(p, "frame-ancestors"), ["'self'"]);
  assert.deepEqual(directive(p, "connect-src"), ["'self'"]);
  assert.deepEqual(directive(p, "font-src"), ["'self'", "data:"]);
  assert.deepEqual(directive(p, "report-uri"), ["/api/csp-report"]);
});

test("no policy ever contains a wildcard, a bare https:/http:, or a CDN host (unless the operator opts in)", () => {
  for (const surface of ["app", "classic"] as const) {
    const p = withEnv({}, () => csp.buildCsp(surface));
    assert.ok(!/(^|\s)\*(\s|;|$)/.test(p), surface + " has a wildcard");
    assert.ok(!/(^|\s)https?:(\s|;|$)/.test(p), surface + " allows any https:/http: source");
    assert.ok(!/cdn\.jsdelivr|cdnjs\.cloudflare|fonts\.googleapis|fonts\.gstatic|unpkg/.test(p), surface + " allows a CDN");
    assert.ok(!/unsafe-inline/.test(directive(p, "script-src").join(" ")), surface + " script-src has unsafe-inline");
    assert.ok(!/unsafe-inline/.test(directive(p, "style-src-elem").join(" ")), surface + " style-src-elem has unsafe-inline");
  }
});

test("img-src is an allow-list of image hosts, not every https: host", () => {
  const img = withEnv({}, () => directive(csp.buildCsp("app"), "img-src"));
  assert.ok(img.includes("data:") && img.includes("blob:") && img.includes("'self'"));
  assert.ok(img.includes("https://raw.githubusercontent.com"));
  assert.ok(!img.includes("https:"));
  const extra = withEnv({ CSP_IMG_EXTRA: "https://images.example.com, https://cdn.example.org" }, () => directive(csp.buildCsp("app"), "img-src"));
  assert.ok(extra.includes("https://images.example.com") && extra.includes("https://cdn.example.org"));
  const all = withEnv({ CSP_IMG_ALLOW_ALL: "true" }, () => directive(csp.buildCsp("app"), "img-src"));
  assert.ok(all.includes("https:"), "the documented opt-out still works");
});

test("operator-supplied hosts are validated: junk, quotes and directive separators cannot be smuggled in", () => {
  const p = withEnv({ CSP_CONNECT_EXTRA: "https://api.example.com; script-src *, 'unsafe-inline', javascript:alert(1), ftp://x", CSP_IMG_EXTRA: "https://ok.example.com;default-src * " }, () => csp.buildCsp("app"));
  assert.ok(!directive(p, "script-src").includes("*"));
  assert.ok(!p.includes("javascript:"));
  assert.ok(!p.includes("ftp://"));
  assert.ok(directive(p, "connect-src").includes("https://api.example.com") === false, "a value containing ';' is rejected whole");
  assert.deepEqual(directive(p, "default-src"), ["'self'"]);
  const ok = withEnv({ CSP_CONNECT_EXTRA: "https://api.example.com wss://live.example.com" }, () => directive(csp.buildCsp("app"), "connect-src"));
  assert.deepEqual(ok, ["'self'", "https://api.example.com", "wss://live.example.com"]);
});

test("classic policy: Google sign-in limited to its exact paths, no eval by default, Google style block pinned by hash", () => {
  const p = withEnv({}, () => csp.buildCsp("classic"));
  assert.deepEqual(directive(p, "script-src"), ["'self'", "'report-sample'", "https://accounts.google.com/gsi/client"]);
  assert.ok(!/'unsafe-eval'/.test(p));
  assert.ok(directive(p, "style-src-elem").includes(csp.GSI_STYLE_HASH));
  assert.ok(directive(p, "frame-src").includes("https://accounts.google.com/gsi/"));
  assert.ok(directive(p, "connect-src").includes("https://accounts.google.com/gsi/"));
  assert.ok(!/https:\/\/accounts\.google\.com(\s|;|$)/.test(p), "the whole accounts.google.com origin must not be allowed");
  assert.ok(withEnv({ CSP_CLASSIC_ALLOW_EVAL: "true" }, () => directive(csp.buildCsp("classic"), "script-src")).includes("'unsafe-eval'"));
  assert.ok(!withEnv({ CSP_CLASSIC_ALLOW_EVAL: "true" }, () => directive(csp.buildCsp("app"), "script-src")).includes("'unsafe-eval'"), "eval opt-in never reaches the main app");
  const hashes = withEnv({ CSP_CLASSIC_STYLE_HASHES: "'sha256-AAAA=' evil 'md5-xx'" }, () => directive(csp.buildCsp("classic"), "style-src-elem"));
  assert.ok(hashes.includes("'sha256-AAAA='") && !hashes.includes("evil") && !hashes.includes("'md5-xx'"));
});

test("the policy mode is enforce in production and report-only in development; report-only and off are explicit choices", () => {
  assert.equal(withEnv({ NODE_ENV: "production" }, () => csp.cspMode()), "enforce");
  assert.equal(withEnv({}, () => csp.cspMode()), "report-only", "npm run dev (Vite's inline preamble and HMR websocket) must not be blocked");
  assert.equal(withEnv({ NODE_ENV: "development" }, () => csp.cspMode()), "report-only");
  assert.equal(withEnv({ NODE_ENV: "development", PRIVACY_CSP: "enforce" }, () => csp.cspMode()), "enforce", "an explicit choice wins in development too");
  assert.equal(withEnv({ NODE_ENV: "production", PRIVACY_CSP: "report-only" }, () => csp.cspMode()), "report-only");
  assert.equal(withEnv({ NODE_ENV: "production", PRIVACY_CSP: "off" }, () => csp.cspMode()), "off");
  assert.equal(withEnv({ NODE_ENV: "production", PRIVACY_CSP: "garbage" }, () => csp.cspMode()), "enforce", "an unknown value fails closed");
  assert.equal(withEnv({ PRIVACY_CSP: "garbage" }, () => csp.cspMode()), "enforce", "...in development too");
});

test("applyCspHeaders picks the surface by path and the header by mode", () => {
  const run = (envv: Record<string, string>, p: string) => withEnv(envv, () => {
    const headers: Record<string, string> = {};
    csp.applyCspHeaders({ path: p } as any, { setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; } } as any);
    return headers;
  });
  const app = run({ NODE_ENV: "production" }, "/chat");
  assert.ok(app["content-security-policy"] && !app["content-security-policy-report-only"]);
  assert.ok(!app["content-security-policy"].includes("accounts.google.com"));
  assert.ok(run({ NODE_ENV: "production" }, "/classic/")["content-security-policy"].includes("accounts.google.com/gsi/client"));
  const ro = run({ PRIVACY_CSP: "report-only" }, "/");
  assert.ok(ro["content-security-policy-report-only"] && !ro["content-security-policy"]);
  assert.deepEqual(run({ PRIVACY_CSP: "off" }, "/"), {});
});

// ------------------------------------------------------------------------------------------------ vercel.json cannot drift

test("vercel.json sends exactly the policy csp.ts builds (run `node --import tsx scripts/sync-vercel-csp.mjs` after changing csp.ts)", () => {
  const cfg = JSON.parse(read("vercel.json"));
  const bySource = (s: string) => cfg.headers.find((h: any) => h.source === s);
  const val = (rule: any, key: string) => (rule.headers.find((h: any) => h.key === key) || {}).value;
  const app = bySource("/((?!classic/).*)");
  const classic = bySource("/classic/(.*)");
  assert.ok(app && classic, "both header rules exist");
  assert.equal(val(app, "Content-Security-Policy"), withEnv({}, () => csp.buildCsp("app")));
  assert.equal(val(classic, "Content-Security-Policy"), withEnv({}, () => csp.buildCsp("classic")));
  for (const rule of [app, classic]) {
    assert.ok(!rule.headers.some((h: any) => /report-only/i.test(h.key)), "enforcing, not report-only");
    assert.ok(rule.headers.some((h: any) => h.key === "X-Content-Type-Options"), "the other security headers are kept");
  }
});

// ------------------------------------------------------------------------------------------------ no inline code creeps back in

const PAGES = ["web/index.html", "index.html", "web/public/copilot.html", "web/public/agent.html"];
// an attribute: onclick="..." / onclick='...' / onclick=\"...\" inside a JS string. React props (onClick={...}) and variables (onKeyDown = ...) do not match.
const INLINE_HANDLER = /\son(?:click|dblclick|error|load|change|input|submit|keydown|keyup|keypress|focus|blur|mouseover|mouseout|mouseenter|mouseleave|mousedown|mouseup|touchstart|touchend|pointerdown|pointerup|toggle|select|scroll|drop|dragstart|dragover|contextmenu|wheel|animationend|transitionend)\s*=\s*\\?["']/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + "/" + e.name;
    if (e.isDirectory()) { if (e.name !== "vendor" && e.name !== "node_modules") walk(rel, out); } else out.push(rel);
  }
  return out;
}

test("HTML pages contain no inline <script>, no inline <style> and no inline event-handler attributes", () => {
  for (const f of PAGES) {
    const html = read(f);
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>\s*\S/i.test(html.replace(/<script[^>]*\stype=["']application\/(ld\+)?json["'][^>]*>[\s\S]*?<\/script>/gi, "")) || f === "index.html", f + " has an inline <script>");
    if (f !== "index.html") assert.ok(!/<style[\s>]/i.test(html), f + " has an inline <style>");
    if (f !== "index.html") assert.ok(!INLINE_HANDLER.test(html), f + " has an inline event handler");
  }
});

test("the app's JavaScript never builds inline event-handler attributes (they would be blocked, and break the button)", () => {
  const offenders: string[] = [];
  for (const dir of ["web/js", "web/src"]) for (const f of walk(dir)) {
    if (!/\.(js|jsx|ts)$/.test(f)) continue;
    read(f).split("\n").forEach((line, i) => { if (INLINE_HANDLER.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
  for (const f of walk("web/public").filter((x) => /\.(js|html)$/.test(x))) {
    read(f).split("\n").forEach((line, i) => { if (INLINE_HANDLER.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
  assert.deepEqual(offenders, []);
});

test("the app's JavaScript never injects a <style> element or uses eval/new Function/string timers (the policy forbids all three)", () => {
  const offenders: string[] = [];
  for (const f of [...walk("web/js"), ...walk("web/src"), ...walk("web/public")]) {
    if (!/\.(js|jsx)$/.test(f)) continue;
    read(f).split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      // createElement("style") is allowed only for a detached SVG clone that is serialised to a string (markdown.js export)
      if (/createElement\(\s*["']style["']\s*\)/.test(line) && !f.endsWith("lib/markdown.js")) offenders.push(`${f}:${i + 1}: injected <style>`);
      if (/(^|[^.\w])eval\s*\(|new\s+Function\s*\(|set(Timeout|Interval)\(\s*["'`]/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test("HTML entry points load scripts, styles and fonts only from this origin (plus Google Sign-In on the Classic page)", () => {
  for (const f of PAGES) {
    const html = read(f);
    const hosts = [...html.matchAll(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)=["'](https?:)?\/\/([^/"']+)/gi)].map((m) => m[2]);
    const allowed = f === "index.html" ? ["accounts.google.com"] : [];
    assert.deepEqual(hosts.filter((h) => !allowed.includes(h)), [], f + " references an external host");
  }
});

test("the vendored third-party assets the pages point at exist", () => {
  for (const f of ["web/index.html", "index.html"]) {
    for (const m of read(f).matchAll(/(?:src|href)=["'](\/vendor\/[^"']+)["']/g)) {
      assert.ok(fs.existsSync(path.join(root, "web/public", m[1])), `${f} references ${m[1]} which is missing`);
    }
  }
  assert.ok(fs.existsSync(path.join(root, "web/public/vendor/README.md")));
});

// ------------------------------------------------------------------------------------------------ Classic app transformation

test("splitClassicHtml moves every inline <style>/<script> into a file and keeps order, content and embedded markup strings", () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><script src="https://accounts.google.com/gsi/client" async></script><style>
body{color:red}</style></head><body><p>hi</p><script>
const t = '<style>.x{}</style>'; const u = "<script>"+"</"+"script>"; console.log(t);
</script></body></html>`;
  const r = splitClassicHtml(html);
  assert.deepEqual(Object.keys(r.assets).sort(), ["app.css", "app.js", "boot.js"]);
  assert.equal(r.assets["boot.js"], BOOT_JS);
  assert.ok(r.assets["app.css"].includes("body{color:red}"));
  assert.ok(r.assets["app.js"].includes("'<style>.x{}</style>'"), "a <style> string inside the script stays in the script");
  assert.ok(!/<style|<script>(?!<)/i.test(r.html.replace(/<script src=[^>]*><\/script>/g, "")), "no inline blocks remain: " + r.html);
  assert.ok(r.html.indexOf('src="boot.js"') < r.html.indexOf('src="app.js"'), "boot.js runs before the app");
  assert.ok(r.html.includes('<link rel="stylesheet" href="app.css">'));
  assert.ok(r.html.includes('src="https://accounts.google.com/gsi/client"'), "external scripts are left alone");
});

test("the real Classic index.html transforms into a page with no inline code and a parseable app.js", () => {
  const r = splitClassicHtml(read("index.html"));
  assert.ok(!/<style[\s>]/i.test(r.html));
  assert.deepEqual([...r.html.matchAll(/<script\b([^>]*)>/gi)].filter((m) => !/\bsrc=/.test(m[1])), []);
  assert.ok(!INLINE_HANDLER.test(r.html), "Classic page has an inline handler");
  assert.ok(r.assets["app.js"].length > 100_000 && r.assets["app.css"].length > 50_000);
  assert.doesNotThrow(() => new Function(r.assets["app.js"]), "app.js is syntactically valid");
  assert.ok(r.assets["boot.js"].includes("darkness-api-url"));
});

// ------------------------------------------------------------------------------------------------ report parsing + endpoint

test("safeUrl keeps origin+path only (query strings and fragments can carry tokens)", () => {
  assert.equal(csp.safeUrl("https://x.example/a/b.js?token=SECRET#frag"), "https://x.example/a/b.js");
  assert.equal(csp.safeUrl("http://127.0.0.1:3000/?t=1"), "http://127.0.0.1:3000/");
  assert.equal(csp.safeUrl("inline"), "inline");
  assert.equal(csp.safeUrl("data:text/html;base64,AAAA"), "data");
  assert.equal(csp.safeUrl("eval"), "eval");
  assert.equal(csp.safeUrl(undefined), "");
  assert.ok(csp.safeUrl("https://x.example/" + "a".repeat(500)).length <= 200);
});

test("parseReports understands the legacy and the Reporting API formats and ignores junk", () => {
  const legacy = csp.parseReports({ "csp-report": { "document-uri": "https://app.example/?a=1", "effective-directive": "script-src-elem", "blocked-uri": "inline", "source-file": "https://app.example/x.js?y", "line-number": 7, disposition: "enforce", "script-sample": "alert(1)" } });
  assert.deepEqual(legacy, [{ directive: "script-src-elem", blocked: "inline", document: "https://app.example/", source: "https://app.example/x.js", line: 7, disposition: "enforce", sample: "alert(1)" }]);
  const modern = csp.parseReports([{ type: "csp-violation", body: { documentURL: "https://app.example/p", effectiveDirective: "img-src", blockedURL: "https://evil.example/p.png?q=1", disposition: "report" } }, { type: "network-error", body: {} }]);
  assert.equal(modern.length, 1);
  assert.equal(modern[0].directive, "img-src");
  assert.equal(modern[0].blocked, "https://evil.example/p.png");
  assert.deepEqual(csp.parseReports("nope"), []);
  assert.deepEqual(csp.parseReports(null), []);
  assert.deepEqual(csp.parseReports({ "csp-report": "string" }), []);
  assert.equal(csp.parseReports(Array.from({ length: 50 }, () => ({ "csp-report": { "effective-directive": "x" } }))).length, 10, "at most 10 per request");
});

let server: http.Server;
let base = "";
const logged: any[] = [];

before(async () => {
  setLogSink((line) => { try { logged.push(JSON.parse(line)); } catch { /* not json */ } });
  const app = express();
  csp.cspReportRoutes(app);
  app.use(express.json());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { setLogSink(null as any); await new Promise((r) => server.close(r)); });

test("POST /api/csp-report: always 204, logs a sanitised warning, never echoes input", async () => {
  csp.resetCspViolationStats();
  logged.length = 0;
  const body = JSON.stringify({ "csp-report": { "document-uri": base + "/chat?token=SECRET", "effective-directive": "script-src-elem", "blocked-uri": "https://evil.example/x.js?k=SECRET", disposition: "enforce" } });
  const res = await fetch(base + "/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report" }, body });
  assert.equal(res.status, 204);
  assert.equal(await res.text(), "");
  const line = logged.find((l) => l.event === "csp_violation");
  assert.ok(line, "a csp_violation log line was written: " + JSON.stringify(logged.slice(-3)));
  assert.ok(!JSON.stringify(line).includes("SECRET"), "query strings are stripped before logging");
  assert.equal(csp.cspViolationStats()[0].key, "script-src-elem <- https://evil.example/x.js");
});

test("POST /api/csp-report: malformed, empty, wrong type and oversized bodies never crash and never leak an error page", async () => {
  for (const [ct, b] of [["application/json", "{not json"], ["application/json", ""], ["text/plain", "hello"], ["application/reports+json", "[1,2,3]"], ["application/json", "[]"]] as const) {
    const res = await fetch(base + "/api/csp-report", { method: "POST", headers: { "content-type": ct }, body: b });
    assert.equal(res.status, 204, `${ct} ${JSON.stringify(b).slice(0, 20)} -> ${res.status}`);
    assert.equal(await res.text(), "");
  }
  const big = await fetch(base + "/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report" }, body: JSON.stringify({ "csp-report": { "blocked-uri": "x".repeat(40_000) } }) });
  assert.equal(big.status, 413, "a 40 KB report is over the 16 KB limit");
  const alive = await fetch(base + "/api/csp-report", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(alive.status, 204);
});

test("/api/csp-report is POST-only and the per-minute log budget caps log volume", async () => {
  const get = await fetch(base + "/api/csp-report");
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
  csp.resetCspViolationStats();
  logged.length = 0;
  const one = JSON.stringify({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://flood.example/a.png" } });
  for (let i = 0; i < 160; i++) await fetch(base + "/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report" }, body: one });
  const n = logged.filter((l) => l.event === "csp_violation").length;
  assert.ok(n <= 120, `at most 120 log lines per minute, got ${n}`);
  assert.equal(csp.cspViolationStats()[0].count, 160, "but every report is still counted");
  void logger;
});

// ------------------------------------------------------------------------------------------------ libraries that inject <style>

test("known, already-handled reports (Mermaid's temporary theme CSS) are recognised; real inline-style violations are not", () => {
  const base = { directive: "style-src-elem", blocked: "inline", document: "https://app.example/", disposition: "enforce" };
  assert.equal(csp.knownBenignReason({ ...base, sample: "#mermaid_svg_ab12{font-family:-apple-system" }), "mermaid-theme-css");
  assert.equal(csp.knownBenignReason({ ...base, sample: "#dmermaid_svg_ab12 {font" }), "mermaid-theme-css");
  assert.equal(csp.knownBenignReason({ ...base, sample: "body{display:none}" }), null, "an attacker's style block is not benign");
  assert.equal(csp.knownBenignReason({ ...base, sample: "#mermaid_svg_ab12{}", directive: "script-src-elem" }), null, "only style reports");
  assert.equal(csp.knownBenignReason({ ...base, blocked: "https://evil.example/x.css", sample: "#mermaid_svg_ab12{}" }), null, "only inline");
  assert.equal(csp.knownBenignReason({ ...base }), null, "no sample, no exemption");
});

test("Cytoscape's runtime <style> injection is pre-empted by a stylesheet <link> with the id the library checks", () => {
  const src = read("node_modules/cytoscape/src/extensions/renderer/base/index.mjs");
  const id = (src.match(/stylesheetId\s*=\s*'([^']+)'/) || [])[1];
  const cls = (src.match(/className\s*=\s*'([^']+)'/) || [])[1];
  const rule = (src.match(/stylesheet\.textContent\s*=\s*'\.'\+className\+'\s*\{([^}]*)\}'/) || [])[1];
  assert.ok(id && cls && rule, "could not read the library's injection code: re-check web/public/cytoscape-container.css after the upgrade");
  const html = read("web/index.html");
  assert.ok(new RegExp(`<link[^>]*\\sid="${id}"[^>]*href="/cytoscape-container\\.css"`).test(html), `index.html must carry <link id="${id}" ...>`);
  const css = read("web/public/cytoscape-container.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(css.includes("." + cls), "the stylesheet defines the container class");
  assert.equal(css.replace(/\s+/g, "").includes(`.${cls}{${rule.replace(/\s+/g, "")}}`), true, "the stylesheet has the same declaration the library would have injected: " + rule);
});

test("no application code inserts SVG/HTML containing a <style> element without going through the CSSOM converter", () => {
  const md = read("web/js/lib/markdown.js");
  assert.ok(/function inlineStylesInPlace/.test(md) && /function inlineEmbeddedSvgStyles/.test(md));
  // both ```svg render paths and the mermaid insertion use the converter
  assert.equal((md.match(/visual-card__canvas">' \+ inlineEmbeddedSvgStyles\(/g) || []).length, 2);
  assert.ok(/tempDiv\.innerHTML = inlineEmbeddedSvgStyles\(renderedSvg\)/.test(md));
});
