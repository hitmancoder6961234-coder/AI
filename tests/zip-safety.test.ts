import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import AdmZip from "adm-zip";

process.env.DARKNESS_STORAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "darkness-zip-test-"));

const { extractZipSecurely } = await import("../server/project-analyzer.js");

function zipOf(entries: Record<string, string | Buffer>): Buffer {
  const z = new AdmZip();
  for (const [name, body] of Object.entries(entries)) z.addFile(name, Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8"));
  return z.toBuffer();
}

test("a normal project zip extracts, and a single top-level folder is flattened", () => {
  const r = extractZipSecurely(zipOf({ "proj/src/app.js": "console.log(1)", "proj/README.md": "# hi" }));
  assert.equal(r.error, undefined);
  assert.deepEqual(r.files.map((f) => f.path).sort(), ["README.md", "src/app.js"]);
});

test("path traversal, absolute and drive-letter entries are skipped, never returned", () => {
  const z = new AdmZip();
  z.addFile("ok/a.txt", Buffer.from("a"));
  z.addFile("../evil.txt", Buffer.from("x"));
  z.addFile("ok/../../evil2.txt", Buffer.from("x"));
  z.addFile("/abs/evil3.txt", Buffer.from("x"));
  z.addFile("C:\\Windows\\evil4.txt", Buffer.from("x"));
  const r = extractZipSecurely(z.toBuffer());
  const paths = r.files.map((f) => f.path);
  assert.ok(paths.includes("ok/a.txt"), paths.join("|"));
  // The zip library already neutralises "../" and leading "/" (they come back as plain relative names); the guarantee we
  // care about is that NOTHING returned can point outside the project.
  for (const p of paths) {
    assert.ok(!p.split("/").includes(".."), "no parent segment: " + p);
    assert.ok(!p.startsWith("/") && !/^[a-zA-Z]:/.test(p) && !p.includes("\\") && !p.includes("\0"), "plain relative path: " + p);
  }
});

test("junk and dependency folders are skipped without being decompressed", () => {
  const r = extractZipSecurely(zipOf({ "p/src/a.js": "1", "p/node_modules/x/index.js": "2", "__MACOSX/p/._a.js": "3", "p/.git/config": "4" }));
  assert.deepEqual(r.files.map((f) => f.path), ["src/a.js"]);
});

test("something that is not a zip is refused by its content, whatever it is called", () => {
  for (const body of [Buffer.from("just text, not an archive"), Buffer.from("<html></html>"), Buffer.alloc(2)]) {
    const r = extractZipSecurely(body);
    assert.equal(r.files.length, 0);
    assert.match(r.error || "", /not a valid ZIP/);
  }
});

test("an archive with too many entries is refused", () => {
  const entries: Record<string, string> = {};
  for (let i = 0; i < 60; i++) entries[`f${i}.txt`] = "x";
  const r = extractZipSecurely(zipOf(entries), { maxEntries: 50 });
  assert.equal(r.files.length, 0);
  assert.match(r.error || "", /too many entries/);
  assert.equal(extractZipSecurely(zipOf(entries), { maxEntries: 100 }).error, undefined, "under the limit it extracts");
});

test("a zip bomb is rejected from its headers, before anything is decompressed", () => {
  // 40 entries of 100 KB of zeros: tiny on disk, 4 MB when expanded. With a 1 MB limit it must be refused up front.
  const entries: Record<string, Buffer> = {};
  for (let i = 0; i < 40; i++) entries[`bomb/${i}.txt`] = Buffer.alloc(100 * 1024, 0x30);
  const buf = zipOf(entries);
  assert.ok(buf.length < 100 * 1024, `the archive itself is small (${buf.length} bytes)`);

  // prove "before decompressing": any attempt to inflate an entry would throw here
  const original = (AdmZip as any).prototype.getEntries;
  let inflated = 0;
  (AdmZip as any).prototype.getEntries = function (...a: unknown[]) {
    const list = original.apply(this, a);
    for (const e of list) { const g = e.getData.bind(e); e.getData = (...x: unknown[]) => { inflated++; return g(...x); }; }
    return list;
  };
  try {
    const r = extractZipSecurely(buf, { maxTotalBytes: 1024 * 1024 });
    assert.equal(r.files.length, 0);
    assert.match(r.error || "", /FILE_TOO_LARGE/);
    assert.equal(inflated, 0, "no entry was decompressed");
  } finally {
    (AdmZip as any).prototype.getEntries = original;
  }
});

test("a lying header cannot sneak a large entry past the running total", () => {
  // honest archive, but the limit is lower than the real expanded size: the running total after inflating also stops it
  const r = extractZipSecurely(zipOf({ "a.txt": Buffer.alloc(600 * 1024, 0x61), "b.txt": Buffer.alloc(600 * 1024, 0x62) }), { maxTotalBytes: 1000 * 1024 });
  assert.equal(r.files.length, 0);
  assert.match(r.error || "", /FILE_TOO_LARGE/);
});

test("an archive with an extreme compression ratio is refused before decompressing, while ordinary ones pass", () => {
  // 30 entries of 200 KB of one repeated byte: a few KB compressed, 6 MB expanded (ratio in the thousands).
  const bomb: Record<string, Buffer> = {};
  for (let i = 0; i < 30; i++) bomb[`b/${i}.txt`] = Buffer.alloc(200 * 1024, 0x41);
  const r = extractZipSecurely(zipOf(bomb), { minBytesForRatioCheck: 1024 * 1024, maxCompressionRatio: 100 });
  assert.equal(r.files.length, 0);
  assert.match(r.error || "", /compression ratio/);

  // varied text compresses a few times over: far below the limit, so it extracts normally
  const normal: Record<string, string> = {};
  for (let i = 0; i < 20; i++) normal[`n/${i}.txt`] = Array.from({ length: 4000 }, (_, k) => `line ${i}-${k} ${(k * 2654435761 % 997).toString(36)}`).join("\n");
  const ok = extractZipSecurely(zipOf(normal), { minBytesForRatioCheck: 1024 * 1024, maxCompressionRatio: 100 });
  assert.equal(ok.error, undefined);
  assert.equal(ok.files.length, 20);

  // below the size floor the ratio is not judged (tiny archives can legitimately be extremely compressible)
  assert.equal(extractZipSecurely(zipOf({ "z.txt": Buffer.alloc(300 * 1024, 0x20) })).error, undefined);
});
