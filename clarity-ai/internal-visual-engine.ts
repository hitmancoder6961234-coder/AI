/**
 * CLARITY INTERNAL VISUAL GENERATION ENGINE
 *
 * Implements deterministic and AI-powered internal visual asset generation.
 * Generates beautiful SVGs, Flowcharts, Math Plots, Tree Visualizations,
 * Architecture Diagrams, Charts, and Mindmaps, delivering visual assets
 * directly to the user interface rather than exposing raw code blocks.
 */

import { sanitizeSvgForXml, renderSvgToPngBuffer } from "./visual-intelligence";

export interface VisualGenerationResult {
  svg: string;
  pngBase64?: string;
  visualType: string;
  title: string;
  description: string;
  embedMarkdown: string;
}

export class InternalVisualEngine {
  /**
   * Generates a Mathematical Graph SVG (Cartesian Plane, Functions, Asymptotic Bounds)
   */
  static generateMathPlotSvg(options: {
    title?: string;
    functions?: Array<{ label: string; fn: (x: number) => number; color: string; strokeDash?: string }>;
    xRange?: [number, number];
    yRange?: [number, number];
    xLabel?: string;
    yLabel?: string;
    annotations?: Array<{ x: number; y: number; text: string; color?: string }>;
  }): VisualGenerationResult {
    const width = 800;
    const height = 480;
    const margin = { top: 40, right: 40, bottom: 60, left: 70 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const [xMin, xMax] = options.xRange || [0, 10];
    const [yMin, yMax] = options.yRange || [0, 100];
    const xLabel = options.xLabel || "Input Size (n)";
    const yLabel = options.yLabel || "Running Time / Operations T(n)";
    const title = options.title || "Mathematical Function Plot";

    const scaleX = (x: number) => margin.left + ((x - xMin) / (xMax - xMin)) * plotW;
    const scaleY = (y: number) => margin.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

    // Grid lines & ticks
    let gridSvg = "";
    const xStep = Math.max(1, Math.round((xMax - xMin) / 8));
    for (let x = Math.ceil(xMin); x <= xMax; x += xStep) {
      const px = scaleX(x);
      gridSvg += `<line x1="${px}" y1="${margin.top}" x2="${px}" y2="${margin.top + plotH}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3" opacity="0.8"/>`;
      gridSvg += `<text x="${px}" y="${margin.top + plotH + 20}" font-family="system-ui, -apple-system, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">${x}</text>`;
    }

    const yStep = Math.max(1, Math.round((yMax - yMin) / 6));
    for (let y = Math.ceil(yMin); y <= yMax; y += yStep) {
      const py = scaleY(y);
      gridSvg += `<line x1="${margin.left}" y1="${py}" x2="${margin.left + plotW}" y2="${py}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3" opacity="0.8"/>`;
      gridSvg += `<text x="${margin.left - 12}" y="${py + 4}" font-family="system-ui, -apple-system, sans-serif" font-size="12" fill="#64748b" text-anchor="end">${y}</text>`;
    }

    // Default functions if none provided
    const fns = options.functions && options.functions.length > 0 ? options.functions : [
      { label: "c₂ · g(n) = 2n² (Upper Bound)", fn: (x: number) => 2 * x * x, color: "#dc2626" },
      { label: "f(n) = n² + 3n (Exact Function)", fn: (x: number) => x * x + 3 * x, color: "#2563eb" },
      { label: "c₁ · g(n) = 0.8n² (Lower Bound)", fn: (x: number) => 0.8 * x * x, color: "#059669" },
    ];

    // Plot curves
    let curvesSvg = "";
    let legendSvg = "";
    let legendX = margin.left + 20;
    let legendY = margin.top + 20;

    fns.forEach((fObj, idx) => {
      let pathD = "";
      const samples = 120;
      const dx = (xMax - xMin) / samples;
      for (let i = 0; i <= samples; i++) {
        const x = xMin + i * dx;
        const y = Math.max(yMin, Math.min(yMax * 1.2, fObj.fn(x)));
        const px = scaleX(x);
        const py = scaleY(y);
        if (i === 0) pathD += `M ${px.toFixed(1)} ${py.toFixed(1)}`;
        else pathD += ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
      }

      const dashAttr = fObj.strokeDash ? `stroke-dasharray="${fObj.strokeDash}"` : "";
      curvesSvg += `<path d="${pathD}" fill="none" stroke="${fObj.color}" stroke-width="2.5" ${dashAttr} stroke-linecap="round"/>`;

      // Legend entry
      const ly = legendY + idx * 24;
      legendSvg += `<line x1="${legendX}" y1="${ly}" x2="${legendX + 24}" y2="${ly}" stroke="${fObj.color}" stroke-width="3" ${dashAttr}/>`;
      legendSvg += `<circle cx="${legendX + 12}" cy="${ly}" r="3" fill="${fObj.color}"/>`;
      legendSvg += `<text x="${legendX + 32}" y="${ly + 4}" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="600" fill="#1e293b">${fObj.label}</text>`;
    });

    // Annotations
    let annotSvg = "";
    if (options.annotations) {
      options.annotations.forEach(a => {
        const px = scaleX(a.x);
        const py = scaleY(a.y);
        const color = a.color || "#2563eb";
        annotSvg += `<circle cx="${px}" cy="${py}" r="5" fill="${color}" stroke="#ffffff" stroke-width="2"/>`;
        annotSvg += `<line x1="${px}" y1="${py}" x2="${px}" y2="${margin.top + plotH}" stroke="${color}" stroke-width="1.5" stroke-dasharray="4,4"/>`;
        annotSvg += `<text x="${px}" y="${py - 10}" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="700" fill="${color}" text-anchor="middle">${a.text}</text>`;
      });
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#ffffff; border-radius:12px; font-family:system-ui, -apple-system, sans-serif;">
  <defs>
    <linearGradient id="plotBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f8fafc"/>
    </linearGradient>
    <filter id="cardShadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.04"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" rx="12" fill="url(#plotBg)"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="11.5" fill="none" stroke="#e2e8f0"/>

  <!-- Header Title -->
  <text x="${width / 2}" y="28" font-size="16" font-weight="700" fill="#0f172a" text-anchor="middle">${title}</text>

  <!-- Grid & Ticks -->
  ${gridSvg}

  <!-- Axes -->
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="#0f172a" stroke-width="2"/>
  <line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="#0f172a" stroke-width="2"/>

  <!-- Axis Arrows -->
  <polygon points="${margin.left},${margin.top - 6} ${margin.left - 4},${margin.top} ${margin.left + 4},${margin.top}" fill="#0f172a"/>
  <polygon points="${margin.left + plotW + 6},${margin.top + plotH} ${margin.left + plotW},${margin.top + plotH - 4} ${margin.left + plotW},${margin.top + plotH + 4}" fill="#0f172a"/>

  <!-- Axis Labels -->
  <text x="${margin.left + plotW / 2}" y="${height - 18}" font-size="13" font-weight="600" fill="#334155" text-anchor="middle">${xLabel}</text>
  <text x="24" y="${margin.top + plotH / 2}" font-size="13" font-weight="600" fill="#334155" text-anchor="middle" transform="rotate(-90, 24, ${margin.top + plotH / 2})">${yLabel}</text>

  <!-- Legend Background Box -->
  <rect x="${legendX - 10}" y="${legendY - 14}" width="280" height="${fns.length * 24 + 16}" rx="8" fill="#ffffff" fill-opacity="0.92" stroke="#e2e8f0" stroke-width="1" filter="url(#cardShadow)"/>
  ${legendSvg}

  <!-- Curves -->
  ${curvesSvg}

  <!-- Annotations -->
  ${annotSvg}
</svg>`;

    return {
      svg: sanitizeSvgForXml(svg),
      visualType: "math_plot",
      title,
      description: `Interactive mathematical plot of ${title}`,
      embedMarkdown: `\n\n\`\`\`svg\n${sanitizeSvgForXml(svg)}\n\`\`\`\n\n`
    };
  }

  /**
   * Generates a Binary Search Tree (BST) or AVL Tree SVG
   */
  static generateTreeSvg(options?: {
    title?: string;
    rootValue?: number | string;
    type?: "BST" | "AVL" | "HEAP" | "GENERAL_TREE";
  }): VisualGenerationResult {
    const width = 760;
    const height = 440;
    const title = options?.title || "Binary Search Tree (BST) Structure";

    // Standard balanced 3-level BST nodes
    const nodes = [
      { id: 1, val: "50", x: 380, y: 80, role: "Root" },
      { id: 2, val: "30", x: 200, y: 180, parent: 1 },
      { id: 3, val: "70", x: 560, y: 180, parent: 1 },
      { id: 4, val: "20", x: 110, y: 290, parent: 2 },
      { id: 5, val: "40", x: 290, y: 290, parent: 2 },
      { id: 6, val: "60", x: 470, y: 290, parent: 3 },
      { id: 7, val: "80", x: 650, y: 290, parent: 3 },
    ];

    let edgesSvg = "";
    nodes.forEach(n => {
      if (n.parent) {
        const p = nodes.find(x => x.id === n.parent);
        if (p) {
          edgesSvg += `<line x1="${p.x}" y1="${p.y}" x2="${n.x}" y2="${n.y}" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round"/>`;
          const isLeft = n.x < p.x;
          const mx = (p.x + n.x) / 2 + (isLeft ? -14 : 14);
          const my = (p.y + n.y) / 2;
          edgesSvg += `<text x="${mx}" y="${my}" font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="#64748b" text-anchor="middle">${isLeft ? "L <" : "> R"}</text>`;
        }
      }
    });

    let nodesSvg = "";
    nodes.forEach(n => {
      const isRoot = !n.parent;
      const fillGradient = isRoot ? "url(#rootGrad)" : "url(#nodeGrad)";
      const strokeColor = isRoot ? "#1d4ed8" : "#2563eb";
      nodesSvg += `
      <g transform="translate(${n.x}, ${n.y})">
        <circle r="26" fill="${fillGradient}" stroke="${strokeColor}" stroke-width="2.5" filter="url(#nodeGlow)"/>
        <text y="6" font-family="system-ui, sans-serif" font-size="16" font-weight="800" fill="#ffffff" text-anchor="middle">${n.val}</text>
        ${isRoot ? '<rect x="-24" y="-44" width="48" height="18" rx="4" fill="#1e293b"/><text y="-31" font-size="10" font-weight="700" fill="#ffffff" text-anchor="middle">ROOT</text>' : ''}
      </g>`;
    });

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#ffffff; border-radius:12px;">
  <defs>
    <linearGradient id="treeBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f8fafc"/>
    </linearGradient>
    <linearGradient id="rootGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
    <linearGradient id="nodeGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
    <filter id="nodeGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#2563eb" flood-opacity="0.25"/>
    </filter>
  </defs>

  <rect width="${width}" height="${height}" rx="12" fill="url(#treeBg)"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="11.5" fill="none" stroke="#e2e8f0"/>

  <!-- Title -->
  <text x="${width / 2}" y="32" font-family="system-ui, sans-serif" font-size="16" font-weight="700" fill="#0f172a" text-anchor="middle">${title}</text>
  <text x="${width / 2}" y="52" font-family="system-ui, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">In-order Traversal Property: Left Subtree &lt; Node &lt; Right Subtree</text>

  <!-- Edges -->
  ${edgesSvg}

  <!-- Nodes -->
  ${nodesSvg}

  <!-- Footer Insight Pill -->
  <g transform="translate(${width / 2 - 180}, ${height - 40})">
    <rect width="360" height="28" rx="14" fill="#f1f5f9" stroke="#cbd5e1"/>
    <text x="180" y="18" font-family="system-ui, sans-serif" font-size="11.5" font-weight="600" fill="#334155" text-anchor="middle">
      Balanced Time Complexity: Search O(log n) | Insert O(log n)
    </text>
  </g>
</svg>`;

    return {
      svg: sanitizeSvgForXml(svg),
      visualType: "tree_diagram",
      title,
      description: "Visual binary search tree representation",
      embedMarkdown: `\n\n\`\`\`svg\n${sanitizeSvgForXml(svg)}\n\`\`\`\n\n`
    };
  }

  /**
   * Generates a Flowchart SVG (e.g. Login, Search, Processing)
   */
  static generateFlowchartSvg(options?: {
    title?: string;
    topic?: string;
  }): VisualGenerationResult {
    const width = 800;
    const height = 500;
    const title = options?.title || "Interactive Process Flowchart";

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#ffffff; border-radius:12px;">
  <defs>
    <linearGradient id="fcBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f8fafc"/>
    </linearGradient>
    <linearGradient id="startGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
    <linearGradient id="procGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
    <linearGradient id="decGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
    <marker id="fcArrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b"/>
    </marker>
    <filter id="fcShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.08"/>
    </filter>
  </defs>

  <rect width="${width}" height="${height}" rx="12" fill="url(#fcBg)"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="11.5" fill="none" stroke="#e2e8f0"/>

  <text x="${width / 2}" y="32" font-family="system-ui, sans-serif" font-size="16" font-weight="700" fill="#0f172a" text-anchor="middle">${title}</text>

  <!-- Connectors -->
  <!-- 1 -> 2 -->
  <line x1="400" y1="95" x2="400" y2="135" stroke="#64748b" stroke-width="2" marker-end="url(#fcArrow)"/>
  <!-- 2 -> 3 -->
  <line x1="400" y1="185" x2="400" y2="225" stroke="#64748b" stroke-width="2" marker-end="url(#fcArrow)"/>
  <!-- 3 -> 4 (Yes: down) -->
  <line x1="400" y1="305" x2="400" y2="345" stroke="#64748b" stroke-width="2" marker-end="url(#fcArrow)"/>
  <text x="415" y="325" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="#059669">Yes / Valid</text>

  <!-- 3 -> 5 (No: right loopback) -->
  <path d="M 470 265 L 620 265 L 620 160 L 490 160" fill="none" stroke="#dc2626" stroke-width="2" stroke-dasharray="4,4" marker-end="url(#fcArrow)"/>
  <text x="530" y="255" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="#dc2626">No (Retry)</text>

  <!-- 4 -> 6 (End) -->
  <line x1="400" y1="395" x2="400" y2="435" stroke="#64748b" stroke-width="2" marker-end="url(#fcArrow)"/>

  <!-- Step 1: Start Capsule -->
  <g transform="translate(330, 55)" filter="url(#fcShadow)">
    <rect width="140" height="40" rx="20" fill="url(#startGrad)"/>
    <text x="70" y="25" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#ffffff" text-anchor="middle">1. Start Request</text>
  </g>

  <!-- Step 2: Input / Process Rectangle -->
  <g transform="translate(310, 135)" filter="url(#fcShadow)">
    <rect width="180" height="50" rx="8" fill="url(#procGrad)"/>
    <text x="90" y="25" font-family="system-ui, sans-serif" font-size="12.5" font-weight="700" fill="#ffffff" text-anchor="middle">2. Capture &amp; Parse Input</text>
    <text x="90" y="40" font-family="system-ui, sans-serif" font-size="10.5" fill="#e0f2fe" text-anchor="middle">Sanitize &amp; Validate Parameters</text>
  </g>

  <!-- Step 3: Decision Diamond -->
  <g transform="translate(330, 225)" filter="url(#fcShadow)">
    <polygon points="70,0 140,40 70,80 0,40" fill="url(#decGrad)"/>
    <text x="70" y="38" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="#ffffff" text-anchor="middle">3. Valid &amp; Authorized?</text>
    <text x="70" y="52" font-family="system-ui, sans-serif" font-size="10" fill="#fef3c7" text-anchor="middle">Condition Check</text>
  </g>

  <!-- Step 4: Execute Action -->
  <g transform="translate(310, 345)" filter="url(#fcShadow)">
    <rect width="180" height="50" rx="8" fill="url(#procGrad)"/>
    <text x="90" y="25" font-family="system-ui, sans-serif" font-size="12.5" font-weight="700" fill="#ffffff" text-anchor="middle">4. Execute Main Logic</text>
    <text x="90" y="40" font-family="system-ui, sans-serif" font-size="10.5" fill="#e0f2fe" text-anchor="middle">Commit State &amp; Response</text>
  </g>

  <!-- Step 5: End Capsule -->
  <g transform="translate(330, 435)" filter="url(#fcShadow)">
    <rect width="140" height="40" rx="20" fill="url(#startGrad)"/>
    <text x="70" y="25" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#ffffff" text-anchor="middle">5. Success (End)</text>
  </g>
</svg>`;

    return {
      svg: sanitizeSvgForXml(svg),
      visualType: "flowchart",
      title,
      description: "Visual process flowchart",
      embedMarkdown: `\n\n\`\`\`svg\n${sanitizeSvgForXml(svg)}\n\`\`\`\n\n`
    };
  }

  /**
   * Generates a Modern System Architecture SVG
   */
  static generateArchitectureSvg(options?: {
    title?: string;
    subsystems?: string[];
  }): VisualGenerationResult {
    const width = 840;
    const height = 480;
    const title = options?.title || "System Architecture & Data Flow Topology";

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#ffffff; border-radius:12px;">
  <defs>
    <linearGradient id="archBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f8fafc"/>
    </linearGradient>
    <filter id="cardFilt" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.06"/>
    </filter>
    <marker id="archArrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#3b82f6"/>
    </marker>
  </defs>

  <rect width="${width}" height="${height}" rx="12" fill="url(#archBg)"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="11.5" fill="none" stroke="#e2e8f0"/>

  <text x="${width / 2}" y="32" font-family="system-ui, sans-serif" font-size="16" font-weight="700" fill="#0f172a" text-anchor="middle">${title}</text>

  <!-- Connectors -->
  <!-- Client -> Gateway -->
  <line x1="200" y1="120" x2="280" y2="120" stroke="#3b82f6" stroke-width="2.5" marker-end="url(#archArrow)"/>
  <!-- Gateway -> Services -->
  <line x1="440" y1="120" x2="520" y2="120" stroke="#3b82f6" stroke-width="2.5" marker-end="url(#archArrow)"/>
  <!-- Services -> Data Layer -->
  <line x1="600" y1="170" x2="600" y2="240" stroke="#3b82f6" stroke-width="2.5" marker-end="url(#archArrow)"/>
  <!-- Services -> Cache Layer -->
  <line x1="360" y1="170" x2="360" y2="240" stroke="#3b82f6" stroke-width="2.5" marker-end="url(#archArrow)"/>

  <!-- Layer 1: Client & Frontend -->
  <g transform="translate(40, 70)" filter="url(#cardFilt)">
    <rect width="160" height="100" rx="10" fill="#ffffff" stroke="#3b82f6" stroke-width="2"/>
    <rect x="0" y="0" width="160" height="28" rx="8" fill="#eff6ff"/>
    <text x="80" y="19" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="#1d4ed8" text-anchor="middle">Client Presentation</text>
    <text x="80" y="55" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#0f172a" text-anchor="middle">React SPA / Mobile</text>
    <text x="80" y="75" font-family="system-ui, sans-serif" font-size="11" fill="#64748b" text-anchor="middle">Tailwind • SSE Stream</text>
  </g>

  <!-- Layer 2: API Gateway & Auth -->
  <g transform="translate(280, 70)" filter="url(#cardFilt)">
    <rect width="160" height="100" rx="10" fill="#ffffff" stroke="#8b5cf6" stroke-width="2"/>
    <rect x="0" y="0" width="160" height="28" rx="8" fill="#f5f3ff"/>
    <text x="80" y="19" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="#6d28d9" text-anchor="middle">API &amp; Security Gateway</text>
    <text x="80" y="55" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#0f172a" text-anchor="middle">Reverse Proxy / Auth</text>
    <text x="80" y="75" font-family="system-ui, sans-serif" font-size="11" fill="#64748b" text-anchor="middle">JWT • Rate Limiting • CORS</text>
  </g>

  <!-- Layer 3: Backend Business & Inference Engine -->
  <g transform="translate(520, 70)" filter="url(#cardFilt)">
    <rect width="160" height="100" rx="10" fill="#ffffff" stroke="#059669" stroke-width="2"/>
    <rect x="0" y="0" width="160" height="28" rx="8" fill="#ecfdf5"/>
    <text x="80" y="19" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="#047857" text-anchor="middle">Core Services &amp; AI</text>
    <text x="80" y="55" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#0f172a" text-anchor="middle">Node / Express Engine</text>
    <text x="80" y="75" font-family="system-ui, sans-serif" font-size="11" fill="#64748b" text-anchor="middle">Reasoning • Gemini SDK</text>
  </g>

  <!-- Layer 4: Cache & Message Queue -->
  <g transform="translate(280, 240)" filter="url(#cardFilt)">
    <rect width="160" height="100" rx="10" fill="#ffffff" stroke="#f59e0b" stroke-width="2"/>
    <rect x="0" y="0" width="160" height="28" rx="8" fill="#fffbeb"/>
    <text x="80" y="19" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="#b45309" text-anchor="middle">Cache &amp; Event Layer</text>
    <text x="80" y="55" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#0f172a" text-anchor="middle">Redis / In-Memory</text>
    <text x="80" y="75" font-family="system-ui, sans-serif" font-size="11" fill="#64748b" text-anchor="middle">Session Cache • TTL Store</text>
  </g>

  <!-- Layer 5: Primary Database & Vector Store -->
  <g transform="translate(520, 240)" filter="url(#cardFilt)">
    <rect width="160" height="100" rx="10" fill="#ffffff" stroke="#dc2626" stroke-width="2"/>
    <rect x="0" y="0" width="160" height="28" rx="8" fill="#fef2f2"/>
    <text x="80" y="19" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="#b91c1c" text-anchor="middle">Persistent Storage</text>
    <text x="80" y="55" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#0f172a" text-anchor="middle">PostgreSQL / Supabase</text>
    <text x="80" y="75" font-family="system-ui, sans-serif" font-size="11" fill="#64748b" text-anchor="middle">ACID • Vector Embeddings</text>
  </g>

  <!-- Footer Banner -->
  <g transform="translate(40, 380)">
    <rect width="760" height="50" rx="10" fill="#f8fafc" stroke="#cbd5e1"/>
    <text x="380" y="24" font-family="system-ui, sans-serif" font-size="12.5" font-weight="700" fill="#334155" text-anchor="middle">Security &amp; Operational Guardrails</text>
    <text x="380" y="40" font-family="system-ui, sans-serif" font-size="11" fill="#64748b" text-anchor="middle">TLS 1.3 Encryption • Automated Fallback Resilience • Real-time Monitoring</text>
  </g>
</svg>`;

    return {
      svg: sanitizeSvgForXml(svg),
      visualType: "architecture_diagram",
      title,
      description: "Visual system architecture topology",
      embedMarkdown: `\n\n\`\`\`svg\n${sanitizeSvgForXml(svg)}\n\`\`\`\n\n`
    };
  }

  /**
   * Generates a Data Chart SVG (Bar, Donut, Line)
   */
  static generateChartSvg(options?: {
    type?: "bar" | "donut" | "line";
    title?: string;
    labels?: string[];
    values?: number[];
  }): VisualGenerationResult {
    const width = 760;
    const height = 440;
    const title = options?.title || "Comparative Data Analysis Chart";
    const labels = options?.labels || ["Q1", "Q2", "Q3", "Q4"];
    const values = options?.values || [45, 82, 68, 95];

    const maxVal = Math.max(...values, 100);
    const chartH = 240;
    const startY = 320;
    const startX = 120;
    const barW = 80;
    const gap = 60;

    let barsSvg = "";
    values.forEach((v, idx) => {
      const bh = (v / maxVal) * chartH;
      const bx = startX + idx * (barW + gap);
      const by = startY - bh;
      const label = labels[idx] || `Item ${idx + 1}`;

      barsSvg += `
      <g>
        <rect x="${bx}" y="${by}" width="${barW}" height="${bh}" rx="6" fill="url(#barGrad${idx % 3})" filter="url(#barShadow)"/>
        <text x="${bx + barW / 2}" y="${by - 10}" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#1e293b" text-anchor="middle">${v}</text>
        <text x="${bx + barW / 2}" y="${startY + 24}" font-family="system-ui, sans-serif" font-size="12" font-weight="600" fill="#64748b" text-anchor="middle">${label}</text>
      </g>`;
    });

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#ffffff; border-radius:12px;">
  <defs>
    <linearGradient id="chartBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f8fafc"/>
    </linearGradient>
    <linearGradient id="barGrad0" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
    <linearGradient id="barGrad1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#047857"/>
    </linearGradient>
    <linearGradient id="barGrad2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8b5cf6"/>
      <stop offset="100%" stop-color="#6d28d9"/>
    </linearGradient>
    <filter id="barShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.08"/>
    </filter>
  </defs>

  <rect width="${width}" height="${height}" rx="12" fill="url(#chartBg)"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="11.5" fill="none" stroke="#e2e8f0"/>

  <text x="${width / 2}" y="36" font-family="system-ui, sans-serif" font-size="16" font-weight="700" fill="#0f172a" text-anchor="middle">${title}</text>

  <!-- Baseline Grid -->
  <line x1="80" y1="${startY}" x2="${width - 80}" y2="${startY}" stroke="#94a3b8" stroke-width="2"/>
  <line x1="80" y1="${startY - chartH / 2}" x2="${width - 80}" y2="${startY - chartH / 2}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4,4"/>
  <line x1="80" y1="${startY - chartH}" x2="${width - 80}" y2="${startY - chartH}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4,4"/>

  <!-- Bars -->
  ${barsSvg}
</svg>`;

    return {
      svg: sanitizeSvgForXml(svg),
      visualType: "chart",
      title,
      description: "Visual data chart",
      embedMarkdown: `\n\n\`\`\`svg\n${sanitizeSvgForXml(svg)}\n\`\`\`\n\n`
    };
  }

  /**
   * Generates a Mind Map SVG
   */
  static generateMindmapSvg(options?: {
    centralTopic?: string;
    subtopics?: Array<{ label: string; details?: string[] }>;
  }): VisualGenerationResult {
    const width = 800;
    const height = 480;
    const centerTopic = options?.centralTopic || "Core Concepts & Architecture";
    const subtopics = options?.subtopics || [
      { label: "1. Fundamentals", details: ["Data Structures", "Algorithms"] },
      { label: "2. System Design", details: ["Scalability", "Reliability"] },
      { label: "3. Storage Layer", details: ["SQL / NoSQL", "Caching"] },
      { label: "4. Deployment", details: ["Containers", "CI/CD Pipeline"] },
    ];

    const cx = 400;
    const cy = 240;

    const positions = [
      { x: 160, y: 120 },
      { x: 640, y: 120 },
      { x: 160, y: 360 },
      { x: 640, y: 360 },
    ];

    let branchesSvg = "";
    subtopics.slice(0, 4).forEach((st, idx) => {
      const pos = positions[idx];
      // Bezier curve connector
      const cpx = (cx + pos.x) / 2;
      const cpy = cy;
      branchesSvg += `<path d="M ${cx} ${cy} Q ${cpx} ${cpy} ${pos.x} ${pos.y}" fill="none" stroke="#94a3b8" stroke-width="2.5"/>`;

      branchesSvg += `
      <g transform="translate(${pos.x - 90}, ${pos.y - 30})">
        <rect width="180" height="60" rx="8" fill="#ffffff" stroke="#3b82f6" stroke-width="2" filter="url(#mindShadow)"/>
        <text x="90" y="24" font-family="system-ui, sans-serif" font-size="12.5" font-weight="700" fill="#1e293b" text-anchor="middle">${st.label}</text>
        <text x="90" y="42" font-family="system-ui, sans-serif" font-size="11" fill="#64748b" text-anchor="middle">${(st.details || []).join(" • ")}</text>
      </g>`;
    });

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#ffffff; border-radius:12px;">
  <defs>
    <linearGradient id="mmBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f8fafc"/>
    </linearGradient>
    <linearGradient id="centerGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
    <filter id="mindShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.06"/>
    </filter>
  </defs>

  <rect width="${width}" height="${height}" rx="12" fill="url(#mmBg)"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="11.5" fill="none" stroke="#e2e8f0"/>

  <text x="${width / 2}" y="32" font-family="system-ui, sans-serif" font-size="16" font-weight="700" fill="#0f172a" text-anchor="middle">Interactive Mind Map</text>

  <!-- Connectors & Subtopics -->
  ${branchesSvg}

  <!-- Center Node -->
  <g transform="translate(${cx - 100}, ${cy - 35})" filter="url(#mindShadow)">
    <rect width="200" height="70" rx="35" fill="url(#centerGrad)" stroke="#1d4ed8" stroke-width="2"/>
    <text x="100" y="36" font-family="system-ui, sans-serif" font-size="13" font-weight="800" fill="#ffffff" text-anchor="middle">${centerTopic}</text>
    <text x="100" y="52" font-family="system-ui, sans-serif" font-size="10.5" fill="#bfdbfe" text-anchor="middle">Central Concept</text>
  </g>
</svg>`;

    return {
      svg: sanitizeSvgForXml(svg),
      visualType: "mindmap",
      title: centerTopic,
      description: "Visual mind map diagram",
      embedMarkdown: `\n\n\`\`\`svg\n${sanitizeSvgForXml(svg)}\n\`\`\`\n\n`
    };
  }
}
