#!/usr/bin/env node
/**
 * Production preflight: checks the environment this process was started with against what a safe deployment needs.
 *
 *   node scripts/preflight.mjs            checks for the API server (Render, Docker, your own host)
 *   node scripts/preflight.mjs --frontdoor checks for the Vercel project (api/proxy.js)
 *   add --strict to treat warnings as failures
 *
 * It prints one verdict per check and the NAMES of variables involved, never their values (secrets included). Exit code 1 if any
 * check FAILs (or WARNs with --strict). Run it where the real environment exists, e.g. in the Render shell or as a pre-deploy command.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? "").trim());
const falsy = (v) => /^(0|false|no|off)$/i.test(String(v ?? "").trim());
const has = (env, k) => String(env[k] ?? "").trim() !== "";

/** @returns {Array<{level: "PASS"|"WARN"|"FAIL", id: string, message: string}>} */
export function runPreflight(env = process.env, opts = {}) {
  const out = [];
  const add = (level, id, message) => out.push({ level, id, message });
  const nodeMajor = Number(String(opts.nodeVersion || process.versions.node).split(".")[0]);
  const nodeMinor = Number(String(opts.nodeVersion || process.versions.node).split(".")[1]);

  if (opts.frontdoor) {
    const b = String(env.BACKEND_URL ?? "").trim();
    if (!b) add("FAIL", "BACKEND_URL", "not set: the Vercel proxy cannot reach the API (set it to the https:// origin of your Render service)");
    else if (!/^https:\/\//i.test(b)) add("FAIL", "BACKEND_URL", "must start with https:// (api/proxy.js refuses anything else)");
    else {
      let u = null;
      try { u = new URL(b); } catch { /* reported below */ }
      if (!u) add("FAIL", "BACKEND_URL", "is not a valid URL");
      else if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(u.hostname)) add("FAIL", "BACKEND_URL", "points at this machine, not at the deployed API");
      else if (u.pathname !== "/" && u.pathname !== "") add("WARN", "BACKEND_URL", "has a path; it should be the bare origin (no trailing path)");
      else add("PASS", "BACKEND_URL", "is an https origin");
    }
    return out;
  }

  if (nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 13)) add("PASS", "node", `Node ${opts.nodeVersion || process.versions.node} satisfies engines (>=22.13)`);
  else add("FAIL", "node", `Node ${opts.nodeVersion || process.versions.node} is older than the supported >=22.13`);

  if (env.NODE_ENV === "production") add("PASS", "NODE_ENV", "production");
  else add("FAIL", "NODE_ENV", "must be production (secure cookies, HSTS and strict defaults depend on it)");

  if (falsy(env.PRIVACY_STRICT)) add("FAIL", "PRIVACY_STRICT", "is off: every API route would be reachable without signing in and a shared demo account returns");
  else add("PASS", "PRIVACY_STRICT", "strict mode (the default)");

  const csp = String(env.PRIVACY_CSP ?? "enforce").toLowerCase();
  if (csp === "off") add("FAIL", "PRIVACY_CSP", "off: no Content-Security-Policy is sent");
  else if (csp === "report-only") add("WARN", "PRIVACY_CSP", "report-only: violations are reported but nothing is blocked (fine to trial a change, not to stay)");
  else add("PASS", "PRIVACY_CSP", "enforced");
  if (truthy(env.CSP_IMG_ALLOW_ALL)) add("WARN", "CSP_IMG_ALLOW_ALL", "allows images from any https host (a prompt-injected image URL can leak data)");
  if (truthy(env.CSP_CLASSIC_ALLOW_EVAL)) add("WARN", "CSP_CLASSIC_ALLOW_EVAL", "re-enables eval on the Classic page");

  if (truthy(env.ENABLE_RUN_ENGINE)) add("FAIL", "ENABLE_RUN_ENGINE", "on: any signed-in user can run commands on this server. Only for a private single-user instance");
  else add("PASS", "ENABLE_RUN_ENGINE", "off");

  if (String(env.PRIVACY_LOG_REDACTION ?? "").toLowerCase() === "off" || falsy(env.PRIVACY_LOG_REDACTION)) add("FAIL", "PRIVACY_LOG_REDACTION", "log redaction is off: prompts, e-mail addresses and tokens can reach the logs");
  if (truthy(env.AIVEN_ALLOW_PLAINTEXT)) add("FAIL", "AIVEN_ALLOW_PLAINTEXT", "would mirror data to Aiven unencrypted");
  if (truthy(env.IMAGE_ALLOW_THIRD_PARTY)) add("WARN", "IMAGE_ALLOW_THIRD_PARTY", "image prompts are sent to a third-party generator");
  if (String(env.LOG_LEVEL ?? "").toLowerCase() === "debug") add("WARN", "LOG_LEVEL", "debug is verbose and not meant for production");

  // storage: must be a persistent, writable location outside the application folder
  const rootRaw = String(env.DARKNESS_STORAGE_ROOT ?? "").trim();
  if (!rootRaw) add("WARN", "DARKNESS_STORAGE_ROOT", "not set: data goes to ./data inside the app folder, which is wiped on every redeploy on Render/Docker. Point it at a mounted disk");
  else {
    const root = path.resolve(rootRaw);
    const app = path.resolve(opts.cwd || process.cwd());
    if (!path.isAbsolute(rootRaw)) add("WARN", "DARKNESS_STORAGE_ROOT", "is relative; use an absolute path to the mounted disk");
    else if (root === app || root.startsWith(app + path.sep)) add("WARN", "DARKNESS_STORAGE_ROOT", "is inside the application folder: it will not survive a redeploy");
    else if (root.startsWith(path.resolve(opts.tmpdir || os.tmpdir()) + path.sep)) add("FAIL", "DARKNESS_STORAGE_ROOT", "is inside the system temp folder: it is cleared on reboot");
    else {
      let writable = false;
      try { fs.mkdirSync(root, { recursive: true }); fs.accessSync(root, fs.constants.W_OK); writable = true; } catch { /* reported */ }
      if (!writable) add("FAIL", "DARKNESS_STORAGE_ROOT", "does not exist or is not writable by this process");
      else {
        add("PASS", "DARKNESS_STORAGE_ROOT", "set, absolute, outside the app folder and writable");
        try {
          const s = fs.statfsSync(root);
          const freeMb = Math.floor((Number(s.bavail) * Number(s.bsize)) / 1048576);
          const min = Number(env.READINESS_MIN_FREE_MB || 200);
          if (freeMb < min) add("FAIL", "disk space", `${freeMb} MB free, below the ${min} MB readiness threshold (the instance would report not-ready)`);
          else add("PASS", "disk space", `${freeMb} MB free`);
        } catch { add("WARN", "disk space", "could not be read on this platform"); }
      }
    }
  }
  if (has(env, "DARKNESS_DB_PATH")) {
    const d = path.resolve(String(env.DARKNESS_DB_PATH));
    if (d.startsWith(path.resolve(opts.tmpdir || os.tmpdir()) + path.sep)) add("FAIL", "DARKNESS_DB_PATH", "is inside the system temp folder");
  }

  // behind a proxy chain
  if (!has(env, "TRUST_PROXY_HOPS")) add("WARN", "TRUST_PROXY_HOPS", "not set (defaults to 1): behind Vercel -> Render it should be 2, or every visitor shares one rate-limit bucket");
  else if (!/^[0-3]$/.test(String(env.TRUST_PROXY_HOPS).trim())) add("WARN", "TRUST_PROXY_HOPS", "should be a small whole number (0 to 3)");
  else add("PASS", "TRUST_PROXY_HOPS", "set");

  // cross-origin
  if (has(env, "CORS_ORIGINS")) {
    const list = String(env.CORS_ORIGINS).split(/[\s,]+/).filter(Boolean);
    if (list.includes("*")) add("FAIL", "CORS_ORIGINS", "contains * (credentials would be offered to any site)");
    else if (list.some((o) => !/^https:\/\//i.test(o))) add("WARN", "CORS_ORIGINS", "contains an origin that is not https://");
    else if (list.some((o) => /\/$/.test(o) || /\/\/[^/]+\/./.test(o))) add("WARN", "CORS_ORIGINS", "origins must be bare (scheme://host), without a path or trailing slash");
    else add("PASS", "CORS_ORIGINS", `${list.length} https origin(s)`);
  } else add("PASS", "CORS_ORIGINS", "empty: same-origin only (right when the UI is served by this service or through the Vercel proxy)");
  if (String(env.COOKIE_SAMESITE ?? "").toLowerCase() === "none") add("WARN", "COOKIE_SAMESITE", "none: only for a split-origin setup without the proxy; it weakens CSRF protection");

  // providers and mirrors
  const keys = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "TOGETHER_API_KEY", "MISTRAL_API_KEY"].filter((k) => has(env, k));
  if (keys.length) add("PASS", "provider keys", `${keys.length} configured (${keys.join(", ")})`);
  else add("WARN", "provider keys", "none configured: only models users add themselves will work");
  const leaked = Object.keys(env).filter((k) => /^VITE_.*(KEY|SECRET|TOKEN|PASSWORD)/i.test(k) && has(env, k));
  if (leaked.length) add("WARN", "VITE_* secrets", `${leaked.join(", ")}: VITE_ variables can be inlined into the browser bundle; use the server-side name instead`);
  // the vault key seals users' provider API keys at rest (and the Aiven mirror); it must decode to EXACTLY 32 bytes or the vault stays off
  const vaultLen = has(env, "PRIVACY_ENCRYPTION_KEY") ? Buffer.from(String(env.PRIVACY_ENCRYPTION_KEY), "base64").length : 0;
  if (has(env, "PRIVACY_ENCRYPTION_KEY") && vaultLen !== 32) add("FAIL", "PRIVACY_ENCRYPTION_KEY", `decodes to ${vaultLen} bytes; it must be exactly 32 (generate with scripts/new-secrets.ps1). With a wrong length provider keys are stored UNENCRYPTED`);
  else if (vaultLen === 32) add("PASS", "PRIVACY_ENCRYPTION_KEY", "present, 32 bytes: provider API keys are encrypted at rest");
  else if (has(env, "AIVEN_PG_URI")) add("FAIL", "PRIVACY_ENCRYPTION_KEY", "required when AIVEN_PG_URI is set (without it the mirror refuses to run)");
  else if (/^production$/i.test(String(env.NODE_ENV || ""))) add("WARN", "PRIVACY_ENCRYPTION_KEY", "not set: API keys that users save for their models are stored UNENCRYPTED in the database and its backups (set a 32-byte base64 key; see DEPLOY.md)");
  if (has(env, "PRIVACY_ENCRYPTION_KEY_PREVIOUS") && Buffer.from(String(env.PRIVACY_ENCRYPTION_KEY_PREVIOUS), "base64").length !== 32) add("FAIL", "PRIVACY_ENCRYPTION_KEY_PREVIOUS", "must decode to exactly 32 bytes");
  // account recovery by e-mail: absent is fine (the app then says so and operators issue links with scripts/admin.mjs); half-configured is not
  const mailProvider = String(env.MAIL_PROVIDER ?? "").trim().toLowerCase();
  if (!mailProvider) {
    add("PASS", "MAIL_PROVIDER", "not set: 'Forgot password' reports itself unavailable and recovery is operator-only (node scripts/admin.mjs reset-link <email>); see DEPLOY.md");
  } else {
    const prod = /^production$/i.test(String(env.NODE_ENV || ""));
    const problems = [];
    if (mailProvider !== "smtp" && mailProvider !== "resend") problems.push("MAIL_PROVIDER must be smtp or resend");
    else {
      if (!has(env, "MAIL_FROM")) problems.push("MAIL_FROM is required");
      if (!has(env, "PUBLIC_APP_URL")) problems.push("PUBLIC_APP_URL is required");
      else if (!/^https?:\/\/[^\s/]+/.test(String(env.PUBLIC_APP_URL).trim())) problems.push("PUBLIC_APP_URL must be an http(s) URL");
      else if (prod && !/^https:\/\//.test(String(env.PUBLIC_APP_URL).trim())) problems.push("PUBLIC_APP_URL must be https in production");
      if (mailProvider === "resend" && !has(env, "RESEND_API_KEY")) problems.push("RESEND_API_KEY is required");
      if (mailProvider === "smtp") {
        if (!has(env, "SMTP_HOST")) problems.push("SMTP_HOST is required");
        const mode = String(env.SMTP_TLS || "starttls").trim().toLowerCase();
        if (!["starttls", "implicit", "none"].includes(mode)) problems.push("SMTP_TLS must be starttls, implicit or none");
        if (mode === "none" && prod && !/^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(String(env.SMTP_HOST || "").trim())) problems.push("SMTP_TLS=none is only allowed for localhost in production");
        if (has(env, "SMTP_USER") !== has(env, "SMTP_PASS")) problems.push("SMTP_USER and SMTP_PASS must be set together");
        const port = Number(env.SMTP_PORT || 587);
        if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("SMTP_PORT is not a valid port");
      }
    }
    if (problems.length) add("FAIL", "MAIL_*", problems.join("; ") + " (until fixed, the server treats e-mail as NOT configured)");
    else add("PASS", "MAIL_*", `${mailProvider} settings are complete (this checks the settings only: it does not prove that a message is delivered, see docs/OPERATIONS-VERIFICATION.md)`);
  }
  if (has(env, "AIVEN_PG_URI")) {
    if (!has(env, "AIVEN_CA_CERT") && !/sslmode=(verify-full|verify-ca)/i.test(String(env.AIVEN_PG_URI))) add("WARN", "AIVEN_CA_CERT", "not set: the database connection is encrypted but the server's identity is not verified");
  }
  if (has(env, "SUPABASE_URL") && !has(env, "SUPABASE_SERVICE_ROLE_KEY")) add("WARN", "SUPABASE_URL", "set without SUPABASE_SERVICE_ROLE_KEY: the mirror cannot write");
  if (has(env, "PORT") && !/^\d+$/.test(String(env.PORT))) add("FAIL", "PORT", "is not a number");
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const results = runPreflight(process.env, { frontdoor: args.includes("--frontdoor") });
  const icon = { PASS: "ok  ", WARN: "WARN", FAIL: "FAIL" };
  for (const r of results) console.log(`${icon[r.level]} ${r.id}: ${r.message}`);
  const fails = results.filter((r) => r.level === "FAIL").length;
  const warns = results.filter((r) => r.level === "WARN").length;
  console.log(`\n${results.length - fails - warns} ok, ${warns} warning(s), ${fails} failure(s)  (values are never printed)`);
  process.exitCode = fails || (args.includes("--strict") && warns) ? 1 : 0;
}
