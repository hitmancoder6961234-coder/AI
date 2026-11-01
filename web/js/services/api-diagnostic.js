/**
 * Clarity API Diagnostic Utility
 * 
 * Intercepts, traces, and logs the full request/response cycle for API calls
 * with specialized diagnostic telemetry targeting the '/api/chat' route and related chat endpoints.
 */
(function () {
  if (typeof window === "undefined") return;

  window.Clarity = window.Clarity || {};

  const MAX_LOG_ENTRIES = 100;
  const STORAGE_KEY = "clarity_api_diagnostics_log";

  // In-memory ring buffer
  const diagnosticLogs = [];

  // Try loading recent logs from sessionStorage
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        diagnosticLogs.push(...parsed.slice(-MAX_LOG_ENTRIES));
      }
    }
  } catch (e) {}

  function persistLogs() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(diagnosticLogs.slice(-MAX_LOG_ENTRIES)));
    } catch (e) {}
  }

  function sanitizeHeaders(headers) {
    if (!headers) return {};
    const clean = {};
    if (typeof headers.forEach === "function") {
      headers.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        if (lowerKey === "authorization") {
          clean[key] = value ? `Bearer [REDACTED ${value.length} chars]` : "[EMPTY]";
        } else if (lowerKey.includes("key") || lowerKey.includes("secret") || lowerKey.includes("token")) {
          clean[key] = "[REDACTED]";
        } else {
          clean[key] = value;
        }
      });
    } else if (typeof headers === "object") {
      for (const [key, value] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey === "authorization") {
          clean[key] = value ? `Bearer [REDACTED ${String(value).length} chars]` : "[EMPTY]";
        } else if (lowerKey.includes("key") || lowerKey.includes("secret") || lowerKey.includes("token")) {
          clean[key] = "[REDACTED]";
        } else {
          clean[key] = value;
        }
      }
    }
    return clean;
  }

  function isChatRoute(url) {
    if (!url) return false;
    const clean = String(url).toLowerCase();
    return clean.includes("/api/chat") ||
           clean.includes("/api/studio/chat") ||
           clean.includes("/chat") ||
           clean.includes("/api/conversations/");
  }

  function recordLog(entry) {
    diagnosticLogs.push(entry);
    if (diagnosticLogs.length > MAX_LOG_ENTRIES) {
      diagnosticLogs.shift();
    }
    persistLogs();
  }

  /**
   * Diagnostic logger utility
   */
  const diagnostic = {
    enabled: true,

    getLogs() {
      return [...diagnosticLogs];
    },

    getChatLogs() {
      return diagnosticLogs.filter((entry) => isChatRoute(entry.url) || entry.isTargetChat);
    },

    clear() {
      diagnosticLogs.length = 0;
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch (e) {}
      console.log("%c[API Diagnostic]%c In-memory and session logs cleared.", "color: #3b82f6; font-weight: bold;", "color: inherit;");
    },

    exportLogs() {
      return JSON.stringify({
        exportedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        origin: window.location.origin,
        online: navigator.onLine,
        totalLogs: diagnosticLogs.length,
        chatLogsCount: this.getChatLogs().length,
        logs: diagnosticLogs,
      }, null, 2);
    },

    printSummary() {
      const chatLogs = this.getChatLogs();
      console.group(`%c[API Diagnostic Summary] Target '/api/chat' Traces (${chatLogs.length} entries)`, "color: #2563eb; font-weight: bold; font-size: 13px;");
      if (chatLogs.length === 0) {
        console.log("No chat API requests recorded in current session.");
      } else {
        console.table(chatLogs.map((log) => ({
          id: log.requestId,
          timestamp: log.timestamp,
          url: log.url,
          method: log.method,
          status: log.status !== undefined ? `${log.status} ${log.statusText || ""}` : (log.error ? "FAILED" : "PENDING"),
          duration: log.durationMs ? `${log.durationMs}ms` : "N/A",
          responseType: log.responseContentType || "N/A",
          error: log.error || "None",
        })));
      }
      console.groupEnd();
    },

    /**
     * Self-diagnostic probe that sends a test payload to '/api/chat' and outputs the step-by-step trace
     */
    async testChatRoute(message = "Hello from Clarity API Diagnostic Probe", options = {}) {
      const targetUrl = options.url || "/api/chat";
      console.group(`%c[API Diagnostic Probe] Testing '${targetUrl}'...`, "color: #8b5cf6; font-weight: bold; font-size: 13px;");
      console.log("Sending payload:", { message, timestamp: new Date().toISOString() });
      
      const startTime = performance.now();
      try {
        const res = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
          },
          body: JSON.stringify({
            message: message,
            history: [],
            studioType: "diagnostic_test",
            diagnostic: true
          })
        });

        const duration = Math.round(performance.now() - startTime);
        const contentType = res.headers.get("content-type") || "";
        console.log(`Response received in ${duration}ms:`, {
          status: res.status,
          statusText: res.statusText,
          contentType: contentType,
          headers: Object.fromEntries(res.headers.entries())
        });

        if (contentType.includes("text/event-stream")) {
          console.log("Stream detected. Reading SSE events...");
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let streamText = "";
          let chunkCount = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunkCount++;
            streamText += decoder.decode(value, { stream: true });
          }
          console.log(`✅ Stream completed (${chunkCount} chunks, ${streamText.length} bytes):`, streamText.substring(0, 300) + (streamText.length > 300 ? "..." : ""));
        } else {
          const text = await res.text();
          let parsed;
          try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
          if (res.ok) {
            console.log("✅ JSON/Text response OK:", parsed);
          } else {
            console.warn("⚠️ Non-200 Response:", parsed);
          }
        }
        console.groupEnd();
        return { ok: res.ok, status: res.status, durationMs: duration };
      } catch (err) {
        const duration = Math.round(performance.now() - startTime);
        console.error("❌ Network or Request Failure:", err);
        console.groupEnd();
        return { ok: false, error: err.message || String(err), durationMs: duration };
      }
    }
  };

  // Expose global accessors
  window.Clarity.diagnostic = diagnostic;
  window.apiDiagnostic = diagnostic;
  window.getApiChatDiagnostics = () => diagnostic.getChatLogs();
  window.printApiDiagnostics = () => diagnostic.printSummary();

  // Install Fetch Interceptor for Full Request/Response Cycle Logging Safely
  function createWrappedFetch(originalFetch) {
    return async function (...args) {
      const startTime = performance.now();
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const requestTimestamp = new Date().toISOString();

      let input = args[0];
      let init = args[1] || {};

      let url = "";
      let method = "GET";
      let requestHeaders = {};
      let requestBody = null;

      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.toString();
      } else if (input && typeof input === "object" && "url" in input) {
        url = input.url;
        method = input.method || method;
        requestHeaders = input.headers || requestHeaders;
      }

      if (init.method) method = init.method.toUpperCase();
      if (init.headers) requestHeaders = init.headers;
      if (init.body) {
        if (typeof init.body === "string") {
          try {
            requestBody = JSON.parse(init.body);
          } catch (e) {
            requestBody = init.body.length > 1000 ? init.body.substring(0, 1000) + " [TRUNCATED]" : init.body;
          }
        } else if (init.body instanceof FormData) {
          requestBody = "[FormData payload]";
        } else {
          requestBody = "[Binary or Stream payload]";
        }
      }

      const isTargetChat = isChatRoute(url);
      const logEntry = {
        requestId,
        timestamp: requestTimestamp,
        url,
        method,
        isTargetChat,
        requestHeaders: sanitizeHeaders(requestHeaders),
        requestBody,
        credentials: init.credentials || "default",
        status: undefined,
        statusText: undefined,
        responseHeaders: {},
        responseContentType: undefined,
        durationMs: undefined,
        error: null,
        streamDetails: null,
      };

      if (isTargetChat) {
        console.groupCollapsed(`%c🚀 [API Request: ${method} ${url}]%c (ID: ${requestId})`, "color: #2563eb; font-weight: bold;", "color: #64748b; font-size: 11px;");
        console.log("Timestamp:", requestTimestamp);
        console.log("Target URL:", url);
        console.log("Method:", method);
        console.log("Headers:", logEntry.requestHeaders);
        console.log("Body Payload:", requestBody);
        console.log("Network Online:", navigator.onLine);
        console.groupEnd();
      }

      try {
        const response = await originalFetch.apply(this, args);
        const durationMs = Math.round(performance.now() - startTime);

        logEntry.durationMs = durationMs;
        logEntry.status = response.status;
        logEntry.statusText = response.statusText;
        logEntry.responseContentType = response.headers.get("content-type") || "";

        const respHeaders = {};
        response.headers.forEach((val, key) => {
          respHeaders[key] = val;
        });
        logEntry.responseHeaders = respHeaders;

        // Check for anomalies
        const isHtmlFallback = logEntry.responseContentType.includes("text/html") && url.startsWith("/api/");

        if (isTargetChat) {
          const badgeColor = response.ok ? "#16a34a" : response.status >= 500 ? "#dc2626" : "#ea580c";
          console.groupCollapsed(
            `%c${response.ok ? "✅" : "❌"} [API Response: ${response.status} ${response.statusText}] %c${method} ${url} (%c${durationMs}ms%c)`,
            `color: ${badgeColor}; font-weight: bold;`,
            "color: #1e293b; font-weight: normal;",
            "color: #2563eb; font-weight: bold;",
            "color: #1e293b; font-weight: normal;"
          );
          console.log("Status:", response.status, response.statusText);
          console.log("Latency:", `${durationMs}ms`);
          console.log("Content-Type:", logEntry.responseContentType);
          console.log("Response Headers:", respHeaders);

          if (isHtmlFallback) {
            console.error(
              "⚠️ [DIAGNOSTIC ANOMALY DETECTED]: Endpoint returned 'text/html' for an API route. " +
              "This usually means the backend route does not exist and Vite/SPA static catch-all returned index.html!"
            );
            logEntry.error = "HTML_FALLBACK_ANOMALY: Received index.html instead of JSON/SSE";
          }

          if (!response.ok) {
            console.warn(`⚠️ [API Error Status ${response.status}]: Request failed.`);
          }

          console.groupEnd();
        }

        recordLog(logEntry);
        return response;
      } catch (err) {
        const durationMs = Math.round(performance.now() - startTime);
        logEntry.durationMs = durationMs;
        logEntry.error = err.message || String(err);
        recordLog(logEntry);

        if (isTargetChat) {
          console.group(`%c⚠️ [API Network Glitch] %c${method} ${url} (%c${durationMs}ms%c)`, "color: #ea580c; font-weight: bold;", "color: inherit;", "color: #ea580c;", "color: inherit;");
          console.warn("Network Diagnostic Warning:", err.message || err);
          console.log("Request ID:", requestId);
          console.log("Request was:", { url, method, headers: logEntry.requestHeaders, body: requestBody });
          console.groupEnd();
        }

        throw err;
      }
    };
  }

  // Safely install wrapped fetch without throwing if window.fetch is getter-only
  if (typeof window.fetch === "function") {
    try {
      const originalFetch = window.fetch;
      const wrapped = createWrappedFetch(originalFetch);

      let installed = false;
      try {
        Object.defineProperty(window, "fetch", {
          value: wrapped,
          writable: true,
          configurable: true,
        });
        installed = true;
      } catch (e1) {
        try {
          Object.defineProperty(Window.prototype, "fetch", {
            value: wrapped,
            writable: true,
            configurable: true,
          });
          installed = true;
        } catch (e2) {
          try {
            window.fetch = wrapped;
            installed = true;
          } catch (e3) {
            // Getter-only window.fetch in strict sandboxed iframe
          }
        }
      }

      if (!installed) {
        console.warn("[API Diagnostic] window.fetch is read-only in this environment. Diagnostic methods available via Clarity.diagnostic.");
      }
    } catch (e) {
      console.warn("[API Diagnostic] Fetch interception setup warning:", e);
    }
  }

  console.log("%c[Clarity API Diagnostic Logger Active]%c Full request/response cycle telemetry installed for '/api/chat'. Run %cClarity.diagnostic.printSummary()%c or %cClarity.diagnostic.testChatRoute()%c to test.", "background: #2563eb; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;", "color: inherit;", "color: #2563eb; font-weight: bold;", "color: inherit;", "color: #2563eb; font-weight: bold;", "color: inherit;");
})();
