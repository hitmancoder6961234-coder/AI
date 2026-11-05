import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { csrfOriginGuard } from "../server/security/csrf.js";

let server: http.Server;
let port = 0;

before(async () => {
  const app = express();
  app.use(csrfOriginGuard("darkness_session", () => ["https://app.example.com"]));
  app.all("/x", (_req, res) => res.json({ ok: true }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
after(() => { server.close(); server.closeAllConnections?.(); });

const call = (method: string, headers: Record<string, string>) => fetch(`http://127.0.0.1:${port}/x`, { method, headers }).then((r) => r.status);
const cookie = { cookie: "darkness_session=abc" };

test("a cookie-authenticated POST from another site is blocked", async () => {
  assert.equal(await call("POST", { ...cookie, origin: "https://evil.example" }), 403);
  assert.equal(await call("DELETE", { ...cookie, origin: "null" }), 403);
  assert.equal(await call("POST", { ...cookie, "sec-fetch-site": "cross-site" }), 403, "no Origin but the browser says cross-site");
});

test("the same site, the proxy's forwarded host and the allow-list are accepted", async () => {
  assert.equal(await call("POST", { ...cookie, origin: `http://127.0.0.1:${port}` }), 200, "same origin");
  assert.equal(await call("POST", { ...cookie, origin: "https://my-app.vercel.app", "x-forwarded-host": "my-app.vercel.app" }), 200, "behind the Vercel proxy");
  assert.equal(await call("PATCH", { ...cookie, origin: "https://app.example.com" }), 200, "allow-listed");
  assert.equal(await call("POST", { ...cookie, origin: "https://evil.example", "x-forwarded-host": "my-app.vercel.app" }), 403, "forwarded host does not excuse a different origin");
});

test("requests that do not use the ambient cookie are not affected", async () => {
  assert.equal(await call("GET", { ...cookie, origin: "https://evil.example" }), 200, "safe methods");
  assert.equal(await call("POST", { authorization: "Bearer t", origin: "https://evil.example" }), 200, "bearer token, not the cookie");
  assert.equal(await call("POST", { origin: "https://evil.example" }), 200, "no session cookie: nothing to forge");
  assert.equal(await call("POST", { ...cookie }), 200, "no Origin (curl, server-to-server)");
});
