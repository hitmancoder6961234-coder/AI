window.Darkness = window.Darkness || {};

/**
 * Small inline-SVG building blocks for the Agent Workflow, System and Models pages (no chart library, nothing loaded from a CDN).
 *
 *   D.viz.area(values, { tone, height, labels })   a smooth area chart with a gradient and light gridlines
 *   D.viz.graph({ nodes, edges, width, height })    a node graph: glowing "pads" joined by edges that animate when active
 *
 * Both return strings. All text is escaped here; values are numbers. Colours come from CSS classes (.ix-tone-*), so every theme works.
 * Motion is CSS-only and switched off by prefers-reduced-motion.
 */
(function () {
  const D = window.Darkness;
  const esc = function (s) { return D.utils.escapeHtml(String(s == null ? "" : s)); };
  let uid = 0;

  /** Smooth path through points (Catmull-Rom converted to cubic Beziers). */
  function smooth(pts) {
    if (pts.length < 2) return "";
    let d = "M" + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += " C" + c1x.toFixed(1) + " " + c1y.toFixed(1) + " " + c2x.toFixed(1) + " " + c2y.toFixed(1) + " " + p2[0].toFixed(1) + " " + p2[1].toFixed(1);
    }
    return d;
  }

  /**
   * values: numbers (null = no data that day: the line breaks instead of dropping to zero).
   * opts: tone ("accent"|"ok"|"bad"|"warn"|"info"), height, labels [first, last], format(n) for the screen-reader summary, label (aria text).
   */
  function area(values, opts) {
    opts = opts || {};
    const W = 240, H = opts.height || 64, padT = 6, padB = 4;
    const vals = (values || []).map(function (v) { return v == null ? null : Number(v); });
    const real = vals.filter(function (v) { return v != null; });
    const tone = opts.tone || "accent";
    const summary = opts.label || "";
    const labels = opts.labels ? '<div class="ix-area__x" aria-hidden="true"><span>' + esc(opts.labels[0]) + "</span><span>" + esc(opts.labels[1]) + "</span></div>" : "";
    if (vals.length < 2 || !real.length || !real.some(function (v) { return v > 0; })) {
      return '<div class="ix-area ix-tone-' + tone + '"><svg class="ix-area__svg" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(summary ? summary + ": no data yet" : "No data yet") + '"><line x1="0" y1="' + (H - padB) + '" x2="' + W + '" y2="' + (H - padB) + '" class="ix-area__base"/></svg>' + labels + "</div>";
    }
    const max = Math.max.apply(null, real) || 1, step = W / (vals.length - 1);
    const y = function (v) { return padT + (H - padT - padB) * (1 - v / max); };
    let segments = [], cur = [];
    vals.forEach(function (v, i) { if (v == null) { if (cur.length) segments.push(cur); cur = []; } else cur.push([i * step, y(v)]); });
    if (cur.length) segments.push(cur);
    const id = "ixg" + (++uid);
    const grid = [0.25, 0.5, 0.75].map(function (f) { const gy = (padT + (H - padT - padB) * f).toFixed(1); return '<line x1="0" y1="' + gy + '" x2="' + W + '" y2="' + gy + '" class="ix-area__grid"/>'; }).join("");
    const paths = segments.map(function (seg) {
      if (seg.length === 1) return '<circle cx="' + seg[0][0].toFixed(1) + '" cy="' + seg[0][1].toFixed(1) + '" r="2.2" class="ix-area__dot"/>';
      const d = smooth(seg);
      return '<path d="' + d + " L" + seg[seg.length - 1][0].toFixed(1) + " " + (H - padB) + " L" + seg[0][0].toFixed(1) + " " + (H - padB) + 'Z" fill="url(#' + id + ')" class="ix-area__fill"/><path d="' + d + '" class="ix-area__line"/>';
    }).join("");
    const fmt = opts.format || function (n) { return String(Math.round(n * 100) / 100); };
    const desc = (summary ? summary + ": " : "") + "latest " + fmt(real[real.length - 1]) + ", highest " + fmt(max);
    return '<div class="ix-area ix-tone-' + tone + '"><svg class="ix-area__svg" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(desc) + '">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" class="ix-stop ix-stop--a"/><stop offset="100%" class="ix-stop ix-stop--b"/></linearGradient></defs>' + grid + paths + "</svg>" + labels + "</div>";
  }

  /**
   * nodes: [{ id, x, y (0-100, percent of the canvas), label, sub, icon (path markup), tone, state: "active"|"idle"|"warn"|"bad", href }]
   * edges: [{ from, to, active }]
   * A node with href is a link (keyboard focusable, named by its label and sub text).
   */
  function graph(spec) {
    const W = spec.width || 720, H = spec.height || 420;
    const byId = {}; (spec.nodes || []).forEach(function (n) { byId[n.id] = n; });
    const px = function (n) { return [n.x / 100 * W, n.y / 100 * H]; };
    const edges = (spec.edges || []).map(function (e) {
      const a = byId[e.from], b = byId[e.to]; if (!a || !b) return "";
      const p = px(a), q = px(b), mx = (p[0] + q[0]) / 2, bend = (q[1] - p[1]) * 0.0 + ((p[1] + q[1]) / 2 < H / 2 ? -14 : 14);
      const d = "M" + p[0].toFixed(1) + " " + p[1].toFixed(1) + " Q" + mx.toFixed(1) + " " + ((p[1] + q[1]) / 2 + bend).toFixed(1) + " " + q[0].toFixed(1) + " " + q[1].toFixed(1);
      return '<path d="' + d + '" class="ix-edge' + (e.active ? " is-active" : "") + '"/>' + (e.active ? '<path d="' + d + '" class="ix-edge__flow"/>' : "");
    }).join("");
    const nodes = (spec.nodes || []).map(function (n) {
      const c = px(n), state = n.state || "idle", tone = n.tone || "accent";
      const name = n.label + (n.sub ? ", " + n.sub : "");
      const pad = '<g class="ix-pad ix-tone-' + tone + " is-" + state + '" transform="translate(' + c[0].toFixed(1) + " " + c[1].toFixed(1) + ')">' +
        '<ellipse class="ix-pad__glow" cx="0" cy="12" rx="34" ry="14"/><ellipse class="ix-pad__base" cx="0" cy="10" rx="27" ry="11"/><ellipse class="ix-pad__top" cx="0" cy="5" rx="27" ry="11"/>' +
        '<g class="ix-pad__icon" transform="translate(-10 -22) scale(0.83)" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (n.icon || "") + "</g>" +
        '<text class="ix-pad__label" x="0" y="38" text-anchor="middle">' + esc(n.label) + "</text>" +
        (n.sub ? '<text class="ix-pad__sub" x="0" y="50" text-anchor="middle">' + esc(n.sub) + "</text>" : "") + "</g>";
      return n.href ? '<a href="' + esc(n.href) + '" class="ix-node" aria-label="' + esc(name) + '">' + pad + "</a>" : '<g class="ix-node" role="img" aria-label="' + esc(name) + '">' + pad + "</g>";
    }).join("");
    return '<svg class="ix-graph" viewBox="0 0 ' + W + " " + H + '" role="group" aria-label="' + esc(spec.label || "Diagram") + '">' + edges + nodes + "</svg>";
  }

  /** Inner SVG markup (24x24, stroke icons) for graph nodes. */
  const icons = {
    goal: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    agent: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
    answer: '<path d="M20 6 9 17l-5-5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M8 13h8M8 17h6"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/>',
    calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h8"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-.4-.4-2.1z"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
    db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    disk: '<path d="M22 12H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1zM6 16h.01M10 16h.01"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    network: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8"/>'
  };

  D.viz = { area: area, graph: graph, icons: icons };
})();
