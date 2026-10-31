import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";

import { _resetVaultForTests, open, seal, vaultEnabled } from "../security/vault.js";
import { rateLimit, redact } from "../security/privacy.js";
import { evaluateExpression, ALL_TOOLS } from "../agent/tools.js";
import { buildSystemPrompt, parseModelJson, runAgent } from "../agent/core.js";
import { isPrivateAddress, safeFetch, validateUrl } from "../agent/safe-fetch.js";
import type { ChatMsg, LLM } from "../agent/providers.js";

// ---- vault -------------------------------------------------------------------------------------

test("vault: round-trips, binds AAD, detects tampering", () => {
  process.env.PRIVACY_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  _resetVaultForTests();
  assert.equal(vaultEnabled(), true);
  const sealed = seal("hello — привет — 你好", "msg-1");
  assert.ok(!sealed.includes("hello"));
  assert.equal(open(sealed, "msg-1"), "hello — привет — 你好");
  assert.throws(() => open(sealed, "msg-2"), "wrong AAD must fail");
  const parts = sealed.split(".");
  parts[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => open(parts.join(".")), "tampered ciphertext must fail");
  assert.notEqual(seal("x"), seal("x"), "IV must be random");
});

test("vault: rejects a key of the wrong size and is disabled without a key", () => {
  process.env.PRIVACY_ENCRYPTION_KEY = Buffer.from("short").toString("base64");
  _resetVaultForTests();
  assert.equal(vaultEnabled(), false);
  delete process.env.PRIVACY_ENCRYPTION_KEY;
  _resetVaultForTests();
  assert.equal(vaultEnabled(), false);
  assert.throws(() => seal("x"));
});

// ---- redaction ---------------------------------------------------------------------------------

test("redact: strips emails, tokens, keys, passwords and IPs", () => {
  const out = redact(
    'user a.b@example.com Bearer abcdef1234567890 sess_1700000000000_0123456789abcdef0123 AIzaSyA1234567890123456789012345 sk-ant-api03-abcdefghijklmnop "password":"hunter2" from 203.0.113.9'
  );
  for (const leak of ["a.b@example.com", "abcdef1234567890", "0123456789abcdef0123", "AIzaSy", "sk-ant", "hunter2", "203.0.113.9"]) {
    assert.ok(!out.includes(leak), `leaked: ${leak}`);
  }
});

// ---- calculator --------------------------------------------------------------------------------

test("calculator: correct precedence, functions, constants", () => {
  assert.equal(evaluateExpression("2+3*4"), 14);
  assert.equal(evaluateExpression("(2+3)*4"), 20);
  assert.equal(evaluateExpression("2^3^2"), 512);
  assert.equal(evaluateExpression("-2^2"), -4);
  assert.equal(evaluateExpression("sqrt(144)+abs(-3)"), 15);
  assert.equal(evaluateExpression("10 % 4"), 2);
  assert.ok(Math.abs(evaluateExpression("sin(pi/2)") - 1) < 1e-12);
  assert.equal(evaluateExpression("max(1,5,3)"), 5);
});

test("calculator: refuses code and non-finite results", () => {
  for (const bad of ["process.exit()", "constructor.constructor('return 1')()", "1/0", "((((", "2 +", "foo(1)", "1;2", "a"]) {
    assert.throws(() => evaluateExpression(bad), undefined, bad);
  }
  assert.throws(() => evaluateExpression("(".repeat(60) + "1" + ")".repeat(60)));
});

// ---- SSRF guard --------------------------------------------------------------------------------

test("safe-fetch: blocks private, local and exotic destinations", () => {
  for (const url of [
    "http://127.0.0.1/", "http://localhost/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/",
    "http://192.168.1.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "file:///etc/passwd", "ftp://example.com/",
    "http://user:pw@example.com/", "http://example.com:22/", "http://service.internal/", "http://100.64.0.1/",
  ]) {
    assert.throws(() => validateUrl(url), undefined, url);
  }
  assert.doesNotThrow(() => validateUrl("https://example.com/path?q=1"));
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isPrivateAddress("172.16.0.1"), true);
  assert.equal(isPrivateAddress("fd00::1"), true);
  assert.equal(isPrivateAddress("fe80::1"), true);
  assert.equal(isPrivateAddress("::ffff:7f00:1"), true);
  assert.equal(isPrivateAddress("::ffff:10.1.2.3"), true);
  assert.equal(isPrivateAddress("64:ff9b::a00:1"), true);
  assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false);
  assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
});

test("safe-fetch: a public hostname that resolves to loopback is refused at connect time", async () => {
  // 127.0.0.1.nip.io resolves to 127.0.0.1 via public DNS. Offline machines fail DNS instead — both are a refusal.
  await assert.rejects(() => safeFetch("http://127.0.0.1.nip.io/"), /Blocked|ENOTFOUND|EAI_AGAIN|timed out/i);
});

// ---- agent loop --------------------------------------------------------------------------------

function scripted(replies: string[]): LLM & { seen: ChatMsg[][] } {
  const seen: ChatMsg[][] = [];
  let i = 0;
  return {
    provider: "fake",
    model: "scripted",
    seen,
    async complete(messages) {
      seen.push(messages.map((m) => ({ ...m })));
      return replies[Math.min(i++, replies.length - 1)];
    },
  };
}

test("parseModelJson: tolerates fences, chatter and braces inside strings", () => {
  assert.deepEqual(parseModelJson('```json\n{"thought":"x","final":"ok"}\n```'), { thought: "x", final: "ok" });
  assert.deepEqual(parseModelJson('Sure! {"tool":"calculator","args":{"expression":"1+1"}} done'), { tool: "calculator", args: { expression: "1+1" } });
  assert.equal(parseModelJson('{"final":"a } brace { inside"}')?.final, "a } brace { inside");
  assert.equal(parseModelJson("no json here"), null);
  assert.equal(parseModelJson('{"unrelated":1}'), null);
});

test("agent: calls a tool, feeds the observation back, then finishes", async () => {
  const llm = scripted([
    '{"thought":"need math","tool":"calculator","args":{"expression":"12*12"}}',
    '{"thought":"done","final":"The answer is 144."}',
  ]);
  const events: string[] = [];
  const r = await runAgent({ llm, tools: ALL_TOOLS, goal: "What is 12*12?", onEvent: (e) => events.push(e.type) });
  assert.equal(r.answer, "The answer is 144.");
  assert.equal(r.steps, 2);
  assert.deepEqual(events, ["start", "thought", "tool_call", "tool_result", "thought", "final"]);
  const second = llm.seen[1];
  assert.match(second[second.length - 1].content, /<observation tool="calculator" ok="true">\n144\n<\/observation>/);
});

test("agent: system prompt marks observations as untrusted and lists tools", () => {
  const p = buildSystemPrompt(ALL_TOOLS);
  assert.match(p, /untrusted DATA/);
  for (const t of ALL_TOOLS) assert.ok(p.includes(t.name));
});

test("agent: unknown tools and tool errors become observations, not crashes", async () => {
  const llm = scripted([
    '{"tool":"rm_rf","args":{}}',
    '{"tool":"calculator","args":{"expression":"1/0"}}',
    '{"final":"recovered"}',
  ]);
  const r = await runAgent({ llm, tools: ALL_TOOLS, goal: "go" });
  assert.equal(r.answer, "recovered");
  const results = r.trace.filter((e) => e.type === "tool_result") as any[];
  assert.equal(results[0].ok, false);
  assert.match(results[0].output, /Unknown tool/);
  assert.equal(results[1].ok, false);
});

test("agent: identical repeated calls are cut off", async () => {
  const same = '{"tool":"datetime","args":{}}';
  const llm = scripted([same, same, same, '{"final":"stopped"}']);
  const r = await runAgent({ llm, tools: ALL_TOOLS, goal: "loop" });
  const results = r.trace.filter((e) => e.type === "tool_result") as any[];
  assert.equal(results[2].ok, false);
  assert.match(results[2].output, /already ran/);
});

test("agent: non-JSON models degrade gracefully to a plain answer", async () => {
  const llm = scripted(["Just prose.", "Still prose."]);
  const r = await runAgent({ llm, tools: ALL_TOOLS, goal: "hi" });
  assert.equal(r.answer, "Still prose.");
});

test("agent: step budget forces a final answer", async () => {
  const llm = scripted(['{"tool":"scratchpad","args":{"action":"list"}}', '{"tool":"datetime","args":{"timeZone":"UTC"}}', '{"final":"forced"}']);
  const r = await runAgent({ llm, tools: ALL_TOOLS, goal: "x", maxSteps: 2 });
  assert.equal(r.answer, "forced");
  assert.equal(r.steps, 2);
});

test("agent: tools are restricted to the allow-list given by the caller", async () => {
  const llm = scripted(['{"tool":"web_search","args":{"query":"x"}}', '{"final":"ok"}']);
  const only = ALL_TOOLS.filter((t) => t.name === "calculator");
  const r = await runAgent({ llm, tools: only, goal: "x" });
  const first = r.trace.find((e) => e.type === "tool_result") as any;
  assert.equal(first.ok, false);
  assert.ok(!llm.seen[0][0].content.includes("web_search:"));
});

test("agent: cancellation stops the loop", async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => runAgent({ llm: scripted(['{"final":"x"}']), tools: ALL_TOOLS, goal: "x", signal: ac.signal }), /Aborted/);
});

// ---- rate limiter ------------------------------------------------------------------------------

test("rateLimit: allows the budget then answers 429 with Retry-After", () => {
  const mw = rateLimit({ name: "t", windowMs: 60_000, max: 2 });
  const hits: number[] = [];
  const mk = () => {
    const headers: Record<string, string> = {};
    let code = 200;
    const res: any = {
      setHeader: (k: string, v: string) => (headers[k] = v),
      status: (c: number) => ((code = c), res),
      json: () => hits.push(code),
    };
    return { req: { ip: "198.51.100.7", socket: {} } as any, res, headers };
  };
  for (let n = 0; n < 3; n++) {
    const { req, res } = mk();
    mw(req, res, () => hits.push(200));
  }
  assert.deepEqual(hits, [200, 200, 429]);
});
