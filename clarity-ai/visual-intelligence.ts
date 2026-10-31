import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { ProjectAnalysis, ExtractedFile } from "./project-analyzer";
import { 
  renderProfessionalArchitectureSvg, 
  renderProfessionalWorkflowSvg, 
  renderProfessionalRagArchitectureSvg, 
  renderProfessionalFileArchitectureSvg 
} from "./architecture-diagram-renderer";
import { resolveArchitectureIcon } from "./architecture-icon-registry";

export interface DetectedScreenshot {
  id: string;
  path: string;
  name: string;
  category: "dashboard" | "login" | "architecture" | "rag_search" | "ui" | "result_screen" | "general";
  description: string;
  mimeType: string;
  bufferBase64: string;
}

export interface ProjectVisualIntelligence {
  screenshots: DetectedScreenshot[];
  architecturePng: Buffer;
  workflowPng: Buffer;
  ragPipelinePng: Buffer;
  techStackPng: Buffer;
}

export function sanitizeSvgForXml(svgString: string): string {
  if (!svgString) return "";
  // Escape raw unescaped ampersands in XML text nodes so SVG parsers don't throw xmlParseEntityRef errors
  let clean = svgString.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#[0-9]+;|#x[0-9a-fA-F]+;)/g, "&amp;");

  // Resolve custom CSS variables to explicit hex colors for SVG renderers
  clean = clean
    .replace(/var\(--[a-zA-Z0-9-]+,\s*(#?[a-fA-F0-9]+)\)/g, "$1")
    .replace(/var\(--surface-muted\)/g, "#f8fafc")
    .replace(/var\(--surface\)/g, "#ffffff")
    .replace(/var\(--ink-muted\)/g, "#64748b")
    .replace(/var\(--ink\)/g, "#0f172a")
    .replace(/var\(--accent\)/g, "#2563eb")
    .replace(/var\(--line\)/g, "#e2e8f0");

  return clean;
}

/**
 * Render any SVG string into a high-res PNG Buffer using sharp / resvg
 */
export async function renderSvgToPngBuffer(svgString: string, width = 1920): Promise<Buffer> {
  const cleanSvg = sanitizeSvgForXml(svgString);

  try {
    const buf = await sharp(Buffer.from(cleanSvg))
      .resize(width)
      .png()
      .toBuffer();
    if (buf && buf.length > 0) return buf;
  } catch (err) {
    console.error("sharp PNG render error, trying resvg fallback:", err);
  }

  try {
    const resvg = new Resvg(cleanSvg, {
      fitTo: { mode: "width", value: width },
    });
    const pngData = resvg.render();
    const buf = pngData.asPng();
    if (buf && buf.length > 0) return buf;
  } catch (err) {
    console.error("resvg rendering error:", err);
  }

  return Buffer.from("");
}

/**
 * Render any SVG string into a high-quality JPG Buffer using sharp
 */
export async function renderSvgToJpgBuffer(svgString: string, width = 1920, quality = 92): Promise<Buffer> {
  const cleanSvg = sanitizeSvgForXml(svgString);

  try {
    const buf = await sharp(Buffer.from(cleanSvg))
      .resize(width)
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, chromaSubsampling: '4:4:4' })
      .toBuffer();
    if (buf && buf.length > 0) return buf;
  } catch (err) {
    console.error("sharp JPG render error:", err);
  }

  try {
    const pngBuffer = await renderSvgToPngBuffer(svgString, width);
    if (pngBuffer && pngBuffer.length > 0) {
      return await sharp(pngBuffer)
        .flatten({ background: '#ffffff' })
        .jpeg({ quality, chromaSubsampling: '4:4:4' })
        .toBuffer();
    }
  } catch (err) {
    console.error("JPG fallback rendering error:", err);
  }

  return Buffer.from("");
}

/**
 * Detect real project screenshots / UI assets from extracted project files
 */
export function detectProjectScreenshots(files: ExtractedFile[]): DetectedScreenshot[] {
  const safeFiles = Array.isArray(files) ? files : [];
  const imageExts = [".png", ".jpg", ".jpeg", ".webp", ".svg"];
  const screenshots: DetectedScreenshot[] = [];

  for (const f of safeFiles) {
    if (!f) continue;
    const ext = (f.extension || "").toLowerCase();
    if (!imageExts.includes(ext)) continue;

    const lowerPath = (f.path || "").toLowerCase();
    const isAsset = lowerPath.includes("screenshot") || lowerPath.includes("assets") || lowerPath.includes("public") || lowerPath.includes("ui") || lowerPath.includes("docs") || lowerPath.includes("img");
    
    if (!isAsset && safeFiles.length > 50) continue;

    let category: DetectedScreenshot["category"] = "general";
    let desc = "Application visual asset";

    if (lowerPath.includes("dash") || lowerPath.includes("home") || lowerPath.includes("overview")) {
      category = "dashboard";
      desc = "Project Dashboard Interface";
    } else if (lowerPath.includes("auth") || lowerPath.includes("login") || lowerPath.includes("sign")) {
      category = "login";
      desc = "Authentication Screen";
    } else if (lowerPath.includes("arch") || lowerPath.includes("diagram") || lowerPath.includes("schema") || lowerPath.includes("flow")) {
      category = "architecture";
      desc = "System Architecture Diagram Asset";
    } else if (lowerPath.includes("search") || lowerPath.includes("rag") || lowerPath.includes("chat") || lowerPath.includes("query")) {
      category = "rag_search";
      desc = "Interactive Knowledge & RAG Interface";
    } else if (lowerPath.includes("result") || lowerPath.includes("report") || lowerPath.includes("output")) {
      category = "result_screen";
      desc = "Analysis Result View";
    } else if (lowerPath.includes("ui") || lowerPath.includes("app") || lowerPath.includes("screen")) {
      category = "ui";
      desc = "User Interface Screen";
    }

    const mimeMap: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
    };

    let base64 = "";
    if (f.buffer) {
      base64 = f.buffer.toString("base64");
    } else if (f.content) {
      if (ext === ".svg") {
        base64 = Buffer.from(f.content).toString("base64");
      } else {
        base64 = Buffer.from(f.content, "utf-8").toString("base64");
      }
    }

    if (base64) {
      screenshots.push({
        id: `scr_${Math.random().toString(36).substring(2, 9)}`,
        path: f.path,
        name: f.name,
        category,
        description: desc,
        mimeType: mimeMap[ext] || "image/png",
        bufferBase64: base64,
      });
    }
  }

  return screenshots;
}

function escapeSvgXml(str: string): string {
  if (!str) return "";
  return str.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}

function getTechIconSvg(type: string, tech: string, label: string): string {
  const t = (type || "").toLowerCase();
  const tc = (tech || "").toLowerCase();
  const lbl = (label || "").toLowerCase();

  if (tc.includes("python") || lbl.includes("python") || lbl.endsWith(".py")) {
    return `
      <g transform="translate(10, 10) scale(1.1)">
        <path d="M14.25 1.5c-4.14 0-4.5 1.8-4.5 1.8l.01 1.85h4.5a1.5 1.5 0 1 1 0 3h-6.8s-2.96 0-2.96 4.1c0 4.1 2.5 4.3 2.5 4.3h1.5v-2.1c0-2.4 2-2.5 2.5-2.5h6.8c1.65 0 3-1.35 3-3V4.5c0-1.65-1.35-3-3-3zm-1.5 1.25a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z" fill="#3776AB"/>
        <path d="M9.75 22.5c4.14 0 4.5-1.8 4.5-1.8l-.01-1.85h-4.5a1.5 1.5 0 1 1 0-3h6.8s2.96 0 2.96-4.1c0-4.1-2.5-4.3-2.5-4.3h-1.5v2.1c0 2.4-2 2.5-2.5 2.5H6.2c-1.65 0-3 1.35-3 3V19.5c0 1.65 1.35 3 3 3zm1.5-1.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0-1.5z" fill="#FFD43B"/>
      </g>
    `;
  }
  if (tc.includes("react") || lbl.includes("react") || lbl.endsWith(".tsx") || lbl.endsWith(".jsx")) {
    return `
      <g transform="translate(22, 22) scale(1.1)">
        <ellipse rx="12" ry="4.5" fill="none" stroke="#2563EB" stroke-width="1.5" transform="rotate(0)"/>
        <ellipse rx="12" ry="4.5" fill="none" stroke="#2563EB" stroke-width="1.5" transform="rotate(60)"/>
        <ellipse rx="12" ry="4.5" fill="none" stroke="#2563EB" stroke-width="1.5" transform="rotate(120)"/>
        <circle r="2.5" fill="#2563EB"/>
      </g>
    `;
  }
  if (tc.includes("node") || tc.includes("express") || lbl.includes("express") || t.includes("backend") || t.includes("server")) {
    return `
      <g transform="translate(10, 10) scale(1.1)">
        <path d="M12 2L4 6.5v9L12 20l8-4.5v-9L12 2z" fill="none" stroke="#16A34A" stroke-width="2"/>
        <path d="M12 2v18" stroke="#16A34A" stroke-width="1.25" stroke-dasharray="2 2"/>
        <circle cx="12" cy="11" r="4.5" fill="#16A34A"/>
      </g>
    `;
  }
  if (t === "user" || lbl.includes("user") || lbl.includes("client")) {
    return `
      <g transform="translate(10, 10) scale(1.1)">
        <circle cx="12" cy="8" r="4" fill="none" stroke="#2563EB" stroke-width="2"/>
        <path d="M4 20c0-4 4-5 8-5s8 1 8 5" fill="none" stroke="#2563EB" stroke-width="2"/>
      </g>
    `;
  }
  if (t.includes("db") || t.includes("database") || t.includes("table") || tc.includes("postgres") || tc.includes("mysql") || tc.includes("mongo") || tc.includes("sql") || lbl.includes("db") || lbl.includes("schema")) {
    return `
      <g transform="translate(10, 10) scale(1.1)">
        <path d="M4 6c0-2.2 8-2.2 8-2.2s8 0 8 2.2v12c0 2.2-8 2.2-8 2.2s-8 0-8-2.2V6z" fill="none" stroke="#D97706" stroke-width="2"/>
        <path d="M4 6c0 2.2 8 2.2 8 2.2s8-0.1 8-2.2" fill="none" stroke="#D97706" stroke-width="1.75"/>
        <path d="M4 12c0 2.2 8 2.2 8 2.2s8-0.1 8-2.2" fill="none" stroke="#D97706" stroke-width="1.75"/>
      </g>
    `;
  }
  if (t === "auth" || lbl.includes("auth") || lbl.includes("login") || lbl.includes("jwt")) {
    return `
      <g transform="translate(10, 10) scale(1.1)">
        <rect x="4" y="10" width="16" height="10" rx="2" fill="none" stroke="#DB2777" stroke-width="2"/>
        <path d="M8 10V6a4 4 0 1 1 8 0v4" fill="none" stroke="#DB2777" stroke-width="1.75"/>
        <circle cx="12" cy="15" r="1.5" fill="#DB2777"/>
      </g>
    `;
  }
  if (t === "api" || t === "route" || lbl.includes("api") || lbl.includes("route")) {
    return `
      <g transform="translate(10, 10) scale(1.1)">
        <circle cx="6" cy="12" r="3.5" fill="#4F46E5"/>
        <circle cx="18" cy="6" r="3.5" fill="#4F46E5"/>
        <circle cx="18" cy="18" r="3.5" fill="#4F46E5"/>
        <line x1="6" y1="12" x2="18" y2="6" stroke="#4F46E5" stroke-width="1.75"/>
        <line x1="6" y1="12" x2="18" y2="18" stroke="#4F46E5" stroke-width="1.75"/>
      </g>
    `;
  }
  if (t === "external" || lbl.includes("external") || lbl.includes("cloud") || lbl.includes("aws") || lbl.includes("google") || lbl.includes("stripe")) {
    return `
      <g transform="translate(10, 10) scale(1.1)">
        <path d="M18.4 12.2a4 4 0 0 0-7.5-2 5 5 0 0 0-8.4 3.8A4 4 0 0 0 6 22h12a4.4 4.4 0 0 0 4.4-4.4 4 4 0 0 0-4-5.4z" fill="none" stroke="#0284C7" stroke-width="2"/>
      </g>
    `;
  }
  if (lbl.endsWith(".html") || lbl.endsWith(".htm") || lbl.includes("html")) {
    return `
      <g transform="translate(10, 10) scale(1.1)">
        <rect x="2" y="4" width="20" height="16" rx="3" fill="none" stroke="#EA580C" stroke-width="2"/>
        <path d="M6 14l-4-4 4-4M18 6l4 4-4 4M14 6l-4 8" stroke="#EA580C" stroke-width="1.5" fill="none"/>
      </g>
    `;
  }
  if (lbl.endsWith(".css") || lbl.includes("css")) {
    return `
      <g transform="translate(10, 10) scale(1.1)">
        <rect x="2" y="4" width="20" height="16" rx="3" fill="none" stroke="#0284C7" stroke-width="2"/>
        <circle cx="7" cy="10" r="2" fill="#0284C7"/>
        <line x1="11" y1="10" x2="19" y2="10" stroke="#0284C7" stroke-width="2"/>
        <line x1="5" y1="14" x2="15" y2="14" stroke="#0284C7" stroke-width="2"/>
      </g>
    `;
  }
  if (lbl.endsWith(".js") || lbl.includes("javascript")) {
    return `
      <g transform="translate(10, 10) scale(1.1)">
        <rect x="2" y="2" width="20" height="20" rx="3" fill="#CA8A04"/>
        <text x="18" y="17" font-family="system-ui, sans-serif" font-size="9" font-weight="900" fill="#FFFFFF" text-anchor="end">JS</text>
      </g>
    `;
  }
  if (lbl.endsWith(".ts") || lbl.includes("typescript")) {
    return `
      <g transform="translate(10, 10) scale(1.1)">
        <rect x="2" y="2" width="20" height="20" rx="3" fill="#2563EB"/>
        <text x="18" y="17" font-family="system-ui, sans-serif" font-size="9" font-weight="900" fill="#FFFFFF" text-anchor="end">TS</text>
      </g>
    `;
  }
  if (lbl.endsWith(".java")) {
    return `
      <g transform="translate(10, 10) scale(1.1)">
        <path d="M6 18c0 1 2 2 6 2s6-1 6-2M4 14c0 1 2 2 8 2s8-1 8-2" fill="none" stroke="#EA580C" stroke-width="1.75"/>
        <path d="M12 2c0 0-2 2-2 4s2 4 2 4-2 2-2 4" fill="none" stroke="#EA580C" stroke-width="1.75"/>
      </g>
    `;
  }
  // Default File
  return `
    <g transform="translate(10, 10) scale(1.1)">
      <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="none" stroke="#475569" stroke-width="2"/>
      <path d="M14 2v5h5" fill="none" stroke="#475569" stroke-width="1.5"/>
    </g>
  `;
}

function getNodeColors(type: string): { bg: string; stroke: string; text: string; iconBg: string } {
  const t = (type || "").toLowerCase();
  switch (t) {
    case "user":
      return { bg: "url(#userGrad)", stroke: "#2563EB", text: "#1E40AF", iconBg: "#DBEAFE" };
    case "frontend":
    case "page":
    case "component":
    case "ui":
      return { bg: "url(#frontendGrad)", stroke: "#059669", text: "#065F46", iconBg: "#D1FAE5" };
    case "route":
    case "api":
      return { bg: "url(#apiGrad)", stroke: "#4F46E5", text: "#3730A3", iconBg: "#E0E7FF" };
    case "backend":
    case "server":
    case "service":
      return { bg: "url(#backendGrad)", stroke: "#7C3AED", text: "#5B21B6", iconBg: "#EDE9FE" };
    case "database":
    case "table":
    case "storage":
      return { bg: "url(#dbGrad)", stroke: "#D97706", text: "#92400E", iconBg: "#FEEB9C" };
    case "auth":
    case "security":
      return { bg: "url(#authGrad)", stroke: "#DB2777", text: "#9D174D", iconBg: "#FCE7F3" };
    case "external":
    case "cloud":
      return { bg: "url(#externalGrad)", stroke: "#0284C7", text: "#075985", iconBg: "#E0F2FE" };
    case "rag":
    case "ml":
    case "ai":
      return { bg: "url(#ragGrad)", stroke: "#0891B2", text: "#155E75", iconBg: "#CFFAFE" };
    default:
      return { bg: "url(#defaultGrad)", stroke: "#475569", text: "#1E293B", iconBg: "#E2E8F0" };
  }
}

/**
 * Generate Real Programmatic System Architecture Diagram in SVG
 */
export function generateArchitectureDiagramSvg(analysis: ProjectAnalysis): string {
  return renderProfessionalArchitectureSvg(analysis);
}

/**
 * Generate Real Programmatic Workflow Diagram in SVG
 */
export function generateWorkflowDiagramSvg(analysis: ProjectAnalysis): string {
  return renderProfessionalWorkflowSvg(analysis);
}

/**
 * Generate Real Programmatic RAG Pipeline Visual in SVG
 */
export function generateRagPipelineDiagramSvg(analysis: ProjectAnalysis): string {
  return renderProfessionalRagArchitectureSvg(analysis);
}

/**
 * Generate Real Programmatic File-Level Architecture Diagram in SVG
 */
export function generateFileArchitectureDiagramSvg(analysis: ProjectAnalysis): string {
  return renderProfessionalFileArchitectureSvg(analysis);
}

/**
 * Generate Real Programmatic Tech Stack Visual in SVG
 */
export function generateTechStackVisualSvg(analysis: ProjectAnalysis): string {
  const title = escapeSvgXml(analysis.projectName || "Stack Visualizer");
  const languages = analysis.languages || [];
  const frameworks = analysis.frameworks || [];
  const runtimes = analysis.runtimes || [];
  
  const diagramWidth = 1200;
  const diagramHeight = 720;

  let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${diagramWidth} ${diagramHeight}" width="${diagramWidth}" height="${diagramHeight}">
    <defs>
      <filter id="shadowFilter" x="-10%" y="-10%" width="130%" height="130%">
        <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#0F172A" flood-opacity="0.06" />
      </filter>
    </defs>

    <!-- Canvas Background -->
    <rect width="${diagramWidth}" height="${diagramHeight}" fill="#FFFFFF" />
    <rect x="20" y="20" width="${diagramWidth - 40}" height="${diagramHeight - 40}" rx="16" fill="none" stroke="#F1F5F9" stroke-width="1.5" />

    <!-- Top Infographic Header -->
    <g transform="translate(45, 55)">
      <text font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="800" fill="#0F172A">${title}</text>
      <text x="0" y="22" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" letter-spacing="0.08em" fill="#4F46E5">TECHNOLOGY LANDSCAPE &amp; DISCOVERED FRAMEWORKS</text>
    </g>

    <!-- Left Block: Discovered Stack Grid -->
    <g transform="translate(60, 120)">
      <text font-family="system-ui, sans-serif" font-size="14" font-weight="800" fill="#0F172A">DISCOVERED LIBRARIES &amp; FRAMEWORKS</text>
      <rect x="0" y="15" width="500" height="1.25" fill="#E2E8F0" />
    </g>

    <!-- Right Block: Language Distribution -->
    <g transform="translate(640, 120)">
      <text font-family="system-ui, sans-serif" font-size="14" font-weight="800" fill="#0F172A">PRIMARY LANGUAGES STRUCTURE</text>
      <rect x="0" y="15" width="500" height="1.25" fill="#E2E8F0" />
    </g>
  `;

  // Draw frameworks/runtimes on the left
  const activeTech = [...frameworks, ...runtimes];
  if (activeTech.length === 0) {
    activeTech.push("Vanilla JS / Script Node");
  }

  activeTech.slice(0, 8).forEach((techName, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 60 + col * 260;
    const y = 160 + row * 94;

    const icon = getTechIconSvg("service", techName, techName);

    svgContent += `
      <g transform="translate(${x}, ${y})" filter="url(#shadowFilter)">
        <rect width="230" height="74" rx="12" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="1.5" />
        
        <!-- Left color bar -->
        <rect x="0" y="16" width="4" height="42" rx="2" fill="#4F46E5" />

        <!-- Icon container -->
        <rect x="14" y="15" width="44" height="44" rx="10" fill="#EDE9FE" />
        <g transform="translate(14, 15)">
          ${icon}
        </g>

        <!-- Info -->
        <text x="68" y="32" font-family="system-ui, sans-serif" font-size="12.5" font-weight="800" fill="#0F172A">${escapeSvgXml(techName)}</text>
        <text x="68" y="50" font-family="system-ui, sans-serif" font-size="10.5" font-weight="600" fill="#64748B">Discovered Stack</text>
      </g>
    `;
  });

  // Draw language shares on the right
  if (languages.length === 0) {
    languages.push({ name: analysis.primaryLanguage || "HTML / CSS", percentage: 100, filesCount: 1, linesCount: 100 });
  }

  languages.slice(0, 5).forEach((lang, idx) => {
    const y = 160 + idx * 78;
    const x = 640;

    const safeLangName = escapeSvgXml(lang.name);
    const percentage = lang.percentage != null ? Math.round(lang.percentage) : 100;
    const icon = getTechIconSvg("file", "", lang.name);

    svgContent += `
      <!-- Language Row ${idx} -->
      <g transform="translate(${x}, ${y})">
        <!-- Icon -->
        <rect width="36" height="36" rx="8" fill="#F1F5F9" stroke="#E2E8F0" stroke-width="1" />
        <g transform="translate(-2, -2)">
          ${icon}
        </g>

        <!-- Lang name and percentage text -->
        <text x="50" y="16" font-family="system-ui, sans-serif" font-size="12.5" font-weight="800" fill="#0F172A">${safeLangName}</text>
        <text x="50" y="30" font-family="system-ui, sans-serif" font-size="10" font-weight="600" fill="#64748B">${lang.filesCount} file(s) — ${lang.linesCount} lines</text>
        <text x="500" y="16" font-family="system-ui, sans-serif" font-size="13.5" font-weight="800" fill="#4F46E5" text-anchor="end">${percentage}%</text>

        <!-- Progress Bar Background -->
        <rect x="50" y="36" width="450" height="8" rx="4" fill="#F1F5F9" />
        <!-- Discovered Language Progress Bar -->
        <rect x="50" y="36" width="${4.5 * percentage}" height="8" rx="4" fill="#4F46E5" />
      </g>
    `;
  });

  svgContent += `</svg>`;
  return svgContent;
}

/**
 * Generate complete Project Visual Intelligence package (PNG buffers for all diagrams + screenshots)
 */
export function buildProjectVisualIntelligence(
  analysis: ProjectAnalysis,
  files: ExtractedFile[] = []
): ProjectVisualIntelligence {
  const safeFiles = Array.isArray(files) ? files : [];
  const screenshots = detectProjectScreenshots(safeFiles);

  const archSvg = generateArchitectureDiagramSvg(analysis);
  const flowSvg = generateWorkflowDiagramSvg(analysis);
  const ragSvg = generateRagPipelineDiagramSvg(analysis);
  const techSvg = generateTechStackVisualSvg(analysis);

  return {
    screenshots,
    architecturePng: renderSvgToPngBuffer(archSvg, 1200),
    workflowPng: renderSvgToPngBuffer(flowSvg, 1200),
    ragPipelinePng: renderSvgToPngBuffer(ragSvg, 1200),
    techStackPng: renderSvgToPngBuffer(techSvg, 1200),
  };
}

/**
 * Create project-aware image generation prompt
 */
export function buildProjectAwareImagePrompt(analysis: ProjectAnalysis, category: string, customInstruction?: string): string {
  const name = analysis.projectName || "Software Project";
  const lang = analysis.primaryLanguage || "TypeScript";
  const fw = analysis.frameworks.join(", ") || "Modern Stack";
  const summary = (analysis.summary || "").slice(0, 200);

  let categoryContext = "";

  switch (category) {
    case "hero":
      categoryContext = `A clean, professional technical architecture and executive system overview graphic for '${name}' (${lang}, ${fw}). Crisp white/slate background, subtle dark slate (#1E293B) and cool gray accents, standard technical block diagrams, clear typography, professional enterprise documentation style.`;
      break;
    case "problem":
      categoryContext = `A clear, technical schematic representing system complexities, modular fragmentation, and developer workflow challenges addressed by '${name}'. Clean monochromatic slate and muted charcoal palette with subtle warning accents, crisp technical diagram style.`;
      break;
    case "solution":
      categoryContext = `A structured technical system topology diagram showing the solution architecture of '${name}': ${summary}. Crisp component blocks, orthogonal flow lines, neutral slate and navy palette, clear professional presentation aesthetic.`;
      break;
    case "rag":
      categoryContext = `A clear, structured technical diagram of the Retrieval-Augmented Generation (RAG) and AST ingestion pipeline for '${name}'. Showing code extraction, semantic chunking, indexed storage, and deterministic grounding. Neutral slate background, crisp orthogonal connectors, clean technical annotations.`;
      break;
    default:
      categoryContext = `A professional, technical system diagram and architecture visual for '${name}' (${lang}, ${fw}). ${summary}. Clean neutral palette, crisp lines, structured layout.`;
      break;
  }

  if (customInstruction) {
    categoryContext += ` Custom technical focus: ${customInstruction}.`;
  }

  return `${categoryContext} Strictly no decorative AI-style clutter, no cartoon emojis, no neon gradients, no distorted text, clean enterprise aesthetic.`;
}
