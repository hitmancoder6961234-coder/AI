window.Darkness = window.Darkness || {};

/**
 * Authentication service.
 *
 * Every failure is turned into an AuthError with a `kind` the sign-in screen can act on:
 *   offline | timeout | network | aborted | parse | http
 * and, for `http`, the HTTP `status`, the server's `code`, the offending `field`, `retryAfter` seconds and
 * `attemptsLeft`. Nothing here renders UI; js/ui/auth-gate.js does that.
 */
function AuthError(kind, message, extra) {
  this.name = "AuthError";
  this.kind = kind;
  this.message = message;
  if (extra) Object.assign(this, extra);
}
AuthError.prototype = Object.create(Error.prototype);
AuthError.prototype.constructor = AuthError;

const STATUS_CODES = { 400: "VALIDATION_ERROR", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 413: "TOO_LARGE", 429: "RATE_LIMITED", 502: "BAD_GATEWAY", 503: "SERVICE_UNAVAILABLE", 504: "GATEWAY_TIMEOUT" };
const STATUS_TEXT = {
  403: "The request was blocked before it reached the sign-in service.",
  404: "The sign-in service could not be found at this address.",
  413: "The request was too large.",
  429: "Too many attempts. Please wait a moment.",
  502: "The sign-in service is not responding.",
  503: "The sign-in service is temporarily unavailable.",
  504: "The sign-in service took too long to respond.",
};

const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } };

window.Darkness.AuthError = AuthError;
window.Darkness.auth = {
  _user: null,
  _listeners: new Set(),
  _reason: null, // why the gate is showing: "logout" | "expired" | "other-tab" | null
  _lastCheck: 0,

  get user() {
    return this._user;
  },

  get isAuthenticated() {
    return !!this._user;
  },

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  },

  _emit() {
    this._listeners.forEach((fn) => {
      try { fn(this._user); } catch (e) { console.error(e); }
    });
  },

  _fetch(path, options) {
    const opts = Object.assign({ credentials: "include" }, options || {});
    const anon = opts.anon;
    delete opts.anon;
    // The session is an HttpOnly cookie (sent because of credentials: "include"); no token is kept for scripts to read.
    opts.headers = Object.assign({}, opts.headers || {});

    let url = path;
    if (window.Darkness?.api?._url) {
      url = window.Darkness.api._url(path);
    }
    return fetch(url, opts);
  },

  /** One JSON request with a timeout, cancellation and every failure mapped to an AuthError. */
  async _request(path, { method = "GET", body, signal, timeoutMs = 20000, anon = false } = {}) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new AuthError("offline", "You appear to be offline.");
    const ctrl = new AbortController();
    let timedOut = false;
    let cancelled = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    if (signal) {
      if (signal.aborted) { cancelled = true; ctrl.abort(); }
      else signal.addEventListener("abort", () => { cancelled = true; ctrl.abort(); }, { once: true });
    }
    let resp;
    let text = "";
    try {
      resp = await this._fetch(path, {
        method,
        anon,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      text = await resp.text();
    } catch (e) {
      if (cancelled) throw new AuthError("aborted", "Cancelled.");
      if (timedOut) throw new AuthError("timeout", "The server took too long to answer.");
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new AuthError("offline", "You appear to be offline.");
      throw new AuthError("network", "Could not reach the server.", { cause: e });
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    if (!resp.ok) {
      const status = resp.status;
      const header = parseInt(resp.headers.get("retry-after") || "", 10);
      throw new AuthError("http", (data && data.error) || STATUS_TEXT[status] || `Request failed (${status}).`, {
        status,
        code: (data && data.code) || STATUS_CODES[status] || (status >= 500 ? "SERVER_ERROR" : "REQUEST_FAILED"),
        field: data && data.field,
        retryAfter: (Number.isFinite(header) && header > 0 ? header : data && data.retryAfter) || 0,
        attemptsLeft: data && typeof data.attemptsLeft === "number" ? data.attemptsLeft : undefined,
        nonJson: data === null,
      });
    }
    if (!data || typeof data !== "object") throw new AuthError("parse", "The server sent a reply this app could not read.", { status: resp.status });
    return data;
  },

  /** Is there a live session right now? null when the check itself could not be made. */
  async _verify() {
    try {
      const r = await this._fetch("/api/auth/me");
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      return !!(j && j.user);
    } catch (e) {
      return null;
    }
  },

  async refresh() {
    // One-time migration: older versions kept the session token in localStorage. If one is still there, present it ONCE so
    // the server re-issues the HttpOnly cookie, then delete it so scripts can never read a session token again.
    const legacy = lsGet("darkness_token");
    let resp;
    try {
      resp = await this._fetch("/api/auth/me", { credentials: "include", headers: legacy ? { Authorization: `Bearer ${legacy}` } : undefined });
    } catch (e) {
      return this._user; // offline or a network blip: keep what we know instead of signing the user out
    }
    if (!resp.ok && resp.status !== 401) return this._user; // a server hiccup is not a sign-out
    if (legacy) lsDel("darkness_token");
    const json = resp.ok ? await resp.json().catch(() => ({})) : {};
    const before = this._user;
    this._user = (resp.ok && json.user) || null;
    if (this._user) lsSet("darkness_user", JSON.stringify(this._user));
    else if (before) {
      lsDel("darkness_user");
      if (!this._reason) this._reason = "expired";
    }
    this._lastCheck = Date.now();
    if (before && (!this._user || this._user.id !== before.id)) this._emit();
    return this._user;
  },

  /** Store the session the server just granted, and make sure the browser really kept it. */
  async _accept(data, fallbackEmail, opts) {
    const user = data.user || (data.token ? { email: fallbackEmail, name: String(fallbackEmail).split("@")[0] } : null);
    if (!user) throw new AuthError("parse", "The server accepted the request but sent no account.", { status: 200 });
    lsSet("darkness_user", JSON.stringify(user)); // the profile (not a secret); the session itself is the HttpOnly cookie
    this._user = user;
    // Blocked cookies and storage mean the next request would be anonymous: catch that now, not after the animation.
    if ((await this._verify()) === false) {
      this._user = null;
      lsDel("darkness_token");
      lsDel("darkness_user");
      throw new AuthError("http", "Your browser did not keep the session.", { status: 200, code: "SESSION_NOT_SAVED" });
    }
    this._reason = null;
    if (!opts || !opts.deferEmit) this._emit();
    return user;
  },

  async signup(email, password, name, opts) {
    const data = await this._request("/api/auth/signup", { method: "POST", body: { email, password, name }, signal: opts && opts.signal, anon: true });
    return this._accept(data, email, opts);
  },

  async login(email, password, opts) {
    const data = await this._request("/api/auth/login", { method: "POST", body: { email, password }, signal: opts && opts.signal, anon: true });
    return this._accept(data, email, opts);
  },

  /** Let the app know a deferred sign-in is complete (the gate plays its success animation first). */
  commit() {
    this._emit();
    const app = window.Darkness.app;
    if (app && app.afterLogin) app.afterLogin();
  },

  async logout() {
    try {
      await this._fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch (e) { /* the server may be unreachable; the local session is cleared regardless */ }
    lsDel("darkness_token");
    lsDel("darkness_user");
    this._user = null;
    this._reason = "logout";
    this._emit();
  },

  clearGate() {
    const app = document.getElementById("app");
    if (app) {
      app.classList.remove("is-gated");
      app.hidden = false;
      app.removeAttribute("hidden");
    }
    if (window.Darkness.authGate) window.Darkness.authGate.destroy();
  },

  renderGate() {
    const app = document.getElementById("app");
    if (app) {
      app.classList.add("is-gated");
      app.hidden = false;
      app.removeAttribute("hidden");
    }
    const reason = this._reason;
    this._reason = null;
    if (window.Darkness.authGate) window.Darkness.authGate.render({ reason });
  },
};

// Session watchdogs: a session can end while the tab sits in the background, or in another tab.
(function () {
  const auth = window.Darkness.auth;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && auth._user && Date.now() - auth._lastCheck > 15000) auth.refresh();
  });
  window.addEventListener("storage", (e) => {
    if (e.key !== "darkness_user") return; // the cached profile appears/disappears with sign-in/out; the token itself is no longer stored
    if (e.newValue && !auth._user) location.reload(); // signed in from another tab: load the app properly
    else if (!e.newValue && auth._user) {
      auth._user = null;
      auth._reason = "other-tab";
      auth._emit();
    }
  });
})();
