import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const { runPreflight } = await import("../scripts/preflight.mjs");

/** Minimal reader for render.yaml's `envVars:` list: { key -> value | undefined (sync: false) }. */
function renderEnv(): Record<string, string | undefined> {
  const lines = read("render.yaml").split(/\r?\n/);
  const env: Record<string, string | undefined> = {};
  for (let i = 0; i < lines.length; i++) {
    const k = /^\s*- key:\s*(\S+)/.exec(lines[i]);
    if (!k) continue;
    const next = lines[i + 1] || "";
    const v = /^\s*value:\s*("?)([^#"]*?)\1\s*(#.*)?$/.exec(next);
    env[k[1]] = v ? v[2].trim() : undefined;
  }
  return env;
}

test("render.yaml: the environment it sets passes the production preflight (secrets aside)", () => {
  const set = Object.fromEntries(Object.entries(renderEnv()).filter(([, v]) => v !== undefined)) as Record<string, string>;
  assert.equal(set.NODE_ENV, "production");
  assert.equal(set.PRIVACY_STRICT, "true");
  assert.equal(set.PRIVACY_CSP, "enforce");
  assert.equal(set.TRUST_PROXY_HOPS, "2", "Render's proxy + Vercel's proxy");
  // /var/data is the mounted disk on Render; use a real writable folder here so the rest of the checks can run
  const fake = path.resolve(root, "node_modules", ".preflight-test-disk");
  fs.mkdirSync(fake, { recursive: true });
  const r = runPreflight({ ...set, DARKNESS_STORAGE_ROOT: fake, GEMINI_API_KEY: "present" }, { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "pf-")), tmpdir: path.join(path.parse(process.cwd()).root, "preflight-fake-temp") });
  assert.deepEqual(r.filter((x) => x.level === "FAIL"), []);
});

test("render.yaml: data lives on the mounted disk, health is the readiness probe, secrets are never in the file", () => {
  const y = read("render.yaml");
  const env = renderEnv();
  const mount = /mountPath:\s*(\S+)/.exec(y)![1];
  assert.equal(env.DARKNESS_STORAGE_ROOT, mount, "DARKNESS_STORAGE_ROOT is the disk's mount path, so data survives deploys");
  assert.match(y, /healthCheckPath:\s*\/api\/ready/);
  assert.match(y, /^\s*disk:/m);
  for (const secret of ["PRIVACY_ENCRYPTION_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "AIVEN_PG_URI", "AIVEN_CA_CERT", "CORS_ORIGINS"]) {
    assert.ok(secret in env, secret + " is declared");
    assert.equal(env[secret], undefined, secret + " is `sync: false`: entered in the dashboard, never stored in git");
  }
  assert.match(y, /buildCommand:.*npm ci/, "reproducible install from the lockfile");
});

test("the readiness route Render probes exists and the liveness alias is served", () => {
  const server = read("server/observability/health.ts") + read("server/server.ts");
  assert.ok(/\/api\/ready/.test(server) && /\/api\/health/.test(server));
});

test("vercel.json: the proxy rewrites cover the API and the original app's API, in that order, and API responses are never cached", () => {
  const cfg = JSON.parse(read("vercel.json"));
  assert.deepEqual(cfg.rewrites.map((r: any) => r.source), ["/classic-api/:path*", "/api/:path*"], "the more specific prefix is first");
  for (const r of cfg.rewrites) assert.match(r.destination, /^\/api\/proxy\?/);
  const noStore = cfg.headers.find((h: any) => /api/.test(h.source));
  assert.ok(noStore.headers.some((h: any) => h.key === "Cache-Control" && /no-store/.test(h.value)));
  assert.equal(cfg.outputDirectory, "dist");
  assert.ok(fs.existsSync(path.join(root, "api", "proxy.js")));
});

test("Dockerfile and compose: pinned Node 22, non-root, strict by default, data on a volume, bound to localhost, least privilege", () => {
  const d = read("Dockerfile");
  assert.match(d, /FROM node:22[\w.-]* AS build/);
  assert.match(d, /FROM node:22[\w.-]* AS runtime/);
  assert.match(d, /^USER node$/m);
  assert.match(d, /PRIVACY_STRICT=true/);
  assert.match(d, /DARKNESS_STORAGE_ROOT=\/data/);
  assert.match(d, /VOLUME \["\/data"\]/);
  assert.match(d, /HEALTHCHECK[\s\S]*\/api\/health/);
  assert.match(d, /scripts\/preflight\.mjs[\s\S]*scripts\/backup\.mjs/, "the operator tools ship in the image");
  assert.match(d, /npm prune --omit=dev/);
  const c = read("docker-compose.yml");
  assert.match(c, /127\.0\.0\.1:\$\{HOST_PORT:-3000\}:3000/, "never published on all interfaces");
  assert.match(c, /darkness-data:\/data/);
  assert.match(c, /no-new-privileges:true/);
  assert.match(c, /cap_drop:\s*\n\s*- ALL/);
  assert.match(c, /NODE_ENV: production/);
  const ignore = read(".dockerignore");
  for (const s of [".env", "*.pem", "*.key", "node_modules", "data", ".git"]) assert.ok(ignore.split(/\r?\n/).includes(s), ".dockerignore excludes " + s);
});

test("the reverse-proxy example accepts the largest upload and streams (Caddy)", () => {
  const caddy = read("deploy/server/Caddyfile.example");
  const max = Number(/max_size\s+(\d+)MB/.exec(caddy)![1]);
  const appMax = Number(/MAX_UPLOAD_SIZE_MB\s*=\s*(\d+)/.exec(read("server/upload-config.ts"))![1]);
  assert.ok(max > appMax, `proxy limit ${max} MB must exceed the app's ${appMax} MB upload limit`);
  assert.match(caddy, /flush_interval\s+-1/);
  assert.match(caddy, /X-Forwarded-Proto/);
});

test("uploads are sent in pieces the hosted front door accepts (Vercel rejects request bodies over ~4.5 MB)", () => {
  const ui = read("web/js/lib/zip-upload.js"); // the upload pipeline (its behaviour is tested in tests/zip-upload.test.ts)
  const direct = Number(/DIRECT_ZIP_MAX_BYTES\s*=\s*([\d.]+)\s*\*\s*1024\s*\*\s*1024/.exec(ui)![1]);
  const chunk = Number(/CHUNK_BYTES\s*=\s*([\d.]+)\s*\*\s*1024\s*\*\s*1024/.exec(ui)![1]);
  assert.ok(direct <= 4 && chunk <= 3.5, `direct ${direct} MB / chunk ${chunk} MB must stay under 4.5 MB with multipart overhead`);
  const maxChunks = Number(/MAX_CHUNKS\s*=\s*(\d+)/.exec(read("server/upload-chunks.ts"))![1]);
  const appMax = Number(/MAX_UPLOAD_SIZE_MB\s*=\s*(\d+)/.exec(read("server/upload-config.ts"))![1]);
  assert.ok(maxChunks * chunk >= appMax, `${maxChunks} parts of ${chunk} MB must cover the ${appMax} MB limit`);
});

test(".env.example documents every variable render.yaml sets", () => {
  const example = read(".env.example");
  for (const k of Object.keys(renderEnv())) {
    if (["NODE_VERSION", "PUPPETEER_SKIP_DOWNLOAD"].includes(k)) continue; // platform build settings, not app configuration
    assert.ok(new RegExp(`^#?[ \\t]*${k}=`, "m").test(example), k + " is documented in .env.example (as a real or commented-out line)");
  }
});
