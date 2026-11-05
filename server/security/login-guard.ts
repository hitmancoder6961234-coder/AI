/**
 * Failed-login throttle.
 *
 * The per-IP rate limiter stops floods; this stops *guessing*: after a few wrong passwords for the same account from
 * the same address, further attempts are refused for a while (60 s, then 5 min, then 15 min as strikes accumulate).
 * A looser per-account limit across all addresses blunts distributed guessing without letting one stranger lock the
 * real owner out for long. In-memory, per instance - like the rate limiter.
 */

export interface GuardOptions {
  /** wrong passwords allowed per window before a lock */
  maxFails: number;
  windowMs: number;
  /** first lock; later locks are 5x longer each time, capped at maxLockMs */
  baseLockMs: number;
  maxLockMs: number;
  maxKeys: number;
}

export const DEFAULT_GUARD: GuardOptions = { maxFails: 5, windowMs: 15 * 60_000, baseLockMs: 60_000, maxLockMs: 15 * 60_000, maxKeys: 20_000 };

interface Entry {
  fails: number;
  windowStart: number;
  lockUntil: number;
  strikes: number;
  touched: number;
}

export type GuardStatus = { locked: false; attemptsLeft: number } | { locked: true; retryAfter: number; attemptsLeft: 0 };

export class LoginGuard {
  private readonly entries = new Map<string, Entry>();
  readonly opts: GuardOptions;

  constructor(opts: Partial<GuardOptions> = {}, private readonly now: () => number = Date.now) {
    this.opts = { ...DEFAULT_GUARD, ...opts };
  }

  private get(key: string): Entry | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    const t = this.now();
    // forget quiet accounts: the window has passed, no lock is running
    if (e.lockUntil <= t && t - e.windowStart > this.opts.windowMs && t - e.touched > this.opts.windowMs * 2) {
      this.entries.delete(key);
      return undefined;
    }
    return e;
  }

  /** Is this key currently locked? Does not count as an attempt. */
  check(key: string): GuardStatus {
    const e = this.get(key);
    const t = this.now();
    if (e && e.lockUntil > t) return { locked: true, retryAfter: Math.ceil((e.lockUntil - t) / 1000), attemptsLeft: 0 };
    if (!e || t - e.windowStart > this.opts.windowMs) return { locked: false, attemptsLeft: this.opts.maxFails };
    return { locked: false, attemptsLeft: Math.max(0, this.opts.maxFails - e.fails) };
  }

  /** Record a wrong password. Returns the status *after* this failure. */
  fail(key: string): GuardStatus {
    const t = this.now();
    if (this.entries.size >= this.opts.maxKeys) this.sweep();
    let e = this.get(key);
    if (!e) {
      e = { fails: 0, windowStart: t, lockUntil: 0, strikes: 0, touched: t };
      this.entries.set(key, e);
    }
    if (t - e.windowStart > this.opts.windowMs) {
      e.fails = 0;
      e.windowStart = t;
    }
    e.touched = t;
    e.fails += 1;
    if (e.fails >= this.opts.maxFails) {
      e.strikes += 1;
      e.fails = 0;
      e.windowStart = t;
      const lock = Math.min(this.opts.baseLockMs * 5 ** (e.strikes - 1), this.opts.maxLockMs);
      e.lockUntil = t + lock;
      return { locked: true, retryAfter: Math.ceil(lock / 1000), attemptsLeft: 0 };
    }
    return { locked: false, attemptsLeft: this.opts.maxFails - e.fails };
  }

  /** A correct password clears the slate. */
  success(key: string): void {
    this.entries.delete(key);
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, e] of this.entries) if (e.lockUntil <= t && t - e.touched > this.opts.windowMs) this.entries.delete(k);
    // still full (an attack): drop the oldest quarter so memory stays bounded
    if (this.entries.size >= this.opts.maxKeys) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].touched - b[1].touched).slice(0, Math.ceil(this.opts.maxKeys / 4));
      for (const [k] of oldest) this.entries.delete(k);
    }
  }
}

/** Typed e-mail: reasonable shape, no whitespace, a dot in the domain. Not a full RFC parser - the server only needs to reject nonsense. */
export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** Passwords nobody should be allowed to choose (a short list of the worst offenders; length rules do the rest). */
const COMMON = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "12345678", "123456789", "1234567890", "11111111", "00000000", "qwertyui", "qwerty123",
  "qwertyuiop", "iloveyou", "letmein1", "welcome1", "welcome123", "admin123", "administrator", "abc12345", "abcd1234", "darkness", "darkness123", "changeme",
  "trustno1", "football", "baseball", "monkey123", "dragon123", "superman", "master123", "sunshine", "princess1",
]);
export const isCommonPassword = (pw: string) => COMMON.has(pw.toLowerCase());
