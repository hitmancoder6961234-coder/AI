import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const { findMissing, REQUIRED } = await import("../scripts/lockfile-platforms.mjs");

// ------------------------------------------------------------------------------------------------ lockfile platforms

test("findMissing: a package that declares platform binaries the lockfile lacks is reported, at the right place", () => {
  const lock = {
    packages: {
      "": {},
      "node_modules/esbuild": { version: "0.28.2", optionalDependencies: { "@esbuild/linux-x64": "0.28.2", "@esbuild/win32-x64": "0.28.2" } },
      "node_modules/@esbuild/linux-x64": { version: "0.28.2" },
      // vite carries its own, older esbuild: the hoisted binaries are the wrong version for it
      "node_modules/vite/node_modules/esbuild": { version: "0.25.12", optionalDependencies: { "@esbuild/linux-x64": "0.25.12" } },
      // a range is npm's to resolve, never "missing" when something is there
      "node_modules/rollup": { version: "4.0.0", optionalDependencies: { fsevents: "~2.3.2" } },
      "node_modules/fsevents": { version: "2.3.3" },
    },
  };
  const m = findMissing(lock);
  assert.deepEqual(Object.keys(m).sort(), ["node_modules/@esbuild/win32-x64", "node_modules/vite/node_modules/@esbuild/linux-x64"]);
  assert.equal(m["node_modules/vite/node_modules/@esbuild/linux-x64"].version, "0.25.12");
  assert.deepEqual(findMissing({ packages: { "": {}, "node_modules/a": { version: "1.0.0" } } }), {});
});

test("the real package-lock.json lists every optional native package (Windows and macOS `npm ci` install real binaries)", () => {
  const lock = JSON.parse(read("package-lock.json"));
  assert.deepEqual(Object.keys(findMissing(lock)), [], "run: node scripts/lockfile-platforms.mjs --fix");
  for (const name of REQUIRED) assert.ok(lock.packages["node_modules/" + name], name + " is in the lockfile");
  const win = lock.packages["node_modules/@esbuild/win32-x64"];
  assert.deepEqual(win.os, ["win32"]);
  assert.equal(win.optional, true);
  assert.match(win.integrity, /^sha512-/);
  assert.match(win.resolved, /^https:\/\/registry\.npmjs\.org\//);
});

test("the lockfile check script exits 0 on this repo and 1 on a lockfile that only knows Linux", () => {
  const run = (env: Record<string, string> = {}) => spawnSync(process.execPath, ["scripts/lockfile-platforms.mjs", "--check"], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
  assert.equal(run().status, 0);
  const tmp = path.join(fs.mkdtempSync(path.join(import.meta.dirname, "..", "node_modules", ".lockfile-test-")), "package-lock.json");
  try {
    fs.writeFileSync(tmp, JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/esbuild": { version: "0.28.2", optionalDependencies: { "@esbuild/linux-x64": "0.28.2", "@esbuild/win32-x64": "0.28.2" } }, "node_modules/@esbuild/linux-x64": { version: "0.28.2" } } }));
    const bad = run({ LOCKFILE: tmp });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /missing 1 optional platform package/);
    assert.match(bad.stderr, /--fix/);
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------------------------------------ the CI definition cannot be weakened silently

const workflowRaw = read(".github/workflows/darkness-ai-ci.yml");
// only the active configuration: comments may talk about continue-on-error
const workflow = workflowRaw.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s+#.*$/, "")).join("\n");

test("CI: no step is allowed to fail silently", () => {
  assert.ok(!/continue-on-error/.test(workflow), "no continue-on-error anywhere");
  // `|| true` is allowed only on the informational "show every advisory" listing
  const hushed = workflow.split("\n").filter((l) => /\|\|\s*true/.test(l));
  assert.deepEqual(hushed.map((l) => l.trim()), ["run: npm audit || true"]);
});

test("CI: every required gate is a step, in a job that runs on pull requests", () => {
  for (const cmd of ["npm ci", "npm run check:lockfile", "npm run lint:ci", "npm run typecheck", "npm test", "npm run build", "npm run smoke", "npm audit --omit=dev --audit-level=low", "npm audit --audit-level=high", "npm audit signatures", "gitleaks/gitleaks-action@v2"]) {
    assert.ok(workflow.includes(cmd), "CI runs: " + cmd);
  }
  assert.match(workflow, /\n {2}pull_request:/);
});

test("CI: both supported Node majors, and Windows and macOS, are exercised", () => {
  assert.match(workflow, /node:\s*\[22,\s*24\]/);
  assert.match(workflow, /os:\s*\[windows-latest,\s*macos-latest\]/);
  const engines = JSON.parse(read("package.json")).engines.node as string;
  assert.match(engines, /^>=22\./, "the engines floor is Node 22: matrix entries must not go below it");
});

test("CI: least privilege, and nothing is installed or published with write access", () => {
  assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/);
  assert.ok(!/contents:\s*write|packages:\s*write|id-token:\s*write/.test(workflow));
});

test("the npm scripts CI calls exist, and the lint ratchet matches the repo's own warning count", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const s of ["lint:ci", "typecheck", "check:lockfile", "test", "build", "smoke", "verify"]) assert.ok(pkg.scripts[s], "npm run " + s);
  assert.match(pkg.scripts["lint:ci"], /--max-warnings \d+/);
  assert.match(pkg.scripts.typecheck, /tsc --noEmit/);
});

test("the type check has no known-error baseline any more: tsconfig covers the server and tests and excludes nothing of ours", () => {
  const raw = read("tsconfig.json").replace(/^\s*\/\/.*$/gm, "");
  const cfg = JSON.parse(raw);
  assert.deepEqual(cfg.include, ["server/**/*.ts", "tests/**/*.ts"]);
  assert.deepEqual(cfg.exclude.filter((e: string) => e !== "node_modules" && e !== "dist"), []);
});

// ------------------------------------------------------------------------------------------------ secrets

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b|github_pat_[0-9A-Za-z_]{40,}/],
  ["Slack token", /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9]{32,}\b/],
  ["Stripe live key", /\bsk_live_[0-9a-zA-Z]{20,}\b/],
  ["a password that was once shared in chat", /Khan@1(?:2)3/], // written so this line does not match itself
];
const ALLOWED_FAKES = ["AIzaSyFAKE-KEY-for-tests-0123456789abcdef", "sk-abcdefghijklmnopqrstuvwxyz0123456789", "sk-foreign-123456789012", "stub-secret-key-123456", "sk-test-SECRET-KEY-1234567890abcdef"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? dir + "/" + e.name : e.name;
    if (e.isDirectory()) {
      if (!["node_modules", "dist", ".git", "vendor", "download", "site", "legacy"].includes(e.name)) sourceFiles(rel, out);
    } else if (!/\.(png|jpe?g|gif|ico|woff2?|ttf|zip|pdf|map|lock)$/i.test(e.name) && e.name !== "package-lock.json") out.push(rel);
  }
  return out;
}

test("no credential-shaped string is committed anywhere in the sources (the log-redaction fixtures are the only, exact exceptions)", () => {
  const hits: string[] = [];
  for (const f of sourceFiles("")) {
    if (f.startsWith("web/public/vendor/")) continue;
    let text: string;
    try { text = fs.readFileSync(path.join(root, f), "utf8"); } catch { continue; }
    if (text.length > 2_000_000) continue;
    for (const [label, re] of SECRET_PATTERNS) {
      const m = text.match(new RegExp(re.source, "g"));
      for (const hit of m || []) if (!ALLOWED_FAKES.includes(hit)) hits.push(`${f}: ${label}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("the gitleaks allowlist is exact, minimal and not stale", () => {
  const toml = read(".gitleaks.toml");
  assert.match(toml, /useDefault\s*=\s*true/, "the built-in rules stay on");
  assert.ok(!/^\s*paths\s*=/m.test(toml), "no path-wide exemption (a real secret in tests/ must still be caught)");
  const listed = [...toml.matchAll(/'''([^']+)'''/g)].map((m) => m[1]);
  assert.deepEqual(listed.sort(), [...ALLOWED_FAKES].sort());
  const corpus = [...sourceFiles("tests"), "scripts/smoke.mjs"].map((f) => read(f)).join("\n"); // the smoke test is a script, not a tests/ file
  for (const fake of listed) assert.ok(corpus.includes(fake), "allowlisted string is still used by a test: " + fake);
  assert.ok(read(".env.example").split("\n").every((l) => !/^[A-Z_]*(KEY|SECRET|PASSWORD|TOKEN)[A-Z_]*=[^\s#]{8,}/.test(l)), ".env.example holds placeholders only");
  const gi = read(".gitignore");
  assert.ok(/^\.env$/m.test(gi) && /^\*\.pem$/m.test(gi) && /^\*\.key$/m.test(gi), "real env files and keys are git-ignored");
});
