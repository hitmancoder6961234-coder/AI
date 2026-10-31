import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import * as http from "http";
import { v4 as uuidv4 } from "uuid";
import { resolveProjectWorkspace } from "./project-storage";

export { resolveProjectWorkspace };

export interface ServerDiagnostics {
  processRunning: boolean;
  pid?: number;
  port?: number;
  detectedHost: string;
  tcpStatus: "listening" | "not_listening" | "checking" | "none";
  tcpReason?: string;
  httpStatus: "ready" | "failed" | "checking" | "none";
  httpStatusCode?: number;
  httpReason?: string;
  resolvedHost: string;
  resolvedUrl: string;
  previewUrl: string;
  previewMode: "proxy" | "direct";
  isReady: boolean;
  lastChecked: number;
}

export interface TerminalSession {
  id: string;
  projectId: string;
  command: string;
  workingDirectory: string;
  process?: ChildProcess;
  status: "idle" | "starting" | "running" | "stopped" | "failed" | "completed";
  logs: string[];
  exitCode?: number | null;
  startTime?: number;
  port?: number;
  detectedHost?: string;
  diagnostics: ServerDiagnostics;
  title: string;
}

const RUN_DIR = path.join(process.cwd(), "data", "runs");
if (!fs.existsSync(RUN_DIR)) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
}

export const activeSessions = new Map<string, TerminalSession>();
const sessionTimers = new Map<string, NodeJS.Timeout>();

function clearSessionTimer(id: string) {
  const t = sessionTimers.get(id);
  if (t) {
    clearInterval(t);
    sessionTimers.delete(id);
  }
}

export function sanitizeSession(s: TerminalSession | undefined | null) {
  if (!s) return null;
  return {
    id: s.id,
    projectId: s.projectId,
    command: s.command,
    workingDirectory: s.workingDirectory,
    status: s.status,
    logs: Array.isArray(s.logs) ? s.logs : [],
    exitCode: s.exitCode !== undefined ? s.exitCode : null,
    startTime: s.startTime || null,
    port: s.port || null,
    detectedHost: s.detectedHost || "127.0.0.1",
    diagnostics: {
      processRunning: !!s.diagnostics?.processRunning,
      pid: s.diagnostics?.pid || null,
      port: s.diagnostics?.port || null,
      detectedHost: s.diagnostics?.detectedHost || "127.0.0.1",
      tcpStatus: s.diagnostics?.tcpStatus || "none",
      tcpReason: s.diagnostics?.tcpReason || "",
      httpStatus: s.diagnostics?.httpStatus || "none",
      httpStatusCode: s.diagnostics?.httpStatusCode || null,
      httpReason: s.diagnostics?.httpReason || "",
      resolvedHost: s.diagnostics?.resolvedHost || "127.0.0.1",
      resolvedUrl: s.diagnostics?.resolvedUrl || "",
      previewUrl: s.diagnostics?.previewUrl || "",
      previewMode: s.diagnostics?.previewMode || "proxy",
      isReady: !!s.diagnostics?.isReady,
      lastChecked: s.diagnostics?.lastChecked || Date.now(),
    },
    title: s.title || "Terminal",
  };
}

export function getProjectRunDir(projectId: string): string {
  return resolveProjectWorkspace(projectId);
}

export function syncProjectFiles(projectId: string, files: any[]): string {
  const projDir = getProjectRunDir(projectId);
  if (!fs.existsSync(projDir)) {
    fs.mkdirSync(projDir, { recursive: true });
  }

  for (const file of files) {
    if (!file.filename) continue;
    const filePath = path.join(projDir, file.filename);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (file.buffer) {
      fs.writeFileSync(filePath, file.buffer);
    } else if (file.content !== undefined) {
      fs.writeFileSync(filePath, file.content, "utf8");
    }
  }
  return projDir;
}

/**
 * Robustly verify TCP socket listening status on localhost (IPv4 127.0.0.1 and IPv6 ::1)
 */
export async function verifyTcpListening(port: number): Promise<{ listening: boolean; host: string; error?: string }> {
  const testHosts = ["127.0.0.1", "::1", "localhost"];
  let lastError = "Connection failed";

  for (const host of testHosts) {
    const isListening = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(800);

      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });

      socket.on("error", (err: any) => {
        lastError = err.code || err.message;
        socket.destroy();
        resolve(false);
      });

      try {
        socket.connect(port, host);
      } catch (e: any) {
        lastError = e.message;
        resolve(false);
      }
    });

    if (isListening) {
      return { listening: true, host };
    }
  }

  return { listening: false, host: "127.0.0.1", error: lastError };
}

/**
 * Perform an actual HTTP GET request to verify application readiness
 */
export async function checkHttpReadiness(port: number, host = "127.0.0.1"): Promise<{ ready: boolean; statusCode?: number; error?: string }> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host,
        port,
        path: "/",
        timeout: 2000,
        headers: {
          Accept: "text/html,application/xhtml+xml,application/json,*/*",
          "User-Agent": "Clarity-HealthCheck/1.0",
        },
      },
      (res) => {
        // Any HTTP response (including 200, 301, 302, 304, 404) proves server is processing HTTP requests
        const statusCode = res.statusCode || 200;
        res.resume(); // consume stream to free memory
        resolve({
          ready: true,
          statusCode,
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({ ready: false, error: "HTTP request timed out (2000ms)" });
    });

    req.on("error", (err: any) => {
      resolve({ ready: false, error: err.code || err.message });
    });
  });
}

/**
 * Canonical URL resolver for the live preview
 */
/**
 * Canonical URL resolver for the live preview
 */
export function resolvePreviewUrl(port: number, host = "127.0.0.1", entryFile?: string): { resolvedUrl: string; previewUrl: string; previewMode: "proxy" | "direct" } {
  // Check if we are running in an environment where direct port exposure to browser is not available (Cloud Run / container)
  const isContainerOrRemote = process.env.K_SERVICE || process.env.NODE_ENV === "production" || process.env.PORT === "3000";
  const pathSuffix = entryFile ? `/${entryFile}` : "/";
  const proxyUrl = `/api/preview/${port}${pathSuffix}`;
  const directUrl = `http://localhost:${port}${pathSuffix}`;

  if (isContainerOrRemote) {
    return {
      resolvedUrl: proxyUrl,
      previewUrl: proxyUrl,
      previewMode: "proxy",
    };
  }

  return {
    resolvedUrl: directUrl,
    previewUrl: directUrl,
    previewMode: "direct",
  };
}

/**
 * Bulletproof helper to find a free port dynamically.
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      srv.close(() => {
        resolve(port || Math.floor(Math.random() * 10000) + 10000);
      });
    });
    srv.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Scan project workspace for a static HTML entry file (e.g. index.html or hotel_booking.html)
 */
export function getStaticHtmlEntry(projectId: string): string | undefined {
  try {
    const wd = resolveProjectWorkspace(projectId);
    if (fs.existsSync(wd)) {
      const files = fs.readdirSync(wd);
      const htmlFiles = files.filter(f => f.endsWith(".html") || f.endsWith(".htm"));
      if (htmlFiles.length > 0) {
        return htmlFiles.includes("index.html") ? "index.html" : htmlFiles[0];
      }
    }
  } catch (_) {}
  return undefined;
}

export interface DetectedProjectConfig {
  projectType: string;
  runCommand: string;
  testCommand: string;
  buildCommand: string;
  entryFile?: string;
}

/**
 * Inspect actual project files to detect framework, build tools, entry files, and optimal commands.
 */
export function detectProject(projectId: string): DetectedProjectConfig {
  const wd = resolveProjectWorkspace(projectId);
  if (!fs.existsSync(wd)) {
    throw new Error("Project workspace does not exist");
  }

  const files = fs.readdirSync(wd);

  // 1. Node.js / Vite / React / Next.js / Vue / Angular
  if (files.includes("package.json")) {
    const pkgPath = path.join(wd, "package.json");
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const scripts = pkg.scripts || {};

      let type = "Node.js";
      if (deps["next"]) type = "Next.js";
      else if (deps["react"] && deps["vite"]) type = "React + Vite";
      else if (deps["vue"] && deps["vite"]) type = "Vue + Vite";
      else if (deps["@angular/core"]) type = "Angular";
      else if (deps["vue"]) type = "Vue";
      else if (deps["vite"]) type = "Vite";
      else if (deps["react"]) type = "React";

      let runCmd = "npm start";
      if (scripts["dev"]) runCmd = "npm run dev";
      else if (scripts["start"]) runCmd = "npm start";
      else if (scripts["build"]) runCmd = "npm run build";

      let buildCmd = "npm install";
      if (scripts["build"]) buildCmd = "npm run build";

      let testCmd = "npm test";
      if (scripts["test"]) testCmd = "npm run test";

      return { projectType: type, runCommand: runCmd, testCommand: testCmd, buildCommand: buildCmd };
    } catch (e) {
      return { projectType: "Node.js", runCommand: "npm install && npm start", testCommand: "npm test", buildCommand: "npm run build" };
    }
  }

  // 2. Python (Flask / FastAPI / Generic)
  const hasPython = files.some(f => f.endsWith(".py") || f === "requirements.txt" || f === "pyproject.toml");
  if (hasPython) {
    let type = "Python";
    let runCmd = "python3 main.py";
    let buildCmd = "pip install -r requirements.txt";
    let testCmd = "pytest";

    if (files.includes("requirements.txt")) {
      const reqText = fs.readFileSync(path.join(wd, "requirements.txt"), "utf8").toLowerCase();
      if (reqText.includes("fastapi") || reqText.includes("uvicorn")) {
        type = "Python (FastAPI)";
        runCmd = "uvicorn main:app --host 0.0.0.0 --port $PORT";
      } else if (reqText.includes("flask")) {
        type = "Python (Flask)";
        runCmd = "flask run --host 0.0.0.0 --port $PORT";
      }
    }

    if (type === "Python") {
      if (files.includes("app.py")) {
        runCmd = "python3 app.py";
      } else if (files.includes("main.py")) {
        runCmd = "python3 main.py";
      } else {
        const pyFile = files.find(f => f.endsWith(".py") && f !== "setup.py");
        if (pyFile) runCmd = `python3 ${pyFile}`;
      }
    }

    if (!files.includes("requirements.txt")) {
      buildCmd = "";
    }
    return { projectType: type, runCommand: runCmd, testCommand: testCmd, buildCommand: buildCmd };
  }

  // 3. Java Maven
  if (files.includes("pom.xml")) {
    return {
      projectType: "Java (Maven)",
      runCommand: "mvn spring-boot:run",
      buildCommand: "mvn compile",
      testCommand: "mvn test"
    };
  }

  // 4. Java Gradle
  if (files.includes("build.gradle") || files.includes("build.gradle.kts")) {
    const hasWrapper = files.includes("gradlew");
    const gradleCmd = hasWrapper ? "./gradlew" : "gradle";
    return {
      projectType: "Java (Gradle)",
      runCommand: `${gradleCmd} bootRun || ${gradleCmd} run`,
      buildCommand: `${gradleCmd} build`,
      testCommand: `${gradleCmd} test`
    };
  }

  // 5. Go
  if (files.includes("go.mod") || files.some(f => f.endsWith(".go"))) {
    return {
      projectType: "Go",
      runCommand: "go run .",
      buildCommand: "go build .",
      testCommand: "go test ./..."
    };
  }

  // 6. Rust
  if (files.includes("Cargo.toml")) {
    return {
      projectType: "Rust",
      runCommand: "cargo run",
      buildCommand: "cargo build",
      testCommand: "cargo test"
    };
  }

  // 7. Static HTML
  const htmlFiles = files.filter(f => f.endsWith(".html") || f.endsWith(".htm"));
  if (htmlFiles.length > 0) {
    const entry = htmlFiles.includes("index.html") ? "index.html" : htmlFiles[0];
    return {
      projectType: "Static HTML",
      runCommand: "python3 -m http.server $PORT || python -m http.server $PORT",
      buildCommand: "",
      testCommand: "",
      entryFile: entry
    };
  }

  // 8. Generic
  return {
    projectType: "Generic Project",
    runCommand: "bash",
    buildCommand: "",
    testCommand: ""
  };
}

export function resolveEffectiveWorkingDirectory(baseDir: string): string {
  if (!fs.existsSync(baseDir)) return baseDir;
  const rootIndicators = ["package.json", "requirements.txt", "Pipfile", "pom.xml", "build.gradle", "Cargo.toml", "Makefile", "go.mod"];
  for (const ind of rootIndicators) {
    if (fs.existsSync(path.join(baseDir, ind))) return baseDir;
  }
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith("."));
    for (const dir of dirs) {
      const sub = path.join(baseDir, dir.name);
      for (const ind of rootIndicators) {
        if (fs.existsSync(path.join(sub, ind))) return sub;
      }
    }
    if (dirs.length === 1) {
      return path.join(baseDir, dirs[0].name);
    }
  } catch (_) {}
  return baseDir;
}

export function createTerminalSession(projectId: string, command: string, title = "Terminal"): TerminalSession {
  const id = uuidv4();
  const workspaceDir = resolveProjectWorkspace(projectId);
  const session: TerminalSession = {
    id,
    projectId,
    command,
    workingDirectory: resolveEffectiveWorkingDirectory(workspaceDir),
    status: "idle",
    logs: [],
    title,
    diagnostics: {
      processRunning: false,
      detectedHost: "127.0.0.1",
      tcpStatus: "none",
      httpStatus: "none",
      resolvedHost: "127.0.0.1",
      resolvedUrl: "",
      previewUrl: "",
      previewMode: "proxy",
      isReady: false,
      lastChecked: Date.now(),
    },
  };
  activeSessions.set(id, session);
  return session;
}

/**
 * Parse console output for all standard framework dev server host and port declarations
 */
export function detectHostAndPortFromLog(logText: string): { port: number; host?: string } | null {
  // Strip ANSI color codes for robust regex parsing
  const clean = logText.replace(/\x1b\[[0-9;]*m/g, "");

  // 1. Vite / Next / Astro "Local: http://localhost:5173" or "➜ Local: http://localhost:5173/"
  const localMatch = clean.match(/(?:➜\s*)?(?:Local|Network):\s*https?:\/\/([a-zA-Z0-9_\-\.]+):(\d+)/i);
  if (localMatch) {
    return { host: localMatch[1], port: parseInt(localMatch[2], 10) };
  }

  // 2. Generic "http://localhost:3000" or "http://127.0.0.1:8080" or "http://0.0.0.0:5000"
  const urlMatch = clean.match(/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d+)/i);
  if (urlMatch) {
    return { host: urlMatch[1], port: parseInt(urlMatch[2], 10) };
  }

  // 3. "ready on http://..." or "Server running on port 4000" or "Listening on port 8000"
  const readyMatch = clean.match(/(?:ready on|listening on|running at|available on)\s*(?:https?:\/\/([a-zA-Z0-9_\-\.]+):)?(?:port\s*)?(\d+)/i);
  if (readyMatch) {
    const p = parseInt(readyMatch[2], 10);
    if (p > 80 && p < 65536) {
      return { host: readyMatch[1] || "127.0.0.1", port: p };
    }
  }

  // 4. "Port 5173" or "port: 5173"
  const portMatch = clean.match(/(?:^|\s)(?:port|Port):\s*(\d{2,5})/);
  if (portMatch) {
    const p = parseInt(portMatch[1], 10);
    if (p > 80 && p < 65536) {
      return { host: "127.0.0.1", port: p };
    }
  }

  return null;
}

export async function startTerminalSession(sessionId: string): Promise<TerminalSession> {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error("Session not found");

  if (session.status === "running" || session.status === "starting") {
    return session;
  }

  // Clear any existing check interval
  clearSessionTimer(sessionId);

  session.status = "starting";
  session.startTime = Date.now();
  session.logs = [];
  session.exitCode = undefined;
  session.port = undefined;
  session.detectedHost = "127.0.0.1";

  session.diagnostics = {
    processRunning: true,
    detectedHost: "127.0.0.1",
    tcpStatus: "checking",
    httpStatus: "checking",
    resolvedHost: "127.0.0.1",
    resolvedUrl: "",
    previewUrl: "",
    previewMode: "proxy",
    isReady: false,
    lastChecked: Date.now(),
  };

  // Safe isolated switching logic: Terminate active sessions in other projects
  for (const [id, s] of activeSessions.entries()) {
    if (s.projectId !== session.projectId && (s.status === "running" || s.status === "starting")) {
      try {
        stopTerminalSession(id);
      } catch (_) {}
    }
  }

  // Detect and assign free port
  let port: number | undefined = undefined;
  const isServerKeyword = session.command.includes("$PORT") || 
                          session.title.toLowerCase().includes("run") || 
                          session.command.toLowerCase().includes("server") || 
                          session.command.toLowerCase().includes("dev") || 
                          session.command.toLowerCase().includes("start");

  if (isServerKeyword) {
    try {
      port = await findFreePort();
      session.port = port;
      session.diagnostics.port = port;
    } catch (e) {
      console.error("Failed to find free port, fallback to 3000:", e);
      port = 3000;
      session.port = port;
      session.diagnostics.port = port;
    }
  }

  const addLog = (msg: string) => {
    session.logs.push(msg);
    if (session.logs.length > 5000) session.logs.shift();

    // Check for host and port updates (supports dynamic port switching, e.g., 5173 -> 5174)
    const detected = detectHostAndPortFromLog(msg);
    if (detected && detected.port && detected.port !== session.port) {
      session.port = detected.port;
      session.detectedHost = detected.host || "127.0.0.1";
      session.diagnostics.port = detected.port;
      session.diagnostics.detectedHost = session.detectedHost;

      const isStaticHtml = getStaticHtmlEntry(session.projectId) && !fs.existsSync(path.join(resolveProjectWorkspace(session.projectId), "package.json"));
      const entryFile = isStaticHtml ? getStaticHtmlEntry(session.projectId) : undefined;

      const { resolvedUrl, previewUrl, previewMode } = resolvePreviewUrl(detected.port, session.detectedHost, entryFile);
      session.diagnostics.resolvedUrl = resolvedUrl;
      session.diagnostics.previewUrl = previewUrl;
      session.diagnostics.previewMode = previewMode;

      // Trigger immediate readiness check
      runDiagnosticsCheck(session);
    }
  };

  addLog(`\x1b[90m$ ${session.command}\x1b[0m\n`);
  if (session.command === "bash" || session.command === "sh") {
    addLog(`\x1b[36m✓ Clarity Terminal Ready\x1b[0m\n\x1b[90mWorking Directory: ${session.workingDirectory}\x1b[0m\n\x1b[90mType any shell command (e.g. ls, pwd, git status) and press Enter.\x1b[0m\n\n`);
  }

  // Ensure host binding is accessible if running inside container or preview mode
  let finalCommand = session.command;
  if (port) {
    finalCommand = finalCommand.replace(/\$PORT/g, String(port));
  }

  // Smart port mapping for frameworks
  if (port) {
    if (/\bvite\b/i.test(finalCommand) && !finalCommand.includes("--port")) {
      finalCommand += ` -- --port ${port} --host 0.0.0.0`;
    } else if (/\bnext\b/i.test(finalCommand) && !finalCommand.includes("-p") && !finalCommand.includes("--port")) {
      finalCommand += ` -- -p ${port} -H 0.0.0.0`;
    }
  }

  const envVars: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: port ? String(port) : undefined,
    HOST: "0.0.0.0", // bind safely to all interfaces so local & proxy can reach
    FORCE_COLOR: "1",
  };

  const proc = spawn(finalCommand, {
    cwd: session.workingDirectory,
    shell: true,
    env: envVars,
  });

  session.process = proc;
  session.status = "running";
  session.diagnostics.processRunning = true;
  session.diagnostics.pid = proc.pid;

  proc.stdout?.on("data", (data) => {
    addLog(data.toString());
  });

  proc.stderr?.on("data", (data) => {
    addLog(data.toString());
  });

  proc.on("close", (code) => {
    session.status = code === 0 ? "completed" : "failed";
    session.exitCode = code;
    session.diagnostics.processRunning = false;
    session.diagnostics.isReady = false;
    session.diagnostics.tcpStatus = "not_listening";
    session.diagnostics.httpStatus = "failed";
    session.diagnostics.httpReason = `Process exited with code ${code}`;
    clearSessionTimer(session.id);
    addLog(`\n\x1b[90m[Process exited with code ${code}]\x1b[0m\n`);
  });

  proc.on("error", (err) => {
    session.status = "failed";
    session.diagnostics.processRunning = false;
    session.diagnostics.isReady = false;
    session.diagnostics.tcpStatus = "not_listening";
    session.diagnostics.httpStatus = "failed";
    session.diagnostics.httpReason = `Execution Error: ${err.message}`;
    clearSessionTimer(session.id);
    addLog(`\n\x1b[31m[Execution Error: ${err.message}]\x1b[0m\n`);
  });

  // Start background periodic health check
  const timer = setInterval(() => {
    if (session.status === "running" && session.port) {
      runDiagnosticsCheck(session);
    }
  }, 2000);
  sessionTimers.set(sessionId, timer);

  return session;
}

/**
 * Execute real TCP and HTTP diagnostics against the session's detected port
 */
export async function runDiagnosticsCheck(session: TerminalSession): Promise<ServerDiagnostics> {
  if (!session.port) {
    session.diagnostics.lastChecked = Date.now();
    return session.diagnostics;
  }

  const port = session.port;
  session.diagnostics.port = port;
  session.diagnostics.processRunning = !!(session.process && !session.process.killed && session.process.exitCode === null);

  if (!session.diagnostics.processRunning) {
    session.diagnostics.tcpStatus = "not_listening";
    session.diagnostics.httpStatus = "failed";
    session.diagnostics.httpReason = "Process is not running";
    session.diagnostics.isReady = false;
    session.diagnostics.lastChecked = Date.now();
    return session.diagnostics;
  }

  // 1. TCP Check
  const tcpRes = await verifyTcpListening(port);
  if (tcpRes.listening) {
    session.diagnostics.tcpStatus = "listening";
    session.diagnostics.tcpReason = `Listening on ${tcpRes.host}:${port}`;
    session.diagnostics.resolvedHost = tcpRes.host;
  } else {
    session.diagnostics.tcpStatus = "not_listening";
    session.diagnostics.tcpReason = tcpRes.error || "Port refused connection";
    session.diagnostics.httpStatus = "failed";
    session.diagnostics.httpReason = "TCP connection refused";
    session.diagnostics.isReady = false;
    session.diagnostics.lastChecked = Date.now();
    return session.diagnostics;
  }

  // 2. HTTP Check
  const httpRes = await checkHttpReadiness(port, session.diagnostics.resolvedHost);
  if (httpRes.ready) {
    session.diagnostics.httpStatus = "ready";
    session.diagnostics.httpStatusCode = httpRes.statusCode;
    session.diagnostics.httpReason = `HTTP ${httpRes.statusCode} OK`;
    session.diagnostics.isReady = true;

    const isStaticHtml = getStaticHtmlEntry(session.projectId) && !fs.existsSync(path.join(resolveProjectWorkspace(session.projectId), "package.json"));
    const entryFile = isStaticHtml ? getStaticHtmlEntry(session.projectId) : undefined;

    const urls = resolvePreviewUrl(port, session.diagnostics.resolvedHost, entryFile);
    session.diagnostics.resolvedUrl = urls.resolvedUrl;
    session.diagnostics.previewUrl = urls.previewUrl;
    session.diagnostics.previewMode = urls.previewMode;
  } else {
    session.diagnostics.httpStatus = "failed";
    session.diagnostics.httpReason = httpRes.error || "HTTP check failed";
    session.diagnostics.isReady = false;
  }

  session.diagnostics.lastChecked = Date.now();
  return session.diagnostics;
}

/**
 * Terminate process and entire process tree cleanly on both Windows and Unix
 */
export function stopTerminalSession(sessionId: string): TerminalSession {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error("Session not found");

  clearSessionTimer(sessionId);

  if (session.process && !session.process.killed && (session.status === "running" || session.status === "starting")) {
    const pid = session.process.pid;
    if (pid) {
      if (process.platform === "win32") {
        // Windows process tree kill
        try {
          spawn("taskkill", ["/pid", String(pid), "/T", "/F"]);
        } catch (_) {
          session.process.kill("SIGKILL");
        }
      } else {
        // Unix process termination
        try {
          process.kill(-pid, "SIGTERM");
        } catch (_) {
          session.process.kill("SIGTERM");
        }
        setTimeout(() => {
          try {
            if (session.process && !session.process.killed) session.process.kill("SIGKILL");
          } catch (_) {}
        }, 500);
      }
    }
    session.status = "stopped";
    session.diagnostics.processRunning = false;
    session.diagnostics.isReady = false;
    session.diagnostics.tcpStatus = "not_listening";
    session.diagnostics.httpStatus = "failed";
    session.diagnostics.httpReason = "Process terminated by user";
    session.logs.push("\n\x1b[33m[Process terminated by user]\x1b[0m\n");
  } else {
    session.status = "stopped";
    session.diagnostics.processRunning = false;
    session.diagnostics.isReady = false;
  }

  return session;
}

export function sendInputToSession(sessionId: string, input: string) {
  const session = activeSessions.get(sessionId);
  if (session && (session.status === "running" || session.status === "starting")) {
    session.logs.push(`\x1b[32m$\x1b[0m ${input}\n`);
    if (session.process?.stdin && !session.process.stdin.destroyed) {
      session.process.stdin.write(input + "\n");
    }
  }
}

export function getProjectSessions(projectId: string): TerminalSession[] {
  const sessions: TerminalSession[] = [];
  for (const session of activeSessions.values()) {
    if (session.projectId === projectId) sessions.push(session);
  }
  return sessions;
}
