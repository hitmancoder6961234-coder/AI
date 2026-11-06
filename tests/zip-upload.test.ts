import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

// The browser module runs here with a fake window, fetch and XMLHttpRequest, so what it SENDS is checked, not just what the source says.
const g = globalThis as any;
const { uploadZipInChunks } = await import("../web/js/lib/zip-upload.js");
const MB = 1024 * 1024;

type Sent = { url: string; fields: Record<string, string>; fileBytes: number; credentials?: string; headers?: Record<string, string> };
let sent: Sent[] = [];
let xhrSent: Array<{ url: string; method: string; withCredentials: boolean; headers: Record<string, string>; bytes: number }> = [];
let realFetch: typeof fetch;
let respond: (call: Sent, n: number) => { status: number; body: string } = () => ({ status: 200, body: JSON.stringify({ success: true, project: { id: "p1" } }) });

class FakeXhr {
  listeners: Record<string, Array<(e?: any) => void>> = {};
  upload = { addEventListener: (_: string, __: (e?: any) => void) => {} };
  status = 0; responseText = ""; withCredentials = false;
  private m = ""; private u = ""; private h: Record<string, string> = {};
  addEventListener(ev: string, fn: (e?: any) => void) { (this.listeners[ev] ||= []).push(fn); }
  open(method: string, url: string) { this.m = method; this.u = url; }
  setRequestHeader(k: string, v: string) { this.h[k] = v; }
  send(fd: FormData) {
    const file = fd.get("file") as Blob;
    xhrSent.push({ url: this.u, method: this.m, withCredentials: this.withCredentials, headers: this.h, bytes: file.size });
    const r = respond({ url: this.u, fields: {}, fileBytes: file.size }, xhrSent.length);
    this.status = r.status; this.responseText = r.body;
    queueMicrotask(() => (this.listeners.load || []).forEach((f) => f()));
  }
}

beforeEach(() => {
  sent = []; xhrSent = [];
  g.window = { Darkness: { api: { _url: (p: string) => "https://front.example" + p, _getAuthHeaders: () => ({ "x-test-auth": "1" }) } } };
  g.XMLHttpRequest = FakeXhr;
  realFetch = g.fetch;
  g.fetch = async (url: string, init: any) => {
    const fd = init.body as FormData;
    const file = fd.get("file") as Blob;
    const fields: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k !== "file") fields[k] = String(v);
    const call: Sent = { url, fields, fileBytes: file.size, credentials: init.credentials, headers: init.headers };
    sent.push(call);
    const r = respond(call, sent.length);
    return new Response(r.body, { status: r.status });
  };
});
afterEach(() => { g.fetch = realFetch; delete g.window; delete g.XMLHttpRequest; });

const zip = (bytes: number) => new File([new Uint8Array(bytes)], "app.zip", { type: "application/zip" });

test("a large archive goes up in parts that all fit under the hosted front door's ~4.5 MB request cap", async () => {
  const progress: number[] = [];
  const out = await uploadZipInChunks(zip(10 * MB + 123), null, (pct: number) => progress.push(pct));
  assert.equal(sent.length, 4, "10 MB / 3 MB parts = 4 requests");
  assert.deepEqual(sent.map((s) => s.fileBytes), [3 * MB, 3 * MB, 3 * MB, MB + 123]);
  assert.ok(sent.every((s) => s.fileBytes <= 3 * MB), "no part over 3 MB (multipart overhead included stays far below 4.5 MB)");
  assert.deepEqual(sent.map((s) => s.fields.chunkIndex), ["0", "1", "2", "3"]);
  assert.ok(sent.every((s) => s.fields.totalChunks === "4"));
  assert.equal(new Set(sent.map((s) => s.fields.uploadId)).size, 1, "one upload id across all parts");
  assert.match(sent[0].fields.uploadId, /^up_\d+_[a-z0-9]+$/);
  assert.equal(sent[0].fields.name, "app", "a new project is named after the file");
  assert.ok(sent.every((s) => s.url === "https://front.example/api/projects/upload-zip/chunk" && s.credentials === "include" && s.headers!["x-test-auth"] === "1"), "cookie + auth headers on every part");
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b), "progress never goes backwards");
  assert.equal(out.project.id, "p1");
});

test("merging into an existing project sends its id instead of a name", async () => {
  await uploadZipInChunks(zip(4 * MB), "proj-42", () => {});
  assert.ok(sent.every((s) => s.fields.projectId === "proj-42" && !("name" in s.fields)));
});

test("a small archive is one request (3.5 MB or less), never split", async () => {
  await uploadZipInChunks(zip(3 * MB), null, () => {});
  assert.equal(sent.length, 0, "no chunk requests");
  assert.equal(xhrSent.length, 1);
  assert.ok(xhrSent[0].url.endsWith("/api/projects/upload-zip") && xhrSent[0].withCredentials && xhrSent[0].headers["x-test-auth"] === "1");
  await uploadZipInChunks(zip(3.5 * MB), null, () => {});
  assert.equal(xhrSent.length, 2, "exactly at the limit is still one request");
  await uploadZipInChunks(zip(3.5 * MB + 1), null, () => {});
  assert.ok(sent.length >= 2, "one byte over the limit switches to parts");
});

test("a ZIP over 100 MB is refused before anything is sent", async () => {
  await assert.rejects(uploadZipInChunks({ size: 101 * MB, name: "x.zip", slice: () => new Blob([]) }, null, () => {}), /too large.*100 MB/i);
  assert.equal(sent.length + xhrSent.length, 0);
});

test("Vercel's bare 413 page becomes a clear message, our own JSON errors are passed through untouched", async () => {
  respond = () => ({ status: 413, body: "Request Entity Too Large\nFUNCTION_PAYLOAD_TOO_LARGE" });
  await assert.rejects(uploadZipInChunks(zip(8 * MB), null, () => {}), /hosting front door.*4 MB/i);
  respond = () => ({ status: 413, body: JSON.stringify({ error: "File too large (limit 100 MB)" }) });
  await assert.rejects(uploadZipInChunks(zip(8 * MB), null, () => {}), /File too large \(limit 100 MB\)/);
  respond = () => ({ status: 415, body: JSON.stringify({ error: "Not a ZIP file" }) });
  await assert.rejects(uploadZipInChunks(zip(8 * MB), null, () => {}), /Not a ZIP file/);
  // the same for the single-request path
  respond = () => ({ status: 413, body: "Payload Too Large" });
  await assert.rejects(uploadZipInChunks(zip(1 * MB), null, () => {}), /hosting front door/i);
  respond = () => ({ status: 200, body: JSON.stringify({ success: true, project: { id: "p1" } }) });
});

test("a dropped connection is retried (3 attempts per part) and then reported", async () => {
  let calls = 0;
  g.fetch = async () => { calls++; throw new Error("socket hang up"); };
  await assert.rejects(uploadZipInChunks(zip(5 * MB), null, () => {}), /Network connection error: socket hang up/);
  assert.equal(calls, 3, "three attempts on the first part, then it gives up");
  // a hiccup that clears on the second try completes normally
  let n = 0;
  g.fetch = async () => { if (n++ === 0) throw new Error("blip"); return new Response(JSON.stringify({ success: true, project: { id: "ok" } }), { status: 200 }); };
  const out = await uploadZipInChunks(zip(5 * MB), null, () => {});
  assert.equal(out.project.id, "ok");
});
