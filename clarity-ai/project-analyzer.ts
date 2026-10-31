
function formatApiError(err: any): string {
  let msg = (err && (err.message || (typeof err === "string" ? err : JSON.stringify(err)))) || "An unknown error occurred";
  try {
    if (msg.includes('{"error"')) {
      const startIdx = msg.indexOf('{');
      const endIdx = msg.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        const jsonStr = msg.substring(startIdx, endIdx + 1);
        const parsed = JSON.parse(jsonStr);
        if (parsed.error && parsed.error.message) {
          let innerMsg = parsed.error.message;
          try {
             const innerParsed = JSON.parse(innerMsg);
             if (innerParsed.error && innerParsed.error.message) {
               msg = innerParsed.error.message;
             } else {
               msg = innerMsg;
             }
          } catch(e2) {
             msg = innerMsg;
          }
        }
      }
    }
  } catch (e) {}
  if (msg.includes("429") || msg.includes("Quota exceeded") || msg.includes("RESOURCE_EXHAUSTED")) {
     return "You have exceeded your API quota or rate limit. " + msg;
  }
  return msg;
}
import AdmZip from "adm-zip";
import path from "path";
import { MAX_UPLOAD_SIZE_BYTES, isFileTooLarge } from "./upload-config.js";

export interface ExtractedFile {
  path: string;
  name: string;
  extension: string;
  size: number;
  isBinary: boolean;
  content: string;
  buffer?: Buffer;
  lineCount: number;
}

export type {
  ArchitectureNodeType,
  NodeEvidence,
  EdgeEvidence,
  ArchitectureNode,
  ConnectionType,
  ConnectionStatus,
  ArchitectureEdge,
  ArchitectureHealthSummary,
  MindMapItem,
  DataFlowStep,
  ArchitectureSystemResult,
} from "./architecture-engine";
import { buildProjectArchitecture, ArchitectureNode, ArchitectureEdge, DataFlowStep } from "./architecture-engine";

export interface ApiEndpoint {
  method: string;
  path: string;
  file: string;
  line: number;
  handler?: string;
  authRequired?: boolean;
  callers?: string[];
}

export interface DatabaseModel {
  name: string;
  file: string;
  fields: Array<{ name: string; type: string }>;
  relations?: string[];
}

export interface SecurityFinding {
  id: string;
  title: string;
  severity: "CONFIRMED" | "POTENTIAL RISK" | "NEEDS MANUAL VERIFICATION";
  category: string;
  file: string;
  line: number;
  redactedSnippet: string;
  description: string;
  suggestedFix: string;
}

export interface CodeQualityIssue {
  id: string;
  title: string;
  category: string;
  file: string;
  line?: number;
  whyItMatters: string;
  suggestedFix: string;
}

export interface DependencyItem {
  name: string;
  version: string;
  category: string;
  filesUsing: string[];
  purpose?: string;
}

export interface ProjectAnalysis {
  projectId: string;
  projectName: string;
  summary: string;
  projectType: string;
  primaryLanguage: string;
  languages: Array<{ name: string; filesCount: number; linesCount: number; percentage: number }>;
  frameworks: string[];
  runtimes: string[];
  buildTools: string[];
  fileStats: { totalFiles: number; totalLines: number; totalSize: number; codeFilesCount: number };
  architecture: {
    summary: string;
    nodes: ArchitectureNode[];
    edges: ArchitectureEdge[];
    detailedNodes?: ArchitectureNode[];
    detailedEdges?: ArchitectureEdge[];
    symbolNodes?: ArchitectureNode[];
    symbolEdges?: ArchitectureEdge[];
    fileNodes?: ArchitectureNode[];
    fileEdges?: ArchitectureEdge[];
    flows?: import("./architecture-engine").ArchitectureFlow[];
    health?: import("./architecture-engine").ArchitectureHealthSummary;
    advisor?: import("./architecture-engine").ArchitectureAdvisorReport;
    mindMap?: { root: import("./architecture-engine").MindMapItem };
    orphans?: string[];
    brokenReferences?: Array<{ fromFile: string; target: string; line: number }>;
  };
  dataFlow: {
    summary: string;
    steps: DataFlowStep[];
  };
  apiIntelligence: {
    detected: boolean;
    endpoints: ApiEndpoint[];
    outboundCalls: Array<{ service: string; endpoint?: string; file: string; line: number }>;
  };
  databaseIntelligence: {
    detected: boolean;
    system?: string;
    models: DatabaseModel[];
    migrationsFound: boolean;
    description: string;
  };
  dependencies: {
    total: number;
    packages: DependencyItem[];
    unusedDeclared: string[];
  };
  securityAnalysis: {
    score: number;
    summary: string;
    findings: SecurityFinding[];
  };
  codeQuality: {
    score: number;
    summary: string;
    issues: CodeQualityIssue[];
    testing: { hasTests: boolean; testFilesCount: number; testFrameworks: string[] };
  };
  knowledgeBase: {
    keyInsights: string[];
    vivaQuestions: Array<{ question: string; answer: string; relatedFiles: string[] }>;
    quickStartGuide: string;
  };
  projectIntelligence?: ProjectIntelligence;
}

const TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".pyw", ".ipynb",
  ".java", ".kt", ".kts", ".scala", ".groovy",
  ".c", ".h", ".cpp", ".hpp", ".cc", ".cxx",
  ".cs", ".csx",
  ".go",
  ".rs",
  ".php",
  ".rb", ".erb",
  ".html", ".htm", ".vue", ".svelte",
  ".css", ".scss", ".sass", ".less",
  ".json", ".yaml", ".yml", ".toml", ".xml", ".ini", ".env", ".example",
  ".md", ".markdown", ".txt", ".rst", ".adoc",
  ".sh", ".bash", ".zsh", ".bat", ".cmd", ".ps1",
  ".sql", ".graphql", ".gql", ".prisma",
  ".dockerfile", ".editorconfig", ".gitignore", "dockerfile", "makefile"
]);

const IGNORED_PATH_SEGMENTS = new Set([
  "node_modules", ".git", ".svn", ".hg", "__pycache__", ".venv", "venv", "env",
  ".idea", ".vscode", "dist", "build", "target", ".next", ".nuxt", "coverage", ".pytest_cache",
  ".turbo", ".cache", ".output", ".gradle", "bin", "obj", "vendor", "bower_components", "pods", "deriveddata", ".yarn", ".pnpm-store"
]);

/**
 * Safely extracts a ZIP buffer, preventing Zip-Slip path traversal and sanitizing paths.
 */
export function extractZipSecurely(buffer: Buffer): { files: ExtractedFile[]; error?: string } {
  try {
    if (buffer && isFileTooLarge(buffer.length)) {
      return { files: [], error: "FILE_TOO_LARGE: Archive exceeds the maximum allowed size of 100 MB." };
    }

    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();
    if (!zipEntries || zipEntries.length === 0) {
      return { files: [], error: "The provided ZIP file is empty." };
    }

    let totalExtractedBytes = 0;
    const rawFiles: Array<{ entryName: string; isDirectory: boolean; getData: () => Buffer }> = [];
    for (const entry of zipEntries) {
      // Early check on entry header uncompressed size if available
      if (entry.header && typeof entry.header.size === "number" && isFileTooLarge(entry.header.size)) {
        return { files: [], error: "FILE_TOO_LARGE: Archive contains a file exceeding the maximum allowed size of 100 MB." };
      }

      // Security: check for zip-slip / directory traversal
      const norm = path.normalize(entry.entryName).replace(/\\/g, "/");
      if (norm.startsWith("..") || norm.includes("/../") || path.isAbsolute(entry.entryName)) {
        continue; // Skip dangerous entries
      }
      if (norm.startsWith("__MACOSX/") || norm.includes("/.DS_Store") || norm.endsWith("Thumbs.db")) {
        continue; // Skip macOS / Windows junk
      }

      // Skip ignored directories immediately at root/subpath level without decompressing
      const segments = norm.split("/").filter(Boolean);
      const isIgnored = segments.some((s) => IGNORED_PATH_SEGMENTS.has(s.toLowerCase()));
      if (isIgnored) {
        continue;
      }

      rawFiles.push({
        entryName: norm,
        isDirectory: entry.isDirectory,
        getData: () => entry.getData(),
      });
    }

    if (rawFiles.length === 0) {
      return { files: [], error: "No valid files found in ZIP." };
    }

    // Check if everything is nested under a single top-level directory (e.g. project-main/)
    const firstSegments = new Set<string>();
    for (const f of rawFiles) {
      const parts = f.entryName.split("/").filter(Boolean);
      if (parts.length > 1) {
        firstSegments.add(parts[0]);
      } else if (!f.isDirectory) {
        firstSegments.add(""); // File in root
      }
    }

    let prefixToRemove = "";
    if (firstSegments.size === 1) {
      const singleRoot = Array.from(firstSegments)[0];
      if (singleRoot && singleRoot.length > 0) {
        prefixToRemove = singleRoot + "/";
      }
    }

    const files: ExtractedFile[] = [];
    for (const f of rawFiles) {
      if (f.isDirectory) continue;

      let cleanPath = f.entryName;
      if (prefixToRemove && cleanPath.startsWith(prefixToRemove)) {
        cleanPath = cleanPath.substring(prefixToRemove.length);
      }
      cleanPath = cleanPath.replace(/^\/+/, "");
      if (!cleanPath) continue;

      const segments = cleanPath.split("/");
      const shouldIgnore = segments.some((s) => IGNORED_PATH_SEGMENTS.has(s.toLowerCase()));
      if (shouldIgnore) continue;

      const ext = path.extname(cleanPath).toLowerCase();
      const baseName = path.basename(cleanPath);
      const isText = TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(baseName.toLowerCase());

      const dataBuf = f.getData();
      const size = dataBuf.length;

      if (isFileTooLarge(size)) {
        return { files: [], error: "FILE_TOO_LARGE: Archive contains a file exceeding the maximum allowed size of 100 MB." };
      }

      totalExtractedBytes += size;
      if (isFileTooLarge(totalExtractedBytes)) {
        return { files: [], error: "FILE_TOO_LARGE: Total extracted content exceeds the maximum allowed size of 100 MB." };
      }

      let content = "";
      let lineCount = 0;

      if (isText) {
        // Read text content up to 500 KB per file for analysis & preview
        const slice = dataBuf.subarray(0, 500 * 1024);
        content = slice.toString("utf-8");
        // Simple heuristic to verify it's actually valid utf-8 text and not binary disguised as text
        if (content.includes("\0")) {
          content = "(Binary file content)";
        } else {
          lineCount = content.split(/\r?\n/).length;
        }
      }

      files.push({
        path: cleanPath,
        name: baseName,
        extension: ext,
        size,
        isBinary: !isText || content === "(Binary file content)",
        content,
        buffer: dataBuf,
        lineCount,
      });
    }

    if (files.length === 0) {
      return { files: [], error: "No inspectable source or project files found in ZIP." };
    }

    return { files };
  } catch (err: any) {
    return { files: [], error: "Corrupted or invalid ZIP archive: " + (err?.message || "unreadable format") };
  }
}

/**
 * Universal project detection and analysis engine.
 */
export function analyzeProject(projectName: string, projectId: string, files: ExtractedFile[]): ProjectAnalysis {
  const fileMap = new Map<string, ExtractedFile>();
  for (const f of files) fileMap.set(f.path, f);

  // 1. Language Breakdown
  const languageLineCounts: Record<string, { files: number; lines: number }> = {};
  let totalLines = 0;
  let totalSize = 0;
  let codeFilesCount = 0;

  for (const f of files) {
    totalSize += f.size;
    if (f.isBinary) continue;
    totalLines += f.lineCount;

    const lang = detectLanguage(f.extension, f.name);
    if (lang) {
      codeFilesCount++;
      if (!languageLineCounts[lang]) languageLineCounts[lang] = { files: 0, lines: 0 };
      languageLineCounts[lang].files++;
      languageLineCounts[lang].lines += f.lineCount;
    }
  }

  const languages = Object.entries(languageLineCounts)
    .map(([name, data]) => ({
      name,
      filesCount: data.files,
      linesCount: data.lines,
      percentage: totalLines > 0 ? Math.round((data.lines / totalLines) * 100) : 0,
    }))
    .sort((a, b) => b.linesCount - a.linesCount);

  const primaryLanguage = languages.length > 0 ? languages[0].name : "Plain Text / Mixed";

  // 2. Manifest and Framework Detection
  const frameworksSet = new Set<string>();
  const runtimesSet = new Set<string>();
  const buildToolsSet = new Set<string>();
  const dependenciesList: DependencyItem[] = [];
  const declaredDepsSet = new Set<string>();

  // Check Node.js package.json
  const pkgFile = files.find((f) => f.name === "package.json");
  if (pkgFile && pkgFile.content) {
    runtimesSet.add("Node.js");
    try {
      const pkg = JSON.parse(pkgFile.content);
      const allDeps: Record<string, string> = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };

      for (const [dep, ver] of Object.entries(allDeps)) {
        declaredDepsSet.add(dep);
        const depMeta = categorizeNodeDep(dep);
        if (depMeta.framework) frameworksSet.add(depMeta.framework);
        if (depMeta.buildTool) buildToolsSet.add(depMeta.buildTool);

        dependenciesList.push({
          name: dep,
          version: String(ver || "latest"),
          category: depMeta.category,
          filesUsing: [],
          purpose: depMeta.purpose,
        });
      }

      if (pkg.scripts) {
        if (pkg.scripts.build) buildToolsSet.add("Custom Build Script");
        if (pkg.scripts.test) buildToolsSet.add("NPM Test Runner");
      }
    } catch (e) {}
  }

  // Check Python requirements.txt, pyproject.toml, Pipfile
  const pyReq = files.find((f) => f.name === "requirements.txt" || f.name === "Pipfile" || f.name === "pyproject.toml");
  if (pyReq && pyReq.content) {
    runtimesSet.add("Python");
    const lines = pyReq.content.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || line.startsWith("-")) continue;
      const match = line.match(/^([a-zA-Z0-9_\-]+)([=><~^!].*)?$/);
      if (match) {
        const depName = match[1].toLowerCase();
        declaredDepsSet.add(depName);
        const depMeta = categorizePythonDep(depName);
        if (depMeta.framework) frameworksSet.add(depMeta.framework);

        dependenciesList.push({
          name: match[1],
          version: match[2] || "latest",
          category: depMeta.category,
          filesUsing: [],
          purpose: depMeta.purpose,
        });
      }
    }
  }

  // Check Java Maven / Gradle
  const pom = files.find((f) => f.name === "pom.xml");
  const gradle = files.find((f) => f.name === "build.gradle" || f.name === "build.gradle.kts");
  if (pom) {
    runtimesSet.add("Java / JVM");
    buildToolsSet.add("Maven");
    if (pom.content.includes("spring-boot")) frameworksSet.add("Spring Boot");
    if (pom.content.includes("hibernate")) frameworksSet.add("Hibernate");
  }
  if (gradle) {
    runtimesSet.add("Java / JVM");
    buildToolsSet.add("Gradle");
    if (gradle.content.includes("spring")) frameworksSet.add("Spring");
  }

  // Check Rust Cargo.toml
  const cargo = files.find((f) => f.name === "Cargo.toml");
  if (cargo) {
    runtimesSet.add("Rust");
    buildToolsSet.add("Cargo");
    if (cargo.content.includes("actix")) frameworksSet.add("Actix Web");
    if (cargo.content.includes("axum")) frameworksSet.add("Axum");
    if (cargo.content.includes("tokio")) frameworksSet.add("Tokio");
  }

  // Check Go go.mod
  const goMod = files.find((f) => f.name === "go.mod");
  if (goMod) {
    runtimesSet.add("Go");
    if (goMod.content.includes("gin-gonic")) frameworksSet.add("Gin");
    if (goMod.content.includes("echo")) frameworksSet.add("Echo");
    if (goMod.content.includes("fiber")) frameworksSet.add("Fiber");
  }

  // Check Docker / Containers
  const dockerfile = files.find((f) => f.name.toLowerCase() === "dockerfile");
  const dockerCompose = files.find((f) => f.name.toLowerCase().includes("docker-compose"));
  if (dockerfile) buildToolsSet.add("Docker Container");
  if (dockerCompose) buildToolsSet.add("Docker Compose (Multi-Service)");

  // Precompile dependency matchers for fast search
  const depMatchers = dependenciesList.map((dep) => ({
    dep,
    regex: new RegExp(`['"]${escapeRegex(dep.name)}['"]`, "i"),
  }));

  // Scan file contents for imports and check where dependencies are used
  for (const f of files) {
    if (f.isBinary || !f.content) continue;
    // Scan up to first 256KB for dependencies
    const headContent = f.content.length > 256 * 1024 ? f.content.slice(0, 256 * 1024) : f.content;
    for (const { dep, regex } of depMatchers) {
      if (regex.test(headContent)) {
        if (!dep.filesUsing.includes(f.path)) {
          dep.filesUsing.push(f.path);
        }
      }
    }
  }

  // Identify unused declared dependencies
  const unusedDeclared = dependenciesList
    .filter((d) => d.filesUsing.length === 0 && !isImplicitDependency(d.name))
    .map((d) => d.name);

  // 3. AST / Symbol & Code Extraction (API Routes, DB models, Callers)
  const endpoints: ApiEndpoint[] = [];
  const outboundCalls: Array<{ service: string; endpoint?: string; file: string; line: number }> = [];
  const dbModels: DatabaseModel[] = [];
  let detectedDbSystem: string | undefined = undefined;

  for (const f of files) {
    if (f.isBinary || !f.content) continue;

    const lines = f.content.split(/\r?\n/);
    lines.forEach((lineText, idx) => {
      const lineNum = idx + 1;

      // Detect Express / Node routes: app.get("/...", ...), router.post("/...", ...)
      const expressMatch = lineText.match(/(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/i);
      if (expressMatch) {
        endpoints.push({
          method: (expressMatch[1] || 'GET').toUpperCase(),
          path: expressMatch[2],
          file: f.path,
          line: lineNum,
          handler: `Route Handler in ${f.name}`,
          authRequired: /auth|protect|jwt|session|guard|token/i.test(lineText),
        });
      }

      // Detect Flask / FastAPI routes: @app.get("/..."), @router.post("/..."), @app.route("/...")
      const pyRouteMatch = lineText.match(/@(?:app|router|api)\.(get|post|put|delete|patch|route)\s*\(\s*['"`]([^'"`]+)['"`]/i);
      if (pyRouteMatch) {
        let method = (pyRouteMatch[1] || 'GET').toUpperCase();
        if (method === "ROUTE") {
          const mMatch = lineText.match(/methods\s*=\s*\[([^\]]+)\]/i);
          method = mMatch ? (mMatch[1].replace(/['"\s]/g, '').split(',')[0] || 'GET').toUpperCase() : "GET";
        }
        endpoints.push({
          method,
          path: pyRouteMatch[2],
          file: f.path,
          line: lineNum,
          handler: `Endpoint in ${f.name}`,
          authRequired: /auth|login_required|security|token/i.test(lineText),
        });
      }

      // Detect Django url routes: path('api/...', views.my_view)
      const djangoMatch = lineText.match(/path\s*\(\s*['"]([^'"]+)['"]\s*,\s*([a-zA-Z0-9_\.]+)/);
      if (djangoMatch) {
        endpoints.push({
          method: "ANY",
          path: "/" + djangoMatch[1].replace(/^\//, ""),
          file: f.path,
          line: lineNum,
          handler: djangoMatch[2],
        });
      }

      // Detect Outbound API calls (fetch, axios, requests)
      const fetchMatch = lineText.match(/(?:fetch|axios\.(?:get|post|put|delete)|requests\.(?:get|post|put|delete))\s*\(\s*['"`](https?:\/\/[^'"`]+|(?:\/api\/[^'"`]+))['"`]/i);
      if (fetchMatch) {
        outboundCalls.push({
          service: fetchMatch[1].startsWith("http") ? new URL(fetchMatch[1]).hostname : "Internal Backend",
          endpoint: fetchMatch[1],
          file: f.path,
          line: lineNum,
        });
      }

      // Detect Database Models: Mongoose, Prisma, SQLAlchemy, Django models, TypeORM
      if (/class\s+([A-Za-z0-9_]+)\s*\(\s*(?:models\.Model|Base|db\.Model)\s*\)/.test(lineText)) {
        const m = lineText.match(/class\s+([A-Za-z0-9_]+)/);
        if (m) {
          detectedDbSystem = detectedDbSystem || "SQL (SQLAlchemy / Django ORM)";
          dbModels.push({
            name: m[1],
            file: f.path,
            fields: [],
          });
        }
      }

      if (/new\s+mongoose\.Schema|new\s+Schema\(/.test(lineText)) {
        detectedDbSystem = "MongoDB (Mongoose)";
        const m = f.name.replace(/\.(js|ts)$/, "");
        dbModels.push({
          name: (m ? m.charAt(0).toUpperCase() : '') + m.slice(1),
          file: f.path,
          fields: [],
        });
      }

      if (/model\s+([A-Za-z0-9_]+)\s*\{/.test(lineText) && f.extension === ".prisma") {
        detectedDbSystem = "Prisma ORM (PostgreSQL / MySQL / SQLite)";
        const m = lineText.match(/model\s+([A-Za-z0-9_]+)/);
        if (m) {
          dbModels.push({
            name: m[1],
            file: f.path,
            fields: [],
          });
        }
      }
    });
  }

  // Cross-reference callers of endpoints
  const codeTextFiles = files.filter((f) => !f.isBinary && f.content && f.content.length > 0);
  for (const ep of endpoints) {
    ep.callers = [];
    if (!ep.path || ep.path.length < 2) continue;
    for (const f of codeTextFiles) {
      if (f.path === ep.file) continue;
      if (f.content.includes(ep.path)) {
        ep.callers.push(f.path);
      }
    }
  }

  // Database presence verification
  const hasSqlFiles = files.some((f) => f.extension === ".sql");
  const hasMigrations = files.some((f) => f.path.toLowerCase().includes("migration"));
  if (hasSqlFiles && !detectedDbSystem) detectedDbSystem = "SQL Relational Database";

  const databaseDetected = Boolean(detectedDbSystem || dbModels.length > 0 || hasSqlFiles);

  // 4. Evidence-Based Architecture Graph & Data Flow Synthesis
  const archResult = buildProjectArchitecture(
    files,
    projectName,
    primaryLanguage,
    Array.from(frameworksSet),
    dependenciesList,
    endpoints,
    dbModels,
    detectedDbSystem,
    projectId
  );

  // 6. Security Analysis
  const findings: SecurityFinding[] = [];
  let findingId = 1;

  for (const f of files) {
    if (f.isBinary || !f.content) continue;
    const lines = f.content.split(/\r?\n/);

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;

      // Check for exposed secrets / API keys
      const secretMatch = line.match(/(?:api[_-]?key|secret|password|auth[_-]?token|private[_-]?key)\s*[:=]\s*['"]([A-Za-z0-9_\-\.]{14,})['"]/i);
      if (secretMatch && !f.path.includes(".example") && !f.path.includes("test")) {
        const rawSecret = secretMatch[1];
        // Redact secret completely
        const redacted = rawSecret.slice(0, 3) + "••••••••" + rawSecret.slice(-3);
        const snippet = line.replace(rawSecret, redacted).trim();

        findings.push({
          id: `sec_${findingId++}`,
          title: "Hardcoded Credential or API Secret Detected",
          severity: "CONFIRMED",
          category: "Secret Exposure",
          file: f.path,
          line: lineNum,
          redactedSnippet: snippet,
          description: "A sensitive key or secret appears to be hardcoded in plain text in source control.",
          suggestedFix: "Move this secret to an environment variable or secure vault (`process.env.MY_SECRET`).",
        });
      }

      // Check for SQL Injection risk (string formatting in SQL query)
      if (/(?:execute|query|raw)\s*\(\s*f?["'].*SELECT.*(?:\{|\+|\%s)/i.test(line) ||
          /SELECT.*FROM.*WHERE.*['"]\s*\+/i.test(line)) {
        findings.push({
          id: `sec_${findingId++}`,
          title: "Potential SQL Injection Vulnerability",
          severity: "CONFIRMED",
          category: "Injection",
          file: f.path,
          line: lineNum,
          redactedSnippet: line.trim(),
          description: "Raw SQL query constructed via string concatenation or interpolation rather than parameterized placeholders.",
          suggestedFix: "Use parameterized queries or ORM query builders (e.g. `query('SELECT * FROM users WHERE id = $1', [id])`).",
        });
      }

      // Check for Insecure CORS wildcard with credentials
      if (/cors\s*\(\s*\{\s*origin\s*:\s*['"]\*['"]/i.test(line)) {
        findings.push({
          id: `sec_${findingId++}`,
          title: "Overly Permissive CORS Policy",
          severity: "POTENTIAL RISK",
          category: "Security Misconfiguration",
          file: f.path,
          line: lineNum,
          redactedSnippet: line.trim(),
          description: "CORS is configured with a wildcard origin ('*'), allowing any external domain to make requests.",
          suggestedFix: "Explicitly allow-list trusted origin domains in production configuration.",
        });
      }

      // Check for XSS (dangerouslySetInnerHTML or innerHTML assignment)
      if (/dangerouslySetInnerHTML|innerHTML\s*=/i.test(line)) {
        findings.push({
          id: `sec_${findingId++}`,
          title: "Potential Cross-Site Scripting (XSS) Vector",
          severity: "NEEDS MANUAL VERIFICATION",
          category: "Cross-Site Scripting",
          file: f.path,
          line: lineNum,
          redactedSnippet: line.trim(),
          description: "Direct injection of raw HTML into DOM elements without automated sanitization.",
          suggestedFix: "Ensure content is passed through a trusted sanitizer library (e.g. DOMPurify) before rendering.",
        });
      }

      // Check for disabled SSL / verification
      if (/verify\s*=\s*False|rejectUnauthorized\s*:\s*false/i.test(line)) {
        findings.push({
          id: `sec_${findingId++}`,
          title: "SSL / TLS Certificate Verification Disabled",
          severity: "CONFIRMED",
          category: "Transport Security",
          file: f.path,
          line: lineNum,
          redactedSnippet: line.trim(),
          description: "Transport certificate verification is explicitly disabled, exposing requests to Man-In-The-Middle attacks.",
          suggestedFix: "Enable certificate verification in all non-test environments.",
        });
      }
    });
  }

  // 7. Code Quality Issues
  const qualityIssues: CodeQualityIssue[] = [];
  let qId = 1;

  for (const f of files) {
    if (f.isBinary || !f.content) continue;

    // File too long
    if (f.lineCount > 500) {
      qualityIssues.push({
        id: `qual_${qId++}`,
        title: `Large File Exceeds Recommended Size (${f.lineCount} lines)`,
        category: "Maintainability",
        file: f.path,
        whyItMatters: "Excessively large files often violate the Single Responsibility Principle and increase cognitive overhead.",
        suggestedFix: "Break down into modular focused sub-modules or extract business logic into service files.",
      });
    }

    // Missing error handling in catch blocks
    if (/catch\s*\([^\)]*\)\s*\{\s*\}/.test(f.content) || /except\s*:\s*pass/.test(f.content)) {
      qualityIssues.push({
        id: `qual_${qId++}`,
        title: "Silent Error Swallowing Detected",
        category: "Reliability & Error Handling",
        file: f.path,
        whyItMatters: "Empty catch/except blocks hide runtime exceptions and make debugging in production nearly impossible.",
        suggestedFix: "Log the exception with context or propagate it with appropriate error telemetry.",
      });
    }
  }

  // Testing check
  const testFiles = files.filter((f) =>
    f.path.includes("test") ||
    f.path.includes("spec") ||
    f.name.startsWith("test_") ||
    f.name.endsWith(".test.js") ||
    f.name.endsWith(".test.ts") ||
    f.name.endsWith(".spec.ts")
  );

  const hasTests = testFiles.length > 0;
  if (!hasTests && codeFilesCount > 5) {
    qualityIssues.push({
      id: `qual_${qId++}`,
      title: "No Automated Test Suite Detected",
      category: "Testing & Verification",
      file: "Project Root",
      whyItMatters: "Codebase lacks automated regression safety, making refactoring and deployments high-risk.",
      suggestedFix: "Introduce unit tests using a framework like Jest, Vitest, or pytest.",
    });
  }

  // 8. Determine Project Type
  const frameworks = Array.from(frameworksSet);
  const runtimes = Array.from(runtimesSet);
  const buildTools = Array.from(buildToolsSet);

  let projectType = "Software Project";
  if (frameworks.includes("React") && endpoints.length > 0) {
    projectType = "Full-Stack Web Application (React + Backend API)";
  } else if (frameworks.includes("React") || frameworks.includes("Vue") || frameworks.includes("Next.js") || frameworks.includes("Angular")) {
    projectType = "Frontend Single-Page Application";
  } else if (endpoints.length > 0 && runtimes.includes("Python")) {
    projectType = "Python Backend API Service";
  } else if (endpoints.length > 0 && runtimes.includes("Node.js")) {
    projectType = "Node.js REST API Service";
  } else if (frameworks.includes("Spring Boot")) {
    projectType = "Java Spring Boot Enterprise Service";
  } else if (runtimes.includes("Python") && (frameworks.includes("TensorFlow") || frameworks.includes("PyTorch") || frameworks.includes("Pandas"))) {
    projectType = "Data Science / Machine Learning System";
  } else if (files.some((f) => f.extension === ".html") && !frameworks.length) {
    projectType = "HTML/CSS/JavaScript Website";
  } else if (primaryLanguage !== "Plain Text / Mixed") {
    projectType = `${primaryLanguage} Software Project`;
  }

  // Security & Quality Scores
  const securityScore = Math.max(20, 100 - findings.filter((f) => f.severity === "CONFIRMED").length * 20 - findings.filter((f) => f.severity === "POTENTIAL RISK").length * 10);
  const qualityScore = Math.max(30, 100 - qualityIssues.length * 12);

  // 9. Knowledge Base & Viva Questions
  const vivaQuestions = [
    {
      question: "What is the primary architecture and high-level role of this project?",
      answer: `This project is a ${projectType} primarily developed in ${primaryLanguage}. It consists of ${files.length} indexed files (${totalLines} total lines of code) with ${endpoints.length > 0 ? `${endpoints.length} API endpoints` : "client/local execution"} and ${databaseDetected ? `a ${detectedDbSystem} database layer` : "no detected database system"}.`,
      relatedFiles: files.slice(0, 3).map((f) => f.path),
    },
    {
      question: "How is data routed from user interaction through the system?",
      answer: archResult.dataFlow.steps.map((s) => `${s.step}. ${s.title}: ${s.description}`).join("\n"),
      relatedFiles: archResult.dataFlow.steps.flatMap((s) => s.files).slice(0, 4),
    },
    {
      question: "What external packages or frameworks does this project depend on?",
      answer: `The core frameworks are ${frameworks.join(", ") || "Vanilla / Standard Libraries"}. Total dependencies: ${dependenciesList.length}. Key libraries include: ${dependenciesList.slice(0, 6).map((d) => `${d.name} (${d.category})`).join(", ")}.`,
      relatedFiles: [pkgFile?.path, pyReq?.path].filter(Boolean) as string[],
    },
    {
      question: "What are the most notable potential security or architectural risks?",
      answer: findings.length > 0
        ? `Found ${findings.length} security observation(s), including ${findings[0].title} in ${findings[0].file} (line ${findings[0].line}).`
        : "No high-confidence security vulnerabilities were identified in the static scan.",
      relatedFiles: findings.slice(0, 3).map((f) => f.file),
    },
  ];

  const readmeFile = files.find((f) => /^readme(\.md|\.markdown|\.txt)?$/i.test(f.name));
  const projectIntelligence = extractProjectIntelligence(
    projectName,
    projectId,
    files,
    pkgFile,
    readmeFile ? readmeFile.content : "",
    endpoints,
    dbModels,
    frameworks,
    runtimes,
    buildTools,
    languages,
    dependenciesList,
    projectType,
    archResult
  );

  return {
    projectId,
    projectName,
    summary: `Comprehensive analysis for ${projectName}. Identified as a ${projectType} featuring ${files.length} files across ${languages.map((l) => l.name).slice(0, 3).join(", ")}.`,
    projectType,
    primaryLanguage,
    languages,
    frameworks,
    runtimes,
    buildTools,
    fileStats: {
      totalFiles: files.length,
      totalLines,
      totalSize,
      codeFilesCount,
    },
    architecture: {
      summary: archResult.summary,
      nodes: archResult.nodes,
      edges: archResult.edges,
      detailedNodes: archResult.detailedNodes,
      detailedEdges: archResult.detailedEdges,
      symbolNodes: archResult.symbolNodes,
      symbolEdges: archResult.symbolEdges,
      fileNodes: archResult.fileNodes,
      fileEdges: archResult.fileEdges,
      flows: archResult.flows,
      health: archResult.health,
      advisor: archResult.advisor,
      mindMap: archResult.mindMap,
      orphans: archResult.orphans,
      brokenReferences: archResult.brokenReferences,
    },
    dataFlow: {
      summary: archResult.dataFlow.summary,
      steps: archResult.dataFlow.steps,
    },
    apiIntelligence: {
      detected: endpoints.length > 0,
      endpoints,
      outboundCalls,
    },
    databaseIntelligence: {
      detected: databaseDetected,
      system: detectedDbSystem,
      models: dbModels,
      migrationsFound: hasMigrations,
      description: databaseDetected
        ? `Database detected (${detectedDbSystem || "persistence layer"}). Discovered ${dbModels.length} models/tables.`
        : "Database not detected.",
    },
    dependencies: {
      total: dependenciesList.length,
      packages: dependenciesList,
      unusedDeclared,
    },
    securityAnalysis: {
      score: securityScore,
      summary: findings.length === 0
        ? "No severe vulnerabilities detected. Standard security hygiene verified."
        : `Identified ${findings.length} finding(s) (${findings.filter((f) => f.severity === "CONFIRMED").length} confirmed, ${findings.filter((f) => f.severity === "POTENTIAL RISK").length} potential risk).`,
      findings,
    },
    codeQuality: {
      score: qualityScore,
      summary: `Code quality score ${qualityScore}/100. ${qualityIssues.length} improvement recommendation(s) identified.`,
      issues: qualityIssues,
      testing: {
        hasTests,
        testFilesCount: testFiles.length,
        testFrameworks: frameworks.filter((f) => /jest|pytest|vitest|mocha|junit/i.test(f)),
      },
    },
    knowledgeBase: {
      keyInsights: [
        `Architecture type: ${projectType}`,
        `Primary language: ${primaryLanguage} (${languages[0]?.percentage || 0}% of codebase)`,
        `Frameworks in use: ${frameworks.join(", ") || "None / Custom"}`,
        `API endpoints exposed: ${endpoints.length}`,
        `Database layer: ${databaseDetected ? detectedDbSystem : "None detected"}`,
        `Automated test suite: ${hasTests ? `Yes (${testFiles.length} test files)` : "No automated tests detected"}`,
      ],
      vivaQuestions,
      quickStartGuide: generateQuickStart(projectType, runtimes, buildTools, files),
    },
    projectIntelligence,
  };
}

function detectLanguage(ext: string, name: string): string | null {
  const lowerName = name.toLowerCase();
  if (lowerName === "dockerfile") return "Docker";
  if (lowerName === "makefile") return "Makefile";

  switch (ext) {
    case ".ts": case ".tsx": return "TypeScript";
    case ".js": case ".jsx": case ".mjs": case ".cjs": return "JavaScript";
    case ".py": case ".pyw": return "Python";
    case ".java": return "Java";
    case ".c": case ".h": return "C";
    case ".cpp": case ".hpp": case ".cc": case ".cxx": return "C++";
    case ".cs": return "C#";
    case ".go": return "Go";
    case ".rs": return "Rust";
    case ".php": return "PHP";
    case ".rb": return "Ruby";
    case ".html": case ".htm": return "HTML";
    case ".css": case ".scss": case ".sass": case ".less": return "CSS";
    case ".json": return "JSON";
    case ".yaml": case ".yml": return "YAML";
    case ".toml": return "TOML";
    case ".sql": return "SQL";
    case ".sh": case ".bash": return "Shell Script";
    case ".ipynb": return "Jupyter Notebook";
    default: return null;
  }
}

function categorizeNodeDep(name: string): { category: string; purpose?: string; framework?: string; buildTool?: string } {
  const n = name.toLowerCase();
  if (n === "react" || n === "react-dom") return { category: "UI Framework", purpose: "Core UI library", framework: "React" };
  if (n === "vue") return { category: "UI Framework", purpose: "Progressive UI framework", framework: "Vue" };
  if (n === "next") return { category: "Full-Stack Framework", purpose: "Server-side rendering & API routes", framework: "Next.js" };
  if (n === "express") return { category: "Backend Framework", purpose: "Fast, unopinionated HTTP web framework", framework: "Express" };
  if (n === "fastify") return { category: "Backend Framework", purpose: "High performance HTTP framework", framework: "Fastify" };
  if (n.startsWith("@nestjs/")) return { category: "Backend Framework", purpose: "Enterprise Node.js framework", framework: "NestJS" };
  if (n === "vite") return { category: "Build Tool", purpose: "Frontend dev server and bundler", buildTool: "Vite" };
  if (n === "webpack") return { category: "Build Tool", purpose: "Module bundler", buildTool: "Webpack" };
  if (n === "tailwindcss") return { category: "Styling", purpose: "Utility-first CSS framework", framework: "Tailwind CSS" };
  if (n === "prisma" || n === "@prisma/client") return { category: "Database ORM", purpose: "Next-generation ORM" };
  if (n === "mongoose") return { category: "Database ORM", purpose: "MongoDB object modeling" };
  if (n === "pg" || n === "mysql2" || n === "sqlite3") return { category: "Database Client", purpose: "SQL database driver" };
  if (n === "jest" || n === "vitest" || n === "mocha") return { category: "Testing", purpose: "Test runner and assertions" };
  if (n === "axios") return { category: "HTTP Client", purpose: "Promise-based HTTP client" };
  return { category: "Library / Utility", purpose: "Application dependency" };
}

function categorizePythonDep(name: string): { category: string; purpose?: string; framework?: string } {
  const n = name.toLowerCase();
  if (n === "django") return { category: "Web Framework", purpose: "High-level Python web framework", framework: "Django" };
  if (n === "flask") return { category: "Web Framework", purpose: "Lightweight WSGI web framework", framework: "Flask" };
  if (n === "fastapi") return { category: "Web Framework", purpose: "Modern, fast API framework", framework: "FastAPI" };
  if (n === "torch" || n === "pytorch") return { category: "Machine Learning", purpose: "Deep learning tensor library", framework: "PyTorch" };
  if (n === "tensorflow") return { category: "Machine Learning", purpose: "Deep learning framework", framework: "TensorFlow" };
  if (n === "scikit-learn" || n === "sklearn") return { category: "Machine Learning", purpose: "Machine learning algorithms", framework: "Scikit-Learn" };
  if (n === "pandas") return { category: "Data Science", purpose: "Data analysis and manipulation", framework: "Pandas" };
  if (n === "numpy") return { category: "Scientific Computing", purpose: "N-dimensional array computation" };
  if (n === "sqlalchemy") return { category: "Database ORM", purpose: "SQL toolkit and Object Relational Mapper" };
  if (n === "pytest") return { category: "Testing", purpose: "Testing framework" };
  return { category: "Library / Utility", purpose: "Python package" };
}

function isImplicitDependency(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith("@types/") || ["vite", "tsx", "nodemon", "eslint", "prettier", "typescript", "esbuild"].includes(n);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function generateQuickStart(projectType: string, runtimes: string[], buildTools: string[], files: ExtractedFile[]): string {
  const hasPackageJson = files.some((f) => f.name === "package.json");
  const hasRequirements = files.some((f) => f.name === "requirements.txt");
  const hasDocker = files.some((f) => f.name.toLowerCase() === "dockerfile");

  const lines = [`### Quick Start for ${projectType}`];

  if (hasPackageJson) {
    lines.push(
      "1. **Install Dependencies**:",
      "   ```bash",
      "   npm install",
      "   ```",
      "2. **Start Development Server**:",
      "   ```bash",
      "   npm run dev",
      "   ```"
    );
  } else if (hasRequirements) {
    lines.push(
      "1. **Create Virtual Environment & Install**:",
      "   ```bash",
      "   python -m venv venv",
      "   source venv/bin/activate  # On Windows: venv\\Scripts\\activate",
      "   pip install -r requirements.txt",
      "   ```",
      "2. **Run Application**:",
      "   ```bash",
      "   python main.py  # or python app.py",
      "   ```"
    );
  } else if (hasDocker) {
    lines.push(
      "1. **Build & Run via Docker**:",
      "   ```bash",
      "   docker build -t my-project .",
      "   docker run -p 3000:3000 my-project",
      "   ```"
    );
  } else {
    lines.push("Open project directory in your editor or run your local development environment.");
  }

  return lines.join("\n");
}

export function extractProjectIntelligence(
  projectName: string,
  projectId: string,
  files: ExtractedFile[],
  pkgFile: ExtractedFile | undefined,
  readmeContent: string,
  endpoints: ApiEndpoint[],
  dbModels: DatabaseModel[],
  frameworks: string[],
  runtimes: string[],
  buildTools: string[],
  languages: Array<{ name: string; percentage: number }>,
  dependenciesList: DependencyItem[],
  projectType: string,
  archResult: any
): ProjectIntelligence {
  const evidenceSources: string[] = [];

  // Parse package.json description if present
  let pkgDesc = "";
  if (pkgFile?.content) {
    evidenceSources.push(pkgFile.path);
    try {
      const parsed = JSON.parse(pkgFile.content);
      if (parsed.description) pkgDesc = parsed.description;
    } catch {}
  }

  // Parse README for key sections
  let readmeTitle = "";
  let readmeTagline = "";
  let readmeProblem = "";
  let readmeSolution = "";
  let readmeFeatures: string[] = [];

  if (readmeContent) {
    evidenceSources.push("README.md");
    const lines = readmeContent.split(/\r?\n/);
    
    // Find Title
    for (const line of lines) {
      if (line.startsWith("# ")) {
        readmeTitle = line.replace(/^#\s+/, "").trim();
        break;
      }
    }
    
    // Find Tagline (first non-empty text line after title)
    let foundTitle = false;
    for (const line of lines) {
      if (line.startsWith("# ")) {
        foundTitle = true;
        continue;
      }
      if (foundTitle && line.trim() && !line.startsWith("#") && !line.startsWith("![")) {
        readmeTagline = line.trim();
        break;
      }
    }

    // Section-by-section parser for README
    let currentSection = "";
    const sectionContents: Record<string, string[]> = {};

    for (const line of lines) {
      const headerMatch = line.match(/^#{1,4}\s+(.+)$/);
      if (headerMatch) {
        currentSection = headerMatch[1].trim().toLowerCase();
        if (!sectionContents[currentSection]) {
          sectionContents[currentSection] = [];
        }
        continue;
      }
      if (currentSection && line.trim()) {
        sectionContents[currentSection].push(line.trim());
      }
    }

    // Extract Features
    for (const [secName, secLines] of Object.entries(sectionContents)) {
      if (/feature|capability|capabilities|what it does|highlights|key features/i.test(secName)) {
        for (const l of secLines) {
          if (/^[\-*+]\s+/.test(l)) {
            const feat = l.replace(/^[\-*+]\s+/, "").trim();
            if (feat && !readmeFeatures.includes(feat)) readmeFeatures.push(feat);
          } else if (/^\d+\.\s+/.test(l)) {
            const feat = l.replace(/^\d+\.\s+/, "").trim();
            if (feat && !readmeFeatures.includes(feat)) readmeFeatures.push(feat);
          }
        }
      }
      // Extract Problem Statement
      if (/problem|motivation|background|pain\s*point|why\s*this|the\s*issue/i.test(secName)) {
        const text = secLines.join(" ").trim();
        if (text && !readmeProblem) {
          readmeProblem = text;
        }
      }
      // Extract Solution
      if (/solution|how\s*it\s*works|our\s*approach|what\s*we\s*built|the\s*solution|overview|about/i.test(secName)) {
        const text = secLines.join(" ").trim();
        if (text && !readmeSolution) {
          readmeSolution = text;
        }
      }
    }
  }

  const title = readmeTitle || projectName;
  const tagline = readmeTagline || pkgDesc || `${projectType} application built in ${languages[0]?.name || "TypeScript"}.`;

  // Detect AI Components
  const aiLibs = dependenciesList.filter((d) =>
    /genai|generative-ai|openai|anthropic|cohere|langchain|llama_index|transformers|torch|spacy|diffusers|vertexai|gemini/i.test(d.name)
  );

  let hasAiCode = false;
  const aiModelsOrServices: string[] = aiLibs.map((l) => l.name);

  for (const f of files) {
    if (f.isBinary || !f.content) continue;
    if (
      /GoogleGenAI|OpenAI|Anthropic|generateContent|ChatOpenAI|pipeline\(|completion|embedding/i.test(f.content)
    ) {
      hasAiCode = true;
      if (!evidenceSources.includes(f.path)) evidenceSources.push(f.path);
      if (/GoogleGenAI|gemini/i.test(f.content) && !aiModelsOrServices.includes("Google Gemini API")) {
        aiModelsOrServices.push("Google Gemini API");
      }
      if (/OpenAI/i.test(f.content) && !aiModelsOrServices.includes("OpenAI API")) {
        aiModelsOrServices.push("OpenAI API");
      }
    }
  }

  const hasAi = aiLibs.length > 0 || hasAiCode;
  const aiComponents = {
    present: hasAi,
    description: hasAi
      ? `AI functionality integrated using ${aiModelsOrServices.join(", ") || "machine learning SDKs"}.`
      : "Not identified in the uploaded project.",
    modelsOrServices: aiModelsOrServices,
  };

  // Detect RAG Components
  const ragLibs = dependenciesList.filter((d) =>
    /chroma|pinecone|faiss|qdrant|weaviate|pgvector|milvus|rag|vector/i.test(d.name)
  );

  let hasRagCode = false;
  for (const f of files) {
    if (f.isBinary || !f.content) continue;
    if (/rag|vectorstore|similaritySearch|embeddings|chunkDocument|knowledge_chunks/i.test(f.content)) {
      hasRagCode = true;
      if (!evidenceSources.includes(f.path)) evidenceSources.push(f.path);
    }
  }

  const hasRag = ragLibs.length > 0 || hasRagCode;
  const ragComponents = {
    present: hasRag,
    description: hasRag
      ? `RAG and vector retrieval functionality detected across project modules.`
      : "Not identified in the uploaded project.",
    libraries: ragLibs.map((l) => l.name),
  };

function inferRealWorldDomainIntelligence(params: {
  title: string;
  projectName: string;
  tagline: string;
  projectType: string;
  files: ExtractedFile[];
  dbModels: DatabaseModel[];
  endpoints: ApiEndpoint[];
  readmeProblem: string;
  readmeSolution: string;
  hasAi: boolean;
  hasRag: boolean;
  aiModelsOrServices: string[];
}): {
  problemStatement: string;
  proposedSolution: string;
  innovation: string;
  targetUsers: string[];
  useCases: string[];
  impact: string;
} {
  const { title, projectName, tagline, projectType, files, dbModels, endpoints, readmeProblem, readmeSolution, hasAi, hasRag, aiModelsOrServices } = params;

  // Combine project metadata and source keywords for domain matching
  const searchCorpus = [
    title,
    projectName,
    tagline,
    readmeProblem,
    readmeSolution,
    files.map(f => f.path).join(" "),
    dbModels.map(m => m.name).join(" "),
    endpoints.map(e => e.path).join(" ")
  ].join(" ").toLowerCase();

  // 1. Hotel / Hospitality / Room Booking
  if (/hotel|resort|room|reservation|booking|stay|lodging|suite|motel|guest|stayease|accommodation/i.test(searchCorpus)) {
    return {
      problemStatement: readmeProblem || "Manual hotel reservations, phone booking delays, lack of live room availability visibility, and double-booking risks for travelers and hospitality operators.",
      proposedSolution: readmeSolution || `An online hotel reservation platform enabling guests to explore room types, check real-time availability, select dates, and confirm room bookings with instant confirmation.`,
      innovation: hasAi && aiModelsOrServices.length > 0
        ? `Integrates AI-assisted recommendations with real-time room availability discovery and instant booking confirmation.`
        : "Live room availability synchronization, transparent room and amenity filtering, and a frictionless self-service guest booking experience.",
      targetUsers: [
        "Travelers and hotel guests seeking seamless room discovery, date selection, and instant online reservations.",
        "Hotel administrators and front-desk staff managing room allocations, pricing, and guest bookings."
      ],
      useCases: [
        "Guests searching room categories, amenities, and checking live vacancy for upcoming vacation or business stays.",
        "Travelers completing room reservations with instant digital confirmation and booking tracking."
      ],
      impact: "Eliminates booking friction, prevents double-booking errors, and delivers a modern, transparent guest reservation experience."
    };
  }

  // 2. E-Commerce / Online Store / Shopping / Marketplace
  if (/ecommerce|e-commerce|shop|store|cart|checkout|product|catalog|order|inventory|stripe|merchandise/i.test(searchCorpus)) {
    return {
      problemStatement: readmeProblem || "Manual order handling, disjointed product catalogs, and high checkout friction for online shoppers and retail merchants.",
      proposedSolution: readmeSolution || `A modern digital commerce storefront featuring interactive product browsing, real-time cart management, secure checkout, and order tracking.`,
      innovation: hasAi && aiModelsOrServices.length > 0
        ? `Combines AI-powered product recommendations with a real-time shopping cart and streamlined checkout pipeline.`
        : "Dynamic cart synchronization, instant multi-criteria product filtering, and a mobile-responsive shopping experience.",
      targetUsers: [
        "Online shoppers browsing product catalogs, managing carts, and purchasing items securely.",
        "Store administrators managing product listings, inventory levels, and customer orders."
      ],
      useCases: [
        "Customers discovering products, adding items to cart, and completing checkout securely.",
        "Merchants monitoring sales orders, inventory stock, and payment statuses."
      ],
      impact: "Maximizes checkout conversion, streamlines inventory management, and provides a seamless digital shopping journey."
    };
  }

  // 3. Healthcare / Medical / Hospital / Clinic / Patient Management
  if (/health|clinic|hospital|doctor|patient|medical|appointment|prescription|diagnosis|consultation|ehr|emr/i.test(searchCorpus)) {
    return {
      problemStatement: readmeProblem || "Long patient wait times, scattered paper records, and manual appointment scheduling bottlenecks in healthcare clinics.",
      proposedSolution: readmeSolution || `A centralized digital healthcare platform enabling patients to schedule consultations, access medical records, and communicate with clinicians.`,
      innovation: "Instant doctor appointment booking, secure digital health records, and streamlined patient-provider interaction.",
      targetUsers: [
        "Patients scheduling medical appointments and tracking health records.",
        "Doctors and clinic staff managing patient schedules, consultations, and prescriptions."
      ],
      useCases: [
        "Patients finding available doctors and booking digital consultations.",
        "Healthcare staff managing patient history and clinical appointment queues."
      ],
      impact: "Reduces clinical wait times, improves record accuracy, and enhances patient care coordination."
    };
  }

  // 4. Education / LMS / Student Portal / E-Learning
  if (/lms|course|student|education|teacher|quiz|exam|assignment|lesson|classroom|lecture|syllabus|learning/i.test(searchCorpus)) {
    return {
      problemStatement: readmeProblem || "Disorganized study materials, lack of interactive student assessments, and difficult progress monitoring for educators.",
      proposedSolution: readmeSolution || `An engaging learning management system featuring structured course modules, interactive quizzes, and student progress tracking.`,
      innovation: "Structured modular lesson progression, digital assignment submissions, and instant quiz feedback.",
      targetUsers: [
        "Students accessing course lectures, submitting assignments, and taking quizzes.",
        "Instructors and educators creating curriculum content and evaluating student performance."
      ],
      useCases: [
        "Students progressing through multimedia lessons and tracking completion milestones.",
        "Teachers grading student submissions and monitoring class performance."
      ],
      impact: "Enhances student engagement, centralizes learning resources, and automates academic evaluation."
    };
  }

  // 5. FinTech / Finance / Expense Tracker / Banking / Invoicing
  if (/fintech|finance|expense|budget|wallet|bank|transaction|invoice|crypto|payment|accounting|ledger/i.test(searchCorpus)) {
    return {
      problemStatement: readmeProblem || "Fragmented financial tracking, manual expense calculation, and delayed visibility into personal or business cash flow.",
      proposedSolution: readmeSolution || `An intuitive financial platform providing real-time transaction logging, automated expense categorization, and budget analytics.`,
      innovation: "Automated expense categorization, visual spending breakdown, and proactive budget threshold insights.",
      targetUsers: [
        "Individuals and business owners seeking transparent financial and expense management.",
        "Accountants and managers auditing transactions and monitoring budget limits."
      ],
      useCases: [
        "Users logging daily expenses and monitoring monthly budget categories.",
        "Generating financial reports, invoices, and spending summaries."
      ],
      impact: "Provides clear financial transparency, prevents overspending, and automates money management."
    };
  }

  // 6. Food Delivery / Restaurant / Dining / Recipe
  if (/food|restaurant|dining|meal|dish|recipe|menu|delivery|kitchen|chef/i.test(searchCorpus)) {
    return {
      problemStatement: readmeProblem || "Slow manual phone orders, delayed delivery tracking, and static uninformative restaurant menus.",
      proposedSolution: readmeSolution || `An interactive food ordering platform with digital menus, cart customization, and order status updates.`,
      innovation: "Dynamic digital menu browsing with dietary filters and instant order placement.",
      targetUsers: [
        "Customers ordering meals and discovering local restaurant menus.",
        "Restaurant owners and kitchen staff managing orders and menu availability."
      ],
      useCases: [
        "Customers customizing dishes, adding to cart, and placing online food orders.",
        "Kitchen staff updating dish availability and processing incoming food orders."
      ],
      impact: "Accelerates order turnaround, reduces ordering errors, and elevates the dining experience."
    };
  }

  // 7. Social Media / Community / Chat / Collaboration
  if (/social|community|chat|feed|forum|post|comment|friend|follower|message|discussion/i.test(searchCorpus)) {
    return {
      problemStatement: readmeProblem || "Fragmented communication channels and lack of centralized interactive spaces for group discussion.",
      proposedSolution: readmeSolution || `A collaborative social platform offering real-time messaging, topic discussion feeds, and community member profiles.`,
      innovation: "Real-time interactive feed updates, responsive thread discussions, and media sharing.",
      targetUsers: [
        "Community members connecting, chatting, and sharing content online.",
        "Community moderators managing discussions and group guidelines."
      ],
      useCases: [
        "Users creating posts, replying in discussion threads, and sending direct messages.",
        "Groups collaborating on shared topics and community initiatives."
      ],
      impact: "Fosters vibrant community engagement and keeps members connected in real time."
    };
  }

  // 8. Task & Project Management / Productivity
  if (/task|todo|kanban|board|tracker|sprint|agile|scrum|productivity/i.test(searchCorpus)) {
    return {
      problemStatement: readmeProblem || "Chaotic team coordination, missed deadlines, and lack of visual visibility into task progress.",
      proposedSolution: readmeSolution || `A visual workflow management platform featuring interactive task boards, progress tracking, and deadline reminders.`,
      innovation: "Visual drag-and-drop task progression, priority tags, and transparent team status tracking.",
      targetUsers: [
        "Teams and individuals organizing tasks, milestones, and project deliverables.",
        "Project managers overseeing resource allocation and sprint velocity."
      ],
      useCases: [
        "Team members updating task status from Backlog to In-Progress and Done.",
        "Managers tracking milestone deadlines and team productivity."
      ],
      impact: "Keeps teams synchronized, prevents lost deliverables, and boosts operational efficiency."
    };
  }

  // 9. Real Estate / Property / Apartment Rentals
  if (/real\s*estate|property|rental|apartment|house|housing|tenant|landlord|lease/i.test(searchCorpus)) {
    return {
      problemStatement: readmeProblem || "Opaque property availability, fragmented listing details, and slow inquiry responses for home seekers.",
      proposedSolution: readmeSolution || `A transparent property discovery portal with filtered real estate search, amenity showcases, and direct inquiries.`,
      innovation: "Comprehensive neighborhood and amenity filtering with direct vacancy inquiry workflows.",
      targetUsers: [
        "Home seekers and tenants looking for apartments or houses to rent or buy.",
        "Landlords and real estate agents managing listings and tenant inquiries."
      ],
      useCases: [
        "Tenants searching properties by price, location, and bedroom count.",
        "Agents publishing property listings and responding to prospective tenant inquiries."
      ],
      impact: "Simplifies property discovery, reduces rental turnaround time, and connects buyers and sellers directly."
    };
  }

  // 10. Universal Clean Real-World Synthesis
  const cleanTitle = (title || projectName || "Software").replace(/[_-]/g, " ").trim();
  const cleanTagline = tagline && !tagline.toLowerCase().includes("application built in") ? tagline : `A digital ${cleanTitle} solution for responsive user workflows`;
  
  return {
    problemStatement: readmeProblem || `Manual friction, unorganized coordination, and lack of streamlined digital access in ${cleanTitle.toLowerCase()} workflows.`,
    proposedSolution: readmeSolution || `A modern self-service platform designed to streamline ${cleanTitle.toLowerCase()} processes through intuitive user interfaces and automated tracking.`,
    innovation: hasAi && aiModelsOrServices.length > 0
      ? `Integrated intelligent automation powered by ${aiModelsOrServices.join(" & ")} for predictive, responsive user assistance.`
      : hasRag
      ? "Knowledge-grounded retrieval and real-time contextual information delivery."
      : `Streamlined self-service workflows with real-time state updates and responsive design.`,
    targetUsers: [
      `Users and customers utilizing ${cleanTitle} digital services.`,
      `Operators and managers overseeing ${cleanTitle} operations and administration.`
    ],
    useCases: [
      `Users accessing ${cleanTitle} features on web and mobile devices.`,
      `Administrators managing data records, requests, and operational status.`
    ],
    impact: `Automates manual tasks, reduces turnaround latency, and provides a dependable user experience.`
  };
}

  const keyFeatures: string[] = [];
  if (readmeFeatures.length > 0) {
    keyFeatures.push(...readmeFeatures.slice(0, 8));
  }
  if (endpoints.length > 0) {
    keyFeatures.push(`REST API surface providing ${endpoints.length} endpoints across project workflows.`);
  }
  if (dbModels.length > 0) {
    keyFeatures.push(`Structured data persistence model with ${dbModels.length} database entities (${dbModels.map((m) => m.name).slice(0, 4).join(", ")}).`);
  }
  if (hasAi) {
    keyFeatures.push(`Intelligent automated processing powered by ${aiModelsOrServices.join(", ")}.`);
  }
  if (hasRag) {
    keyFeatures.push(`RAG knowledge retrieval for context-aware search.`);
  }
  if (keyFeatures.length === 0) {
    keyFeatures.push(`Complete ${projectType} codebase featuring ${files.length} structured files.`);
  }

  const domainIntel = inferRealWorldDomainIntelligence({
    title,
    projectName,
    tagline,
    projectType,
    files,
    dbModels,
    endpoints,
    readmeProblem,
    readmeSolution,
    hasAi,
    hasRag,
    aiModelsOrServices,
  });

  const purpose = tagline || domainIntel.proposedSolution;
  const problemStatement = readmeProblem || domainIntel.problemStatement;
  const proposedSolution = readmeSolution || domainIntel.proposedSolution;
  const innovation = domainIntel.innovation;
  const targetUsers = domainIntel.targetUsers;
  const useCases = domainIntel.useCases;
  const impact = domainIntel.impact;

  const modules = (archResult.nodes || []).slice(0, 8).map((n: any) => ({
    name: n.label,
    description: n.description || `Module component in ${n.file}`,
    path: n.file,
  }));

  const workflow = (archResult.dataFlow?.steps || []).map((s: any) => `${s.step}. ${s.title}: ${s.description}`);
  if (workflow.length === 0) {
    workflow.push("1. User initiates request through client UI or API endpoint.");
    workflow.push("2. System routes request through backend processing logic.");
    workflow.push("3. Response or data state update is delivered to user.");
  }

  const advantages = [
    `Modular design across ${files.length} codebase files.`,
    `Clean separation of concerns with ${frameworks.join(", ") || "structured"} architecture.`,
  ];

  const limitations = [
    `Requires appropriate environment configurations (e.g. API keys or DB connections) for full deployment.`,
  ];
  const futureScope = [
    `Expanding test coverage and containerized CI/CD deployment pipelines.`,
    `Adding automated analytics and telemetry monitoring.`,
  ];

  const hackathonPitch = {
    duration30to60s: `Hello everyone! Today we present ${title} — ${tagline}.\n\n` +
      `The Problem: ${problemStatement}\n\n` +
      `Our Solution: We built ${title}, a complete ${projectType} engineered with ${languages[0]?.name || "TypeScript"}${frameworks.length > 0 ? " and " + frameworks.join(", ") : ""}. ` +
      `It works by seamlessly routing requests through ${modules.length > 0 ? modules.length + " core modules" : "structured components"}${hasAi ? " with embedded AI capabilities" : ""}.\n\n` +
      `Key Innovation: ${innovation}\n\n` +
      `Impact: ${impact} Thank you!`,
    problem: problemStatement,
    whatWasBuilt: `${title} (${projectType})`,
    solution: proposedSolution,
    beneficiaries: targetUsers.join(", "),
    differentiator: innovation,
    impact,
  };

  return {
    projectIdentity: { title, tagline },
    purpose,
    problemStatement,
    proposedSolution,
    targetUsers,
    keyFeatures,
    technologyStack: {
      primaryLanguage: languages[0]?.name || "TypeScript",
      languages: languages.map((l) => l.name),
      frameworks,
      runtimes,
      databases: dbModels.map((m) => m.name),
      libraries: dependenciesList.slice(0, 10).map((d) => d.name),
      buildTools,
    },
    architecture: archResult.summary || `${projectType} architecture`,
    workflow,
    modules,
    aiComponents,
    ragComponents,
    innovation,
    useCases,
    impact,
    advantages,
    limitations,
    futureScope,
    hackathonPitch,
    evidenceSources,
  };
}
