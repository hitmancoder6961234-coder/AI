import assert from "node:assert/strict";
import test from "node:test";

import { EMAIL_RE, LoginGuard, isCommonPassword } from "../server/security/login-guard.js";

const clock = () => {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
};

test("login guard: counts down, locks on the 5th miss, and the lock grows with repeated strikes", () => {
  const c = clock();
  const g = new LoginGuard({}, c.now);
  assert.deepEqual(g.check("k"), { locked: false, attemptsLeft: 5 });
  assert.deepEqual(g.fail("k"), { locked: false, attemptsLeft: 4 });
  g.fail("k"); g.fail("k");
  assert.deepEqual(g.fail("k"), { locked: false, attemptsLeft: 1 });
  const first = g.fail("k");
  assert.ok(first.locked && first.retryAfter === 60);
  assert.ok(g.check("k").locked);
  c.advance(30_000);
  const mid = g.check("k");
  assert.ok(mid.locked && mid.retryAfter === 30, "counts down");
  c.advance(31_000);
  assert.equal(g.check("k").locked, false, "the lock expires");
  for (let i = 0; i < 4; i++) g.fail("k");
  const second = g.fail("k");
  assert.ok(second.locked && second.retryAfter === 300, "second strike: 5 minutes");
  c.advance(301_000);
  for (let i = 0; i < 4; i++) g.fail("k");
  const third = g.fail("k");
  assert.ok(third.locked && third.retryAfter === 900, "third strike: 15 minutes");
  c.advance(901_000);
  for (let i = 0; i < 4; i++) g.fail("k");
  const fourth = g.fail("k");
  assert.ok(fourth.locked && fourth.retryAfter === 900, "capped at 15 minutes");
});

test("login guard: success clears the slate, keys are independent, old failures age out", () => {
  const c = clock();
  const g = new LoginGuard({}, c.now);
  g.fail("a"); g.fail("a"); g.fail("b");
  assert.equal(g.check("a").attemptsLeft, 3);
  assert.equal(g.check("b").attemptsLeft, 4);
  g.success("a");
  assert.equal(g.check("a").attemptsLeft, 5);
  c.advance(16 * 60_000);
  assert.equal(g.check("b").attemptsLeft, 5, "failures outside the window no longer count");
  const f = g.fail("b");
  assert.deepEqual(f, { locked: false, attemptsLeft: 4 });
});

test("login guard: memory stays bounded under a flood of distinct keys", () => {
  const c = clock();
  const g = new LoginGuard({ maxKeys: 100 }, c.now);
  for (let i = 0; i < 1000; i++) { g.fail("k" + i); c.advance(1); }
  assert.ok((g as any).entries.size <= 100, "entries: " + (g as any).entries.size);
});

test("e-mail shape and common-password checks", () => {
  for (const ok of ["a@b.co", "first.last+tag@sub.example.org", "ünï@exämple.de"]) assert.ok(EMAIL_RE.test(ok), ok);
  for (const bad of ["", "plain", "a@b", "a b@c.co", "a@b .co", "@b.co", "a@@b.co", "a@b.c", "<x>@b.co", "a@b.co,c@d.co"]) assert.ok(!EMAIL_RE.test(bad), bad);
  assert.ok(isCommonPassword("Password123") && isCommonPassword("QWERTYUI") && !isCommonPassword("a-long-unusual-passphrase"));
});
