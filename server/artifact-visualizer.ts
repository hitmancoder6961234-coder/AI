import path from "path";
import { ExtractedFile } from "./project-analyzer";

export interface ProjectNode {
  id: string;
  projectId: string;
  type: "html" | "css" | "javascript" | "typescript" | "react" | "python" | "java" | "api" | "backend" | "database" | "schema" | "config" | "image" | "notebook" | "doc" | "external" | "dependency" | "other";
  label: string;
  icon: string;
  sourceFile: string;
  evidence: Array<{ file: string; line?: number; code?: string; note: string }>;
  metrics?: Record<string, any>;
  technology?: string;
  subType?: string;
  description?: string;
  level?: "high" | "detailed" | "symbol" | "file";
  files?: string[];
  endpoints?: any[];
  models?: any[];
}

export interface ProjectEdge {
  id: string;
  source: string;
  target: string;
  relationship: "references" | "imports" | "calls" | "queries" | "persists" | "integrates" | "contains";
  evidence: Array<{ file: string; line?: number; code?: string; note: string }>;
  type?: string;
  label?: string;
  status?: string;
  detail?: string;
  isReturn?: boolean;
}

export interface ProjectGraph {
  nodes: ProjectNode[];
  edges: ProjectEdge[];
}

/**
 * Detect node type, sub-type, and best matching icon based on file attributes
 */
function getFileNodeAttributes(f: ExtractedFile): {
  type: ProjectNode["type"];
  icon: string;
  subType: string;
  technology: string;
} {
  const ext = (f.extension || "").toLowerCase();
  const name = (f.name || "").toLowerCase();
  const content = f.content || "";

  if (ext === ".html" || ext === ".htm") {
    return { type: "html", icon: "html", subType: "HTML View", technology: "HTML5" };
  }
  if (ext === ".css" || ext === ".scss" || ext === ".sass" || ext === ".less") {
    return { type: "css", icon: "css", subType: "Stylesheet", technology: "CSS3 / Tailwind" };
  }
  if (ext === ".tsx" || ext === ".jsx" || content.includes('import React') || content.includes('from "react"')) {
    return { type: "react", icon: "react", subType: "React Component", technology: "React / TSX" };
  }
  if (ext === ".ts") {
    return { type: "typescript", icon: "typescript", subType: "TypeScript Module", technology: "TypeScript" };
  }
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    return { type: "javascript", icon: "javascript", subType: "JavaScript Module", technology: "JavaScript" };
  }
  if (ext === ".py") {
    return { type: "python", icon: "python", subType: "Python Script", technology: "Python 3" };
  }
  if (ext === ".ipynb") {
    return { type: "notebook", icon: "notebook", subType: "Jupyter Notebook", technology: "Jupyter" };
  }
  if (ext === ".java") {
    return { type: "java", icon: "java", subType: "Java Source", technology: "Java / JVM" };
  }
  if (ext === ".sql" || ext === ".prisma" || name === "schema.ts" || name === "schema.js") {
    return { type: "schema", icon: "database", subType: "Database Schema", technology: "SQL Schema" };
  }
  if (name === "package.json" || name === "requirements.txt" || name === "pom.xml" || name === "cargo.toml" || name === "go.mod" || ext === ".config.js" || ext === ".config.ts") {
    return { type: "config", icon: "config", subType: "Configuration Manifest", technology: "Config" };
  }
  if (ext === ".md" || ext === ".txt" || name.startsWith("readme")) {
    return { type: "doc", icon: "doc", subType: "Documentation", technology: "Markdown" };
  }
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name)) {
    return { type: "image", icon: "image", subType: "Image Asset", technology: "Vector/Raster Graphic" };
  }

  return { type: "other", icon: "file", subType: "Project Asset", technology: "System File" };
}

/**
 * Clean path helper
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Builds a 100% dynamic, project-evidence-grounded ProjectGraph.
 * Contains ONLY nodes and edges supported by actual files in the workspace.
 */
export function buildProjectGraph(
  projectId: string,
  files: ExtractedFile[],
  analysis?: any
): ProjectGraph {
  const nodes: ProjectNode[] = [];
  const edges: ProjectEdge[] = [];

  // 1. Process files to establish primary ProjectNodes
  files.forEach((f) => {
    // Exclude noise, build artifacts, etc if any slips through
    const normPath = normalizePath(f.path);
    if (
      normPath.includes("node_modules/") ||
      normPath.includes(".git/") ||
      normPath.includes("dist/") ||
      normPath.includes("build/") ||
      normPath.includes(".next/")
    ) {
      return;
    }

    const attrs = getFileNodeAttributes(f);
    
    // Validate node attributes
    nodes.push({
      id: normPath,
      projectId: projectId,
      type: attrs.type,
      label: f.name,
      icon: attrs.icon,
      sourceFile: normPath,
      evidence: [{ file: normPath, note: `Verified workspace entity: ${f.name} (${f.size} bytes)` }],
      technology: attrs.technology,
      subType: attrs.subType,
      description: `Component file implementing project routines in ${attrs.technology}.`,
      level: "file",
      files: [normPath]
    });
  });

  // 2. Scan text contents to discover genuine, verifiable connections
  const textNodes = nodes.filter((n) => {
    const f = files.find((file) => normalizePath(file.path) === n.id);
    return f && !f.isBinary && f.content;
  });

  // Generate mapping of labels and IDs to match references
  const nodeIdsAndLabels = nodes.map((n) => ({
    id: n.id,
    label: n.label,
    escapedLabel: n.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    normId: n.id.toLowerCase()
  }));

  textNodes.forEach((srcNode) => {
    const f = files.find((file) => normalizePath(file.path) === srcNode.id)!;
    const lines = f.content.split(/\r?\n/);

    // Scan each line for references to other nodes
    lines.forEach((lineText, lineIdx) => {
      const lineNum = lineIdx + 1;
      const trimmedLine = lineText.trim();
      if (!trimmedLine || trimmedLine.startsWith("//") || trimmedLine.startsWith("#")) {
        return;
      }

      nodeIdsAndLabels.forEach((tgt) => {
        if (tgt.id === srcNode.id) return; // No self-loops

        // A. Direct exact match check for relative imports or string references
        // e.g. "hotel_img.png" or "./hotel_img.png" or "import X from './X'"
        const hasSubString = trimmedLine.includes(tgt.label) || trimmedLine.toLowerCase().includes(tgt.id.toLowerCase());
        
        if (hasSubString) {
          // Double check to prevent false positives like matching single character filenames
          if (tgt.label.length < 4 && !trimmedLine.includes(`"${tgt.label}"`) && !trimmedLine.includes(`'${tgt.label}'`) && !trimmedLine.includes(`./${tgt.label}`)) {
            return;
          }

          let rel: ProjectEdge["relationship"] = "references";
          let labelText = "references";

          const isImport = /import|require|from/i.test(trimmedLine);
          if (isImport) {
            rel = "imports";
            labelText = "imports";
          } else if (/\.(html|php|js|tsx|jsx)$/i.test(srcNode.id) && /\.(png|jpe?g|gif|webp|svg)$/i.test(tgt.id)) {
            rel = "references";
            labelText = "renders asset";
          }

          // Check if edge already exists to prevent duplicate lines
          const edgeId = `edge_${srcNode.id}_to_${tgt.id}`;
          const existingEdge = edges.find((e) => e.id === edgeId);

          if (existingEdge) {
            existingEdge.evidence.push({
              file: srcNode.id,
              line: lineNum,
              code: trimmedLine.substring(0, 100),
              note: `Subsequent reference to ${tgt.label}`
            });
          } else {
            edges.push({
              id: edgeId,
              source: srcNode.id,
              target: tgt.id,
              relationship: rel,
              type: rel.toUpperCase(),
              label: labelText,
              status: "VERIFIED",
              detail: `Verified link between ${srcNode.label} and ${tgt.label} detected in source code.`,
              evidence: [
                {
                  file: srcNode.id,
                  line: lineNum,
                  code: trimmedLine.substring(0, 100),
                  note: `Direct reference to ${tgt.label}`
                }
              ]
            });
          }
        }
      });
    });
  });

  // 3. Reject any invented nodes or edges without direct workspace evidence
  // Assert every node has projectId and sourceFile
  const validNodes = nodes.filter((n) => n.projectId && n.sourceFile && n.evidence.length > 0);
  const validNodeIds = new Set(validNodes.map((n) => n.id));

  // Assert every edge has source + target present in valid nodes
  const validEdges = edges.filter((e) => {
    return validNodeIds.has(e.source) && validNodeIds.has(e.target) && e.evidence.length > 0;
  });

  return {
    nodes: validNodes,
    edges: validEdges
  };
}

/**
 * Consumes the canonical ProjectGraph and prepares visual formats
 * Ensure zero hardcoded USER, FRONTEND, BACKEND default nodes are produced.
 */
export function artifactVisualizer(graph: ProjectGraph): ProjectGraph {
  // Validate that every node and edge complies with integrity rules
  const cleanNodes = graph.nodes.filter(n => n.projectId && n.sourceFile && n.evidence.length > 0);
  const validIds = new Set(cleanNodes.map(n => n.id));
  const cleanEdges = graph.edges.filter(e => validIds.has(e.source) && validIds.has(e.target) && e.evidence.length > 0);

  return {
    nodes: cleanNodes,
    edges: cleanEdges
  };
}
