#!/usr/bin/env node
/**
 * package-lock.json must list the native binaries of EVERY platform, not only the one it was last generated on.
 *
 * Why: esbuild, rollup, sharp, @napi-rs/canvas and @resvg/resvg-js ship one optional package per OS/CPU. If the lockfile only knows
 * the Linux ones (it was produced on Linux by an npm that skips the other platforms - npm/cli#4828), `npm ci` on Windows or macOS
 * installs no binary at all and `npm run build` dies with "Cannot find module @rollup/rollup-win32-x64-msvc".
 *
 *   node scripts/lockfile-platforms.mjs --check   exit 1 and list what is missing (no network; used by CI and tests)
 *   node scripts/lockfile-platforms.mjs --fix     add the missing entries, using the EXACT versions the parent packages ask for
 *                                                 (needs the npm registry; changes nothing else in the lockfile)
 *
 * Run --fix again after any dependency change that touches one of those packages, then `npm ci` to confirm.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = process.env.LOCKFILE || path.join(root, "package-lock.json");

/** The node_modules directories a package at `p` resolves from, nearest first (the way Node walks up). */
function moduleDirs(p) {
  const dirs = [];
  let s = p;
  while (s) {
    const i = s.lastIndexOf("node_modules/");
    if (i < 0) break;
    dirs.push(s.slice(0, i + "node_modules/".length));
    s = s.slice(0, Math.max(0, i - 1));
  }
  return dirs;
}

/**
 * Optional dependencies a package declares that the lockfile does not contain at the version it asks for.
 * @returns {Record<string, {name: string, version: string, wantedBy: string}>} keyed by the lockfile path the entry belongs at
 */
export function findMissing(lock) {
  const pk = lock.packages || {};
  const missing = {};
  for (const [p, e] of Object.entries(pk)) {
    if (!e.optionalDependencies) continue;
    const dirs = moduleDirs(p);
    for (const [name, spec] of Object.entries(e.optionalDependencies)) {
      const want = String(spec).replace(/^[\^~=v]/, "");
      const exact = /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(String(spec)); // native packages are pinned exactly; ranges (fsevents ~2.3.3) are npm's to resolve
      const candidates = [p + "/node_modules/" + name, ...dirs.map((d) => d + name)];
      const found = candidates.find((c) => pk[c]);
      if (found && (!exact || pk[found].version === want)) continue;
      // Not there, or only another version is (e.g. vite's own esbuild 0.25 next to the project's 0.28): it belongs beside the package.
      const at = (dirs[0] || "node_modules/") + name;
      missing[at] = { name, version: want, wantedBy: p };
    }
  }
  return missing;
}

/** The platforms the project is developed and deployed on; the check insists these are present. */
export const REQUIRED = [
  "@esbuild/linux-x64", "@esbuild/win32-x64", "@esbuild/darwin-arm64", "@esbuild/darwin-x64",
  "@rollup/rollup-linux-x64-gnu", "@rollup/rollup-win32-x64-msvc", "@rollup/rollup-darwin-arm64", "@rollup/rollup-darwin-x64",
  "@napi-rs/canvas-linux-x64-gnu", "@napi-rs/canvas-win32-x64-msvc", "@napi-rs/canvas-darwin-arm64",
  "@resvg/resvg-js-linux-x64-gnu", "@resvg/resvg-js-win32-x64-msvc", "@resvg/resvg-js-darwin-arm64",
];

async function manifest(name, version) {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2f")}/${version}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" } });
      if (r.ok) return await r.json();
      if (r.status === 404) throw new Error(`${name}@${version} does not exist on the registry`);
    } catch (e) {
      if (attempt === 4 || /does not exist/.test(String(e.message))) throw e;
    }
    await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  throw new Error(`could not fetch ${name}@${version}`);
}

async function fix() {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const missing = findMissing(lock);
  const paths = Object.keys(missing);
  if (!paths.length) return console.log("package-lock.json already lists every optional platform package");
  console.log(`adding ${paths.length} optional platform packages (no existing entry is changed)`);
  const metas = {};
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < paths.length) {
      const at = paths[next++];
      metas[at] = await manifest(missing[at].name, missing[at].version);
    }
  }));
  for (const at of paths) {
    const m = metas[at];
    // dev follows the package that wants it (a dev-only parent gives a dev-only child). Key order and fields mirror what npm writes.
    const parent = lock.packages[missing[at].wantedBy] || {};
    const entry = { version: m.version, resolved: m.dist.tarball, integrity: m.dist.integrity };
    if (m.cpu) entry.cpu = m.cpu;
    if (parent.dev) entry.dev = true;
    if (m.license) entry.license = typeof m.license === "string" ? m.license : m.license.type;
    entry.optional = true;
    if (m.os) entry.os = m.os;
    if (m.engines) entry.engines = m.engines;
    lock.packages[at] = entry;
  }
  // npm keeps "packages" sorted by key (the root "" first)
  const sorted = Object.fromEntries(Object.entries(lock.packages).sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, "en"))));
  lock.packages = sorted;
  const raw = fs.readFileSync(lockPath, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n"; // npm keeps the file's own line endings (this repo's lockfile is CRLF)
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2).replace(/\n/g, eol) + (raw.endsWith("\n") ? eol : ""));
  console.log("done. Now run: npm install --package-lock-only (must report no change) and npm ci in a clean folder.");
}

function check() {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const missing = findMissing(lock);
  const names = Object.values(missing).map((m) => m.name);
  const required = REQUIRED.filter((n) => !lock.packages["node_modules/" + n]);
  if (!names.length && !required.length) {
    console.log("lockfile platforms: ok (every optional native package is listed)");
    return;
  }
  console.error(`package-lock.json is missing ${names.length} optional platform package(s)` + (required.length ? `, including required: ${required.join(", ")}` : ""));
  console.error("e.g. " + names.slice(0, 5).join(", ") + ". On Windows/macOS `npm ci` would then install no esbuild/rollup binary and the build would fail.");
  console.error("Fix: node scripts/lockfile-platforms.mjs --fix");
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === "--fix") await fix();
  else if (mode === "--check") check();
  else {
    console.error("usage: node scripts/lockfile-platforms.mjs --check | --fix");
    process.exitCode = 2;
  }
}
