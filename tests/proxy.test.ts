import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before } from "node:test";
import type { AddressInfo } from "node:net";

// api/proxy.js is a Vercel Edge function. Run its routing logic against a fake backend.
let backend: http.Server;
let port = 0;
const realFetch = globalThis.fetch;
let handler: (req: Request) => Promise<Response>;

before(async () => {
  backend = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.setHeader("set-cookie", "darkness_session=abc; Path=/; HttpOnly");
      res.end(JSON.stringify({ url: req.url, method: req.method, body, proto: req.headers["x-forwarded-proto"], host: req.headers["x-forwarded-host"], ip: req.headers["x-forwarded-for"] }));
    });
  });
  await new Promise<void>((r) => backend.listen(0, "127.0.0.1", r));
  port = (backend.address() as AddressInfo).port;
  process.env.BACKEND_URL = `https://127.0.0.1:${port}`; // the proxy insists on https; the test fetch below speaks http
  globalThis.fetch = ((u: any, init?: any) => realFetch(String(u).replace(/^https:/, "http:"), init)) as typeof fetch;
  handler = (await import("../api/proxy.js")).default;
});

after(() => {
  globalThis.fetch = realFetch;
  backend.close();
});

const call = async (url: string, init?: RequestInit) => {
  const r = await handler(new Request(url, init));
  return { status: r.status, headers: r.headers, json: r.status === 200 ? JSON.parse(await r.text()) : JSON.parse(await r.text()) };
};

test("proxy: /api/* is forwarded with the path, query and forwarding headers intact", async () => {
  const r = await call("https://app.vercel.app/api/proxy?path=documents/formats&x=1", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.url, "/api/documents/formats?x=1");
  assert.equal(r.json.proto, "https");
  assert.equal(r.json.host, "app.vercel.app");
  assert.equal(r.json.ip, "203.0.113.9");
  assert.match(r.headers.get("set-cookie") || "", /darkness_session=abc/, "cookies pass through");
});

test("proxy: the original app's /classic-api/* is forwarded to /classic-api on the backend", async () => {
  const r = await call("https://app.vercel.app/api/proxy?scope=classic&path=api/chat", { method: "POST", body: '{"a":1}', headers: { "content-type": "application/json" } });
  assert.equal(r.json.url, "/classic-api/api/chat");
  assert.equal(r.json.method, "POST");
  assert.equal(r.json.body, '{"a":1}');
});

test("proxy: it will not forward to other paths or escape the prefix", async () => {
  for (const q of ["path=..%2F..%2Fetc%2Fpasswd", "path=%2E%2E/x"]) assert.equal((await call(`https://app.vercel.app/api/proxy?${q}`)).status, 400, q);
  assert.equal((await call("https://app.vercel.app/other")).status, 400);
});

test("proxy: a missing or non-https BACKEND_URL is refused", async () => {
  const keep = process.env.BACKEND_URL;
  process.env.BACKEND_URL = "http://insecure.example";
  assert.equal((await call("https://app.vercel.app/api/proxy?path=x")).status, 500);
  process.env.BACKEND_URL = keep;
});
