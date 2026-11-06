import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const { runPreflight } = await import("../scripts/preflight.mjs");
const script = path.resolve(import.meta.dirname, "..", "scripts", "preflight.mjs");

// a writable folder that is not inside the (fake) app folder and not in the system temp folder
const diskRoot = path.resolve(import.meta.dirname, "..", "node_modules", ".preflight-test-disk");
fs.mkdirSync(diskRoot, { recursive: true });
const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-app-"));
// "the system temp folder" is injected, so these tests do not depend on where the repository happens to be checked out (a CI or
// clean-room copy lives under the real temp folder, which would make every path below a temp path)
const FAKE_TMP = path.join(path.parse(process.cwd()).root, "preflight-fake-temp");
const key = Buffer.alloc(32, 7).toString("base64");

const GOOD: Record<string, string> = {
  NODE_ENV: "production", PRIVACY_STRICT: "true", PRIVACY_CSP: "enforce", DARKNESS_STORAGE_ROOT: diskRoot, TRUST_PROXY_HOPS: "2",
  CORS_ORIGINS: "https://app.example.com", PRIVACY_ENCRYPTION_KEY: key, GEMINI_API_KEY: "SECRET-VALUE-1234567890", PORT: "10000",
};
const run = (env: Record<string, string>, opts: Record<string, unknown> = {}) => runPreflight(env, { cwd: appDir, tmpdir: FAKE_TMP, ...opts });
const by = (r: ReturnType<typeof run>, id: string) => r.filter((x) => x.id === id);
const levels = (r: ReturnType<typeof run>) => r.map((x) => x.level);

test("a correct production environment has no failures and no warnings", () => {
  const r = run(GOOD);
  assert.deepEqual(r.filter((x) => x.level !== "PASS"), []);
  assert.ok(r.length >= 10);
});

test("each dangerous setting is a FAIL with a reason", () => {
  const bad: Array<[Record<string, string>, string]> = [
    [{ NODE_ENV: "development" }, "NODE_ENV"],
    [{ PRIVACY_STRICT: "false" }, "PRIVACY_STRICT"],
    [{ PRIVACY_CSP: "off" }, "PRIVACY_CSP"],
    [{ ENABLE_RUN_ENGINE: "true" }, "ENABLE_RUN_ENGINE"],
    [{ CORS_ORIGINS: "*" }, "CORS_ORIGINS"],
    [{ PRIVACY_LOG_REDACTION: "off" }, "PRIVACY_LOG_REDACTION"],
    [{ AIVEN_ALLOW_PLAINTEXT: "true" }, "AIVEN_ALLOW_PLAINTEXT"],
    [{ PORT: "abc" }, "PORT"],
    [{ DARKNESS_STORAGE_ROOT: path.join(FAKE_TMP, "x-data") }, "DARKNESS_STORAGE_ROOT"],
    [{ AIVEN_PG_URI: "postgres://u:p@h:1/db", PRIVACY_ENCRYPTION_KEY: "" }, "PRIVACY_ENCRYPTION_KEY"],
    [{ AIVEN_PG_URI: "postgres://u:p@h:1/db", PRIVACY_ENCRYPTION_KEY: "c2hvcnQ=" }, "PRIVACY_ENCRYPTION_KEY"],
  ];
  for (const [over, id] of bad) {
    const r = run({ ...GOOD, ...over });
    assert.ok(by(r, id).some((x) => x.level === "FAIL" && x.message.length > 10), `${id} with ${JSON.stringify(Object.keys(over))} must FAIL: ${JSON.stringify(by(r, id))}`);
  }
  assert.ok(by(run(GOOD, { nodeVersion: "20.11.0" }), "node").some((x) => x.level === "FAIL"));
  assert.ok(by(run(GOOD, { nodeVersion: "22.13.0" }), "node").every((x) => x.level === "PASS"));
  assert.ok(by(run(GOOD, { nodeVersion: "24.0.0" }), "node").every((x) => x.level === "PASS"));
});

test("risky-but-possible settings are WARNs, not failures", () => {
  const warn: Array<[Record<string, string>, string]> = [
    [{ PRIVACY_CSP: "report-only" }, "PRIVACY_CSP"],
    [{ DARKNESS_STORAGE_ROOT: "" }, "DARKNESS_STORAGE_ROOT"],
    [{ DARKNESS_STORAGE_ROOT: path.join(appDir, "data") }, "DARKNESS_STORAGE_ROOT"],
    [{ TRUST_PROXY_HOPS: "" }, "TRUST_PROXY_HOPS"],
    [{ CORS_ORIGINS: "http://insecure.example.com" }, "CORS_ORIGINS"],
    [{ COOKIE_SAMESITE: "none" }, "COOKIE_SAMESITE"],
    [{ IMAGE_ALLOW_THIRD_PARTY: "true" }, "IMAGE_ALLOW_THIRD_PARTY"],
    [{ CSP_IMG_ALLOW_ALL: "true" }, "CSP_IMG_ALLOW_ALL"],
    [{ LOG_LEVEL: "debug" }, "LOG_LEVEL"],
    [{ VITE_GEMINI_API_KEY: "abc" }, "VITE_* secrets"],
    [{ GEMINI_API_KEY: "" }, "provider keys"],
  ];
  for (const [over, id] of warn) {
    const r = run({ ...GOOD, ...over });
    assert.ok(by(r, id).some((x) => x.level === "WARN"), `${id} should WARN: ${JSON.stringify(by(r, id))}`);
    assert.ok(!levels(r).includes("FAIL"), `${id} must not be a failure: ${JSON.stringify(r.filter((x) => x.level === "FAIL"))}`);
  }
});

test("secret values are never printed: only variable names and verdicts", () => {
  const secret = "SECRET-VALUE-1234567890";
  const r = run({ ...GOOD, OPENAI_API_KEY: secret, ANTHROPIC_API_KEY: "sk-ant-ZZZ-super-secret", AIVEN_PG_URI: "postgres://user:hunter2@db.example.com:1234/x", VITE_X_SECRET: "leaky-value-98765" });
  const text = JSON.stringify(r);
  for (const v of [secret, "sk-ant-ZZZ-super-secret", "hunter2", "leaky-value-98765", key]) assert.ok(!text.includes(v), "the value must not appear: " + v.slice(0, 6));
  assert.ok(text.includes("OPENAI_API_KEY") && text.includes("ANTHROPIC_API_KEY"), "names are listed");
});

test("front door mode checks BACKEND_URL only", () => {
  const f = (v?: string) => runPreflight(v === undefined ? {} : { BACKEND_URL: v }, { frontdoor: true });
  assert.equal(f()[0].level, "FAIL");
  assert.equal(f("http://svc.onrender.com")[0].level, "FAIL");
  assert.equal(f("https://localhost:3000")[0].level, "FAIL");
  assert.equal(f("https://svc.onrender.com/api")[0].level, "WARN");
  assert.equal(f("https://svc.onrender.com")[0].level, "PASS");
  assert.equal(f("https://svc.onrender.com").length, 1);
});

test("CLI: exit 0 for a good environment, 1 for a failure, --strict turns warnings into failures, nothing secret is printed", () => {
  const base = { PATH: process.env.PATH || "", ...GOOD };
  const cli = (env: Record<string, string>, ...a: string[]) => spawnSync(process.execPath, [script, ...a], { env: { ...env, TEMP: FAKE_TMP, TMP: FAKE_TMP, TMPDIR: FAKE_TMP }, encoding: "utf8", cwd: appDir });
  const ok = cli(base);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /0 failure\(s\)/);
  assert.ok(!ok.stdout.includes("SECRET-VALUE-1234567890"));
  assert.equal(cli({ ...base, NODE_ENV: "development" }).status, 1);
  assert.equal(cli({ ...base, TRUST_PROXY_HOPS: "" }).status, 0, "a warning alone passes");
  assert.equal(cli({ ...base, TRUST_PROXY_HOPS: "" }, "--strict").status, 1);
  assert.equal(cli({ PATH: base.PATH, BACKEND_URL: "https://svc.onrender.com" }, "--frontdoor").status, 0);
});

test("provider keys at rest: no vault key in production is a WARN, a wrong-length key is a FAIL (the vault would silently stay off), a 32-byte key passes", () => {
  const { PRIVACY_ENCRYPTION_KEY: _drop, ...noKey } = GOOD;
  const missing = by(run(noKey), "PRIVACY_ENCRYPTION_KEY");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].level, "WARN");
  assert.match(missing[0].message, /UNENCRYPTED/);
  const long = by(run({ ...GOOD, PRIVACY_ENCRYPTION_KEY: Buffer.alloc(48, 7).toString("base64") }), "PRIVACY_ENCRYPTION_KEY");
  assert.equal(long[0].level, "FAIL", "48 bytes used to pass preflight while the vault refused it");
  const short = by(run({ ...GOOD, PRIVACY_ENCRYPTION_KEY: Buffer.alloc(16, 7).toString("base64") }), "PRIVACY_ENCRYPTION_KEY");
  assert.equal(short[0].level, "FAIL");
  assert.equal(by(run(GOOD), "PRIVACY_ENCRYPTION_KEY")[0].level, "PASS");
  assert.equal(by(run({ ...GOOD, PRIVACY_ENCRYPTION_KEY_PREVIOUS: "AAAA" }), "PRIVACY_ENCRYPTION_KEY_PREVIOUS")[0].level, "FAIL");
  assert.equal(by(run({ ...GOOD, PRIVACY_ENCRYPTION_KEY_PREVIOUS: key }), "PRIVACY_ENCRYPTION_KEY_PREVIOUS").length, 0, "a valid previous key is fine");
  // development without a key stays quiet
  const { NODE_ENV: _n, ...dev } = noKey;
  assert.equal(by(run({ ...dev, NODE_ENV: "development" }), "PRIVACY_ENCRYPTION_KEY").length, 0);
});

test("mail settings: unset is a valid choice, half-configured is a failure, complete passes, and no value is ever printed", () => {
  assert.equal(by(run(GOOD), "MAIL_PROVIDER")[0].level, "PASS", "operator-only recovery is not a warning");
  const complete = { ...GOOD, MAIL_PROVIDER: "resend", MAIL_FROM: "Darkness <no-reply@example.com>", PUBLIC_APP_URL: "https://app.example.com", RESEND_API_KEY: "re_SECRET_VALUE_123456" };
  assert.equal(by(run(complete), "MAIL_*")[0].level, "PASS");
  assert.ok(!JSON.stringify(run(complete)).includes("re_SECRET"), "the key is never printed");
  const noKeyResend = by(run({ ...complete, RESEND_API_KEY: "" }), "MAIL_*")[0];
  assert.equal(noKeyResend.level, "FAIL"); assert.match(noKeyResend.message, /RESEND_API_KEY is required/);
  assert.match(by(run({ ...complete, PUBLIC_APP_URL: "http://app.example.com" }), "MAIL_*")[0].message, /https in production/);
  assert.equal(by(run({ ...complete, MAIL_PROVIDER: "pigeon" }), "MAIL_*")[0].level, "FAIL");
  const smtp = { ...GOOD, MAIL_PROVIDER: "smtp", MAIL_FROM: "no-reply@example.com", PUBLIC_APP_URL: "https://app.example.com", SMTP_HOST: "mail.example.com" };
  assert.equal(by(run(smtp), "MAIL_*")[0].level, "PASS");
  assert.match(by(run({ ...smtp, SMTP_USER: "u" }), "MAIL_*")[0].message, /together/);
  assert.match(by(run({ ...smtp, SMTP_TLS: "none" }), "MAIL_*")[0].message, /localhost/);
});
