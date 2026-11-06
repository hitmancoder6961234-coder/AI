window.Darkness = window.Darkness || {};

/**
 * Shared helpers for the management pages (Overview, Usage, Account).
 *
 *  - swr():      stale-while-revalidate. A page revisited within a few minutes paints from memory at once and refreshes
 *                quietly, so moving between pages never shows an empty screen.
 *  - stale guard: a slow response for a page you already left is dropped instead of overwriting the page you are on.
 *  - charts:     tiny inline-SVG sparkline / bar chart, no library.
 */
(function () {
  var D = window.Darkness;
  var esc = function (s) { return D.utils.escapeHtml(String(s == null ? "" : s)); };

  var cache = new Map(); // key -> { at, data }
  var inflight = new Map(); // key -> Promise
  var TTL = 5 * 60 * 1000;

  var ICON = {
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    msg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 16V9M12 16V5M17 16v-4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
    bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    trending: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    laptop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/>',
    pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.4-.15-.74-.4-1-.25-.27-.4-.61-.4-1 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-4.97-4.5-9-10-9Z"/>',
  };
  function icon(name, size) {
    var s = size || 18;
    return '<svg class="mg-ico" viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[name] || ICON.sparkles) + "</svg>";
  }

  var nf = new Intl.NumberFormat();
  function num(n) { return nf.format(Math.round(Number(n) || 0)); }
  function compact(n) {
    n = Number(n) || 0;
    return Math.abs(n) >= 10000 ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n) : num(n);
  }
  function bytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    var u = ["KB", "MB", "GB", "TB"], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (n >= 100 ? Math.round(n) : n.toFixed(1)) + " " + u[i];
  }
  function ago(ts) {
    ts = Number(ts) || 0;
    if (!ts) return "never";
    if (ts < 1e11) ts *= 1000;
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    if (s < 86400 * 14) return Math.round(s / 86400) + " d ago";
    return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  function dateLong(ts) {
    return ts ? new Date(ts < 1e11 ? ts * 1000 : ts).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "-";
  }
  function dateTime(ts) {
    return ts ? new Date(ts < 1e11 ? ts * 1000 : ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";
  }
  function trend(now, before) {
    if (!before && !now) return { cls: "flat", text: "No activity yet" };
    if (!before) return { cls: "up", text: "New" };
    var p = Math.round(((now - before) / before) * 100);
    if (p === 0) return { cls: "flat", text: "Same as before" };
    return { cls: p > 0 ? "up" : "down", text: (p > 0 ? "+" : "") + p + "%" };
  }
  function greeting() {
    var h = new Date().getHours();
    return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }
  function initials(name) {
    var p = String(name || "").trim().split(/\s+/).filter(Boolean);
    return p.length ? (p.length > 1 ? p[0][0] + p[p.length - 1][0] : p[0].slice(0, 2)).toUpperCase() : "?";
  }

  // ---- cache ----------------------------------------------------------------------------------------------------
  function peek(key) {
    var c = cache.get(key);
    return c && Date.now() - c.at < TTL ? c : null;
  }
  function load(key, fetcher) {
    if (inflight.has(key)) return inflight.get(key);
    var p = Promise.resolve()
      .then(fetcher)
      .then(function (data) { cache.set(key, { at: Date.now(), data: data }); return data; })
      .finally(function () { inflight.delete(key); });
    inflight.set(key, p);
    return p;
  }
  function forget(prefix) {
    Array.from(cache.keys()).forEach(function (k) { if (k.indexOf(prefix) === 0) cache.delete(k); });
  }

  /**
   * Paint a page: cached data first (instantly), then fresh data. `root` is the element this page owns; if the user has
   * navigated away (root detached), nothing more is rendered.
   *   paint(data, { fresh, firstPaint })   build/patch the page
   *   fail(err)                            show an error state (only when there was nothing to show)
   */
  function swr(root, key, fetcher, paint, fail, opts) {
    var freshFor = opts && opts.freshFor != null ? opts.freshFor : 8000;
    var alive = function () { return root && root.isConnected; };
    var shown = false;
    var hit = cache.get(key); // stale data is fine to show; it is replaced right away
    if (hit) { paint(hit.data, { fresh: false, firstPaint: true }); shown = true; }
    var fresh = hit && Date.now() - hit.at < freshFor; // just loaded: do not refetch on a quick back-and-forth
    if (fresh) return Promise.resolve();
    return load(key, fetcher).then(
      function (data) { if (alive()) { paint(data, { fresh: true, firstPaint: !shown }); } },
      function (err) { if (alive() && !shown) fail(err); else if (alive()) D.toast && D.toast.show("Couldn't refresh - showing the last data", "info"); },
    );
  }

  // ---- count-up -------------------------------------------------------------------------------------------------
  var reduce = function () { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; };
  function countUp(el, to, format) {
    format = format || num;
    to = Number(to) || 0;
    if (reduce() || to === 0) { el.textContent = format(to); return; }
    var from = Number(el.dataset.v) || 0;
    el.dataset.v = String(to);
    if (from === to) { el.textContent = format(to); return; }
    var t0 = performance.now(), dur = 600;
    (function step(t) {
      if (!el.isConnected) return;
      var k = Math.min(1, (t - t0) / dur);
      el.textContent = format(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  function runCounts(scope) {
    scope.querySelectorAll("[data-count]").forEach(function (el) {
      countUp(el, el.getAttribute("data-count"), el.hasAttribute("data-bytes") ? bytes : el.hasAttribute("data-compact") ? compact : num);
    });
  }

  // ---- charts ---------------------------------------------------------------------------------------------------
  function sparkline(values, w, h) {
    w = w || 120; h = h || 30;
    values = values.map(Number);
    if (values.length < 2 || !values.some(function (v) { return v > 0; })) {
      return '<svg class="mg-spark" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="' + (h - 2) + '" x2="' + w + '" y2="' + (h - 2) + '" class="mg-spark__base"/></svg>';
    }
    var max = Math.max.apply(null, values) || 1, step = w / (values.length - 1);
    var pts = values.map(function (v, i) { return [i * step, h - 3 - (v / max) * (h - 7)]; });
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    return '<svg class="mg-spark" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + " L" + w + " " + h + " L0 " + h + 'Z" class="mg-spark__fill"/><path d="' + d + '" class="mg-spark__line" pathLength="1"/></svg>';
  }

  /** Stacked bars (prompts + replies per day). Hover/focus shows a tooltip; keyboard reachable. */
  function bars(series, opts) {
    opts = opts || {};
    var H = opts.height || 190, pad = { t: 10, b: 24, l: 4, r: 4 }, W = 640;
    var n = series.length, gap = n > 45 ? 1 : 3, bw = Math.max(2, (W - pad.l - pad.r - gap * (n - 1)) / n);
    var max = Math.max(1, Math.max.apply(null, series.map(function (s) { return s.userMessages + s.replies; })));
    var step = niceStep(max);
    var top = Math.ceil(max / step) * step || step;
    var ih = H - pad.t - pad.b;
    var y = function (v) { return pad.t + ih - (v / top) * ih; };
    var out = ['<svg class="mg-bars" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(opts.label || "Messages per day") + '">'];
    for (var g = 0; g <= top; g += step) out.push('<line x1="0" x2="' + W + '" y1="' + y(g).toFixed(1) + '" y2="' + y(g).toFixed(1) + '" class="mg-bars__grid"/>');
    series.forEach(function (s, i) {
      var x = pad.l + i * (bw + gap), total = s.userMessages + s.replies;
      var hu = (s.userMessages / top) * ih, hr = (s.replies / top) * ih;
      var label = new Date(s.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) + ": " + s.userMessages + " prompt" + (s.userMessages === 1 ? "" : "s") + ", " + s.replies + " repl" + (s.replies === 1 ? "y" : "ies");
      out.push('<g class="mg-bars__col" tabindex="0" data-tip="' + esc(label) + '" aria-label="' + esc(label) + '" style="--i:' + i + '">');
      out.push('<rect x="' + x.toFixed(1) + '" y="' + pad.t + '" width="' + bw.toFixed(1) + '" height="' + ih + '" class="mg-bars__hit"/>');
      if (total === 0) out.push('<rect x="' + x.toFixed(1) + '" y="' + (pad.t + ih - 2) + '" width="' + bw.toFixed(1) + '" height="2" rx="1" class="mg-bars__zero"/>');
      else {
        out.push('<rect x="' + x.toFixed(1) + '" y="' + (pad.t + ih - hr - hu).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, hu).toFixed(1) + '" rx="2" class="mg-bars__u"/>');
        if (hr > 0) out.push('<rect x="' + x.toFixed(1) + '" y="' + (pad.t + ih - hr).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hr.toFixed(1) + '" rx="2" class="mg-bars__r"/>');
      }
      out.push("</g>");
    });
    var every = n <= 10 ? 1 : n <= 16 ? 2 : n <= 31 ? 5 : 10;
    series.forEach(function (s, i) {
      if (i % every === 0 || i === n - 1) {
        var d = new Date(s.date + "T12:00:00");
        out.push('<text x="' + (pad.l + i * (bw + gap) + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" class="mg-bars__tick" text-anchor="middle">' + d.getDate() + " " + d.toLocaleDateString(undefined, { month: "short" }) + "</text>");
      }
    });
    out.push("</svg>");
    return out.join("");
  }
  function niceStep(max) {
    if (max <= 5) return 1;
    var raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
  }
  /** One tooltip for every chart on the page; follows the pointer, also opens on keyboard focus. */
  function bindTips(scope) {
    var tip = document.getElementById("mgTip");
    if (!tip) { tip = document.createElement("div"); tip.id = "mgTip"; tip.className = "mg-tip"; tip.setAttribute("role", "tooltip"); tip.hidden = true; document.body.appendChild(tip); }
    var hide = function () { tip.hidden = true; };
    var show = function (el, x, y) {
      tip.textContent = el.getAttribute("data-tip") || "";
      tip.hidden = false;
      var r = tip.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2)) + "px";
      tip.style.top = Math.max(8, y - r.height - 12) + "px";
    };
    scope.addEventListener("pointermove", function (e) { var t = e.target.closest && e.target.closest("[data-tip]"); t ? show(t, e.clientX, e.clientY) : hide(); });
    scope.addEventListener("pointerleave", hide);
    scope.addEventListener("focusin", function (e) { var t = e.target.closest && e.target.closest("[data-tip]"); if (t) { var r = t.getBoundingClientRect(); show(t, r.left + r.width / 2, r.top); } });
    scope.addEventListener("focusout", hide);
    window.addEventListener("hashchange", hide, { once: true });
  }

  function skeleton(kind) {
    var line = function (w) { return '<span class="mg-skel" style="width:' + w + '"></span>'; };
    if (kind === "stats") return '<div class="mg-stats">' + [1, 2, 3, 4].map(function () { return '<div class="mg-card mg-stat">' + line("40%") + line("55%").replace("mg-skel", "mg-skel mg-skel--lg") + line("70%") + "</div>"; }).join("") + "</div>";
    if (kind === "chart") return '<div class="mg-card"><div class="mg-card__head">' + line("30%") + '</div><div class="mg-skel mg-skel--block"></div></div>';
    return '<div class="mg-card">' + line("35%") + line("90%") + line("80%") + line("60%") + "</div>";
  }

  /** A friendly error panel with a retry that re-runs the page. */
  function errorPanel(message, retryId) {
    return '<div class="mg-card mg-error" role="alert">' + icon("alert", 22) + '<div><strong>Couldn\'t load this page</strong><p>' + esc(message || "Something went wrong.") + '</p></div><button class="btn btn--outline btn--sm" id="' + (retryId || "mgRetry") + '" type="button">Try again</button></div>';
  }

  /** Disable a button while an async job runs and always restore it. */
  async function busy(btn, label, job) {
    if (!btn || btn.disabled) return;
    var html = btn.innerHTML;
    btn.disabled = true; btn.classList.add("is-busy");
    if (label) btn.textContent = label;
    try { return await job(); } finally { btn.disabled = false; btn.classList.remove("is-busy"); btn.innerHTML = html; }
  }

  function csv(rows) {
    return rows.map(function (r) { return r.map(function (c) { var s = String(c == null ? "" : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(","); }).join("\n");
  }
  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type || "text/csv;charset=utf-8" }));
    var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  D.mg = { esc: esc, icon: icon, num: num, compact: compact, bytes: bytes, ago: ago, dateLong: dateLong, dateTime: dateTime, trend: trend, greeting: greeting, initials: initials, peek: peek, load: load, forget: forget, swr: swr, runCounts: runCounts, countUp: countUp, sparkline: sparkline, bars: bars, bindTips: bindTips, skeleton: skeleton, errorPanel: errorPanel, busy: busy, csv: csv, download: download };
})();
