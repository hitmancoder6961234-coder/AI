import fs from "fs";
import path from "path";
import crypto from "crypto";

export const PROJECTS_DIR = process.env.CLARITY_PROJECTS_DIR || path.resolve(process.cwd(), "data", "projects");

// Ensure the root projects storage directory exists
if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

/**
 * Validates that a projectId is safe and cannot be used for path traversal.
 */
export function validateProjectId(projectId: string): string {
  if (!projectId || typeof projectId !== "string") {
    throw new Error("Invalid project ID: Project ID is required");
  }
  const clean = projectId.trim();
  // Allow alphanumeric characters, underscores, and hyphens
  if (!/^[a-zA-Z0-9_\-]+$/.test(clean)) {
    throw new Error(`Invalid project ID format: "${projectId}". Must contain only alphanumeric, hyphens, or underscores.`);
  }
  return clean;
}

/**
 * Returns the isolated directory path for a project.
 * Automatically creates the folder if autoCreate is true.
 */
export function getProjectStorageDir(projectId: string, autoCreate = true): string {
  const cleanId = validateProjectId(projectId);
  const targetDir = path.resolve(PROJECTS_DIR, cleanId);

  // Security guard against escaping PROJECTS_DIR
  if (!targetDir.startsWith(PROJECTS_DIR + path.sep) && targetDir !== PROJECTS_DIR) {
    throw new Error("Security exception: Project directory escapes project storage boundary.");
  }

  if (autoCreate && !fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  return targetDir;
}

export const resolveProjectFolder = getProjectStorageDir;

/**
 * Resolves the isolated workspace directory for a user-selected project for 'Run & Test' actions.
 * Ensures execution occurs strictly within the project's directory (e.g. data/projects/<projectId> or data/runs/<projectId>),
 * explicitly preventing the execution of Clarity's own source code (process.cwd()).
 */
export function resolveProjectWorkspace(projectId: string): string {
  if (!projectId || typeof projectId !== "string") {
    throw new Error("Invalid project ID: Project ID is required for execution");
  }

  const cleanId = validateProjectId(projectId);
  const runDir = path.resolve(process.cwd(), "data", "runs", cleanId);
  const projectDir = getProjectStorageDir(cleanId, true);
  const targetDir = fs.existsSync(runDir) ? runDir : projectDir;

  const appRootDir = path.resolve(process.cwd());
  const resolvedTargetDir = path.resolve(targetDir);

  // Security check: explicitly prevent executing Clarity's own source code directory
  if (
    resolvedTargetDir === appRootDir ||
    (resolvedTargetDir.startsWith(appRootDir) &&
      !resolvedTargetDir.includes(path.join("data", "projects")) &&
      !resolvedTargetDir.includes(path.join("data", "runs")))
  ) {
    throw new Error(`Security exception: 'Run & Test' actions are restricted to the selected project directory. Cannot execute Clarity source code at "${appRootDir}".`);
  }

  if (!fs.existsSync(resolvedTargetDir)) {
    fs.mkdirSync(resolvedTargetDir, { recursive: true });
  }

  return resolvedTargetDir;
}

/**
 * Normalizes and sanitizes a relative file path inside a project.
 * Strips Windows drive letters, leading slashes, and redundant segments.
 * Blocks any traversal attempts ("..") or null bytes.
 */
export function sanitizeProjectPath(rawPath: string | null | undefined): string {
  if (!rawPath || typeof rawPath !== "string") return "";

  // Check for null bytes or illegal characters
  if (rawPath.indexOf("\0") !== -1) return "";

  // Normalize path separators to forward slash
  let normalized = rawPath.replace(/\\/g, "/").trim();

  // Strip drive letters (e.g. C:/)
  normalized = normalized.replace(/^[a-zA-Z]:/, "");

  // Strip leading and trailing slashes
  normalized = normalized.replace(/^\/+/, "").replace(/\/+$/, "");

  // Resolve dot segments securely
  const parts = normalized.split("/").filter(Boolean);
  const safeParts: string[] = [];

  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      // Direct traversal attempt - reject completely
      return "";
    }
    // Disallow dangerous control characters in path components
    if (/[<>:"|?*]/.test(part)) {
      return "";
    }
    safeParts.push(part);
  }

  return safeParts.join("/");
}

/**
 * Resolves an absolute file path within a project's storage.
 * Strictly guarantees that the path cannot escape the project directory.
 */
export function resolveProjectFilePath(projectId: string, relativePath: string): string {
  const projectDir = getProjectStorageDir(projectId, true);
  const sanitized = sanitizeProjectPath(relativePath);

  if (!sanitized) {
    throw new Error("Invalid or insecure project relative path.");
  }

  const fullPath = path.resolve(projectDir, sanitized);

  // Path containment verification
  if (!fullPath.startsWith(projectDir + path.sep) && fullPath !== projectDir) {
    throw new Error(`Security exception: Path "${relativePath}" escapes project storage directory.`);
  }

  return fullPath;
}

export function writeProjectFilesBatchToDisk(
  projectId: string,
  filesList: Array<{ relativePath: string; content: string | Buffer }>
): void {
  const createdDirs = new Set<string>();
  const projDir = resolveProjectFolder(projectId);
  if (!fs.existsSync(projDir)) {
    fs.mkdirSync(projDir, { recursive: true });
    createdDirs.add(projDir);
  }

  for (const item of filesList) {
    const fullPath = resolveProjectFilePath(projectId, item.relativePath);
    const parentDir = path.dirname(fullPath);
    if (!createdDirs.has(parentDir)) {
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      createdDirs.add(parentDir);
    }
    fs.writeFileSync(fullPath, item.content);
  }
}

/**
 * Writes a file directly to physical disk inside the project's directory.
 * Automatically creates all parent directories.
 * Returns file information including size and sha256 hash.
 */
export function writeProjectFileToDisk(
  projectId: string,
  relativePath: string,
  content: string | Buffer
): { fullPath: string; relativePath: string; size: number; hash: string } {
  const fullPath = resolveProjectFilePath(projectId, relativePath);
  const parentDir = path.dirname(fullPath);

  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(fullPath, content);

  const buffer = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");

  return {
    fullPath,
    relativePath: sanitizeProjectPath(relativePath),
    size: buffer.length,
    hash,
  };
}

/**
 * Reads a file directly from the physical disk inside the project directory.
 * Returns null if the file does not exist.
 */
export function readProjectFileFromDisk(
  projectId: string,
  relativePath: string,
  isBinary = false
): Buffer | string | null {
  try {
    const fullPath = resolveProjectFilePath(projectId, relativePath);
    if (!fs.existsSync(fullPath)) return null;

    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) return null;

    if (isBinary) {
      return fs.readFileSync(fullPath);
    } else {
      return fs.readFileSync(fullPath, "utf-8");
    }
  } catch {
    return null;
  }
}

/**
 * Deletes a physical file on disk from the project directory.
 * Also cleans up empty parent directories up to the project root.
 */
export function deleteProjectFileFromDisk(projectId: string, relativePath: string): boolean {
  try {
    const fullPath = resolveProjectFilePath(projectId, relativePath);
    const projectDir = getProjectStorageDir(projectId, false);

    if (!fs.existsSync(fullPath)) return false;

    fs.unlinkSync(fullPath);

    // Clean up empty parent directories up to projectDir
    let currentDir = path.dirname(fullPath);
    while (currentDir !== projectDir && currentDir.startsWith(projectDir + path.sep)) {
      try {
        const remaining = fs.readdirSync(currentDir);
        if (remaining.length === 0) {
          fs.rmdirSync(currentDir);
          currentDir = path.dirname(currentDir);
        } else {
          break;
        }
      } catch {
        break;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Renames or moves a file on disk within the project directory.
 */
export function renameProjectFileOnDisk(
  projectId: string,
  oldRelativePath: string,
  newRelativePath: string
): boolean {
  try {
    const oldFullPath = resolveProjectFilePath(projectId, oldRelativePath);
    const newFullPath = resolveProjectFilePath(projectId, newRelativePath);

    if (!fs.existsSync(oldFullPath)) return false;

    const newParent = path.dirname(newFullPath);
    if (!fs.existsSync(newParent)) {
      fs.mkdirSync(newParent, { recursive: true });
    }

    fs.renameSync(oldFullPath, newFullPath);

    // Clean up empty old directory
    const projectDir = getProjectStorageDir(projectId, false);
    let currentDir = path.dirname(oldFullPath);
    while (currentDir !== projectDir && currentDir.startsWith(projectDir + path.sep)) {
      try {
        const remaining = fs.readdirSync(currentDir);
        if (remaining.length === 0) {
          fs.rmdirSync(currentDir);
          currentDir = path.dirname(currentDir);
        } else {
          break;
        }
      } catch {
        break;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a physical folder on disk inside the project directory.
 */
export function createProjectFolderOnDisk(projectId: string, folderRelativePath: string): string {
  const sanitized = sanitizeProjectPath(folderRelativePath);
  if (!sanitized || sanitized === "." || sanitized === "/") return getProjectStorageDir(projectId, true);
  const fullPath = resolveProjectFilePath(projectId, sanitized);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
  return fullPath;
}

/**
 * Renames a folder on disk inside the project directory.
 */
export function renameProjectFolderOnDisk(
  projectId: string,
  oldFolderRelativePath: string,
  newFolderRelativePath: string
): boolean {
  try {
    const oldFullPath = resolveProjectFilePath(projectId, oldFolderRelativePath);
    const newFullPath = resolveProjectFilePath(projectId, newFolderRelativePath);

    if (!fs.existsSync(oldFullPath)) return false;

    const newParent = path.dirname(newFullPath);
    if (!fs.existsSync(newParent)) {
      fs.mkdirSync(newParent, { recursive: true });
    }

    fs.renameSync(oldFullPath, newFullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively deletes a folder on disk inside the project directory.
 */
export function deleteProjectFolderOnDisk(projectId: string, folderRelativePath: string): boolean {
  try {
    const fullPath = resolveProjectFilePath(projectId, folderRelativePath);
    if (!fs.existsSync(fullPath)) return false;
    fs.rmSync(fullPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes the entire physical project folder from disk.
 */
export function deleteProjectStorage(projectId: string): boolean {
  try {
    const projectDir = getProjectStorageDir(projectId, false);
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Recursively lists all physical files in a project's storage directory.
 */
export function listProjectDiskFiles(projectId: string): Array<{ path: string; size: number }> {
  const projectDir = getProjectStorageDir(projectId, false);
  if (!fs.existsSync(projectDir)) return [];

  const results: Array<{ path: string; size: number }> = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(projectDir, full).replace(/\\/g, "/");
        const stats = fs.statSync(full);
        results.push({ path: rel, size: stats.size });
      }
    }
  }

  walk(projectDir);
  return results;
}

/**
 * Synchronizes SQLite database state to disk on startup/hydration.
 * If any file recorded in SQLite is missing physically on disk, writes it out immediately.
 */
export function syncDiskFromDatabase(
  projectId: string,
  dbFiles: Array<{ path: string; content?: string | null; is_binary?: boolean | number }>
): void {
  const projectDir = getProjectStorageDir(projectId, true);

  for (const f of dbFiles) {
    try {
      const sanitized = sanitizeProjectPath(f.path);
      if (!sanitized) continue;

      const fullPath = path.resolve(projectDir, sanitized);
      if (!fs.existsSync(fullPath)) {
        const parentDir = path.dirname(fullPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        const content = f.content || "";
        fs.writeFileSync(fullPath, content, "utf-8");
      }
    } catch (err) {
      console.warn(`Failed to sync file "${f.path}" to disk for project ${projectId}:`, err);
    }
  }
}
