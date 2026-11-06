window.Darkness = window.Darkness || {};

/**
 * HTTP client for the Darkness backend.
 *
 * Supports cross-origin production deployment between Render frontend
 * (darkness-1-6ir1.onrender.com) and Render backend (darkness-sznp.onrender.com).
 * Includes automatic URL rewriting and credential inclusion (the HttpOnly session cookie).
 */
(function() {
  const getDetectedBase = function() {
    if (typeof window !== "undefined") {
      if (window.__DARKNESS_API_BASE__) return window.__DARKNESS_API_BASE__;
      try {
        if (window.env && window.env.VITE_API_URL) {
          return window.env.VITE_API_URL;
        }
      } catch (e) {}
    }
    return "";
  };

  const detectedBase = getDetectedBase();

  // The hosted front door (Vercel) refuses request bodies over about 4.5 MB with a bare 413 page, not our JSON. Say what happened.
  const FRONT_DOOR_413 = "This request is too large for the hosting front door (about 4 MB). Split it into smaller files or ZIP a project (ZIPs are sent in parts), or open the app directly on its API server address for big uploads.";
  const isFrontDoor413 = (status, data) => status === 413 && !!data && typeof data.raw === "string" && /FUNCTION_PAYLOAD_TOO_LARGE|Request Entity Too Large|Payload Too Large/i.test(data.raw);

  window.Darkness.api = {
    base: detectedBase,

    // The session is an HttpOnly cookie that the browser attaches itself (credentials: "include"). No token is kept where
    // page scripts can read it, so there is nothing to add here. Kept as a hook for callers that still ask for headers.
    _getAuthHeaders() {
      return {};
    },

    _url(path) {
      if (!path) return "/";
      if (path.startsWith("http://") || path.startsWith("https://")) return path;
      const base = (typeof this.base === "string" ? this.base : "") || (typeof window.Darkness?.api?.base === "string" ? window.Darkness.api.base : detectedBase);
      const cleanPath = path.startsWith("/") ? path : "/" + path;
      return (base ? base.replace(/\/+$/, "") : "") + cleanPath;
    },

    async request(path, options) {
      const opts = Object.assign({ credentials: "include" }, options || {});
      const method = (opts.method || "GET").toUpperCase();
      const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
      opts.headers = Object.assign({}, this._getAuthHeaders(), opts.headers || {});
      if (hasBody && !(opts.body instanceof FormData)) {
        opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers);
      }
      const targetUrl = this._url(path);
      
      let resp = null;
      let lastErr = null;
      const isSafeMethod = method === "GET" || method === "HEAD";
      const maxRetries = isSafeMethod ? 2 : 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          resp = await fetch(targetUrl, opts);
          lastErr = null;
          break;
        } catch (fetchErr) {
          lastErr = fetchErr;
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, (attempt + 1) * 250));
            continue;
          }
        }
      }

      if (lastErr || !resp) {
        const netError = new Error((lastErr && lastErr.message) || "Network connection failed");
        netError.status = 0;
        netError.type = "network_error";
        throw netError;
      }

      let data = null;
      const text = await resp.text();
      if (text) {
        try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
      }

      if (!resp.ok) {
        const err = new Error(isFrontDoor413(resp.status, data) ? FRONT_DOOR_413 : (data && data.error) || resp.statusText || "Request failed");
        err.status = resp.status;
        err.type = (data && data.type) || null;
        err.data = data;
        if (resp.status === 401 && !path.startsWith("/api/auth/")) {
          window.Darkness.auth?.handleSessionExpired?.();
        }
        throw err;
      }
      return data;
    },

    get(path, params) {
      let url = path;
      if (params) {
        const qs = new URLSearchParams(params).toString();
        url += (url.includes("?") ? "&" : "?") + qs;
      }
      return this.request(url, { method: "GET" });
    },

    post(path, body) {
      return this.request(path, { method: "POST", body: JSON.stringify(body || {}) });
    },

    put(path, body) {
      return this.request(path, { method: "PUT", body: JSON.stringify(body || {}) });
    },

    patch(path, body) {
      return this.request(path, { method: "PATCH", body: JSON.stringify(body || {}) });
    },

    del(path) {
      return this.request(path, { method: "DELETE" });
    },

    /** Multipart upload; the browser sets the boundary itself. */
    async upload(path, formData) {
      const headers = Object.assign({}, this._getAuthHeaders());
      const resp = await fetch(this._url(path), {
        method: "POST",
        body: formData,
        headers,
        credentials: "include",
      });
      const text = await resp.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
      }
      if (!resp.ok) {
        const err = new Error(isFrontDoor413(resp.status, data) ? FRONT_DOOR_413 : (data && data.error) || resp.statusText || "Upload failed");
        err.status = resp.status;
        err.type = (data && data.type) || null;
        if (resp.status === 401) window.Darkness.auth?.handleSessionExpired?.();
        throw err;
      }
      return data;
    },

    /**
     * POST that returns a Server-Sent Events stream. Parses complete `data:`
     * frames and dispatches them; the caller owns the AbortSignal.
     */
    async streamSSE(path, body, handlers, signal) {
      const { onContent, onDone, onError } = handlers || {};
      const headers = Object.assign({ "Content-Type": "application/json" }, this._getAuthHeaders());
      const resp = await fetch(this._url(path), {
        method: "POST",
        headers,
        body: JSON.stringify(body || {}),
        credentials: "include",
        signal,
      });

      if (!resp.ok) {
        let detail = resp.statusText;
        let type = "http_error";
        try {
          const txt = await resp.text();
          if (txt) {
            try {
              const parsed = JSON.parse(txt);
              detail = parsed.error || txt;
              type = parsed.type || type;
            } catch (e) { detail = txt; }
          }
        } catch (e) { /* body unavailable */ }
        if (resp.status === 401) window.Darkness.auth?.handleSessionExpired?.();
        if (onError) onError({ message: detail, type, status: resp.status });
        return "";
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep).trim();
          buffer = buffer.slice(sep + 2);
          if (!frame.startsWith("data:")) continue;
          let event;
          try { event = JSON.parse(frame.slice(5).trim()); } catch (e) { continue; }

          if (event.error) {
            if (onError) onError(event.error);
          } else if (event.content) {
            full += event.content;
            if (onContent) onContent(event.content, full);
          }
          if (event.done && onDone) onDone(full, event);
        }
      }
      return full;
    },
  };

  // Provide a safe, wrapped fetch on window.Darkness.api that handles base URL and auth
  const customFetch = function(input, init) {
    init = Object.assign({}, init || {});
    let url = typeof input === "string" ? input : (input instanceof Request ? input.url : String(input));
    const currentBase = window.Darkness?.api?.base || detectedBase;

    if (url.startsWith("/api/")) {
      if (currentBase) {
        url = currentBase.replace(/\/+$/, "") + url;
        if (typeof input === "string") {
          input = url;
        } else if (input instanceof Request) {
          input = new Request(url, input);
        }
      }
    }

    if (init.credentials === undefined) {
      init.credentials = "include";
    }


    const nativeFn = (typeof window !== "undefined" && window.fetch) ? window.fetch.bind(window) : fetch;
    return nativeFn.call(this, input, init);
  };

  window.Darkness.api.fetch = customFetch;

  // Safely attempt to intercept global fetch if the environment allows redefinition.
  // In environments where window.fetch has only a getter (e.g. sandboxed iframes),
  // this is safely caught without throwing an uncaught TypeError.
  if (typeof window !== "undefined" && typeof window.fetch === "function" && !window.__darkness_fetch_intercepted__) {
    try {
      const nativeFetch = window.fetch.bind(window);
      const wrappedGlobalFetch = function(input, init) {
        init = Object.assign({}, init || {});
        let url = typeof input === "string" ? input : (input instanceof Request ? input.url : String(input));
        const currentBase = window.Darkness?.api?.base || detectedBase;

        if (url.startsWith("/api/")) {
          if (currentBase) {
            url = currentBase.replace(/\/+$/, "") + url;
            if (typeof input === "string") {
              input = url;
            } else if (input instanceof Request) {
              input = new Request(url, input);
            }
          }
        }

        if (init.credentials === undefined) {
          init.credentials = "include";
        }


        return nativeFetch.call(this, input, init);
      };

      let intercepted = false;
      try {
        Object.defineProperty(window, "fetch", {
          value: wrappedGlobalFetch,
          writable: true,
          configurable: true,
        });
        intercepted = true;
      } catch (e1) {
        try {
          window.fetch = wrappedGlobalFetch;
          intercepted = true;
        } catch (e2) {
          // fetch has only a getter on window in this context; ignore safely
        }
      }
      if (intercepted) {
        window.__darkness_fetch_intercepted__ = true;
      }
    } catch (e) {
      // Ignored to guarantee zero unhandled exceptions on window initialization
    }
  }
})();

