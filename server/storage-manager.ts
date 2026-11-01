import os from "os";
import path from "path";
import fs from "fs";

const DEFAULT_LIMIT_BYTES = 50 * 1024 * 1024 * 1024; // 50 GB

export class StorageManager {
  private storageRoot: string;
  private limitBytes: number = DEFAULT_LIMIT_BYTES;

  constructor() {
    this.storageRoot = this.resolveStorageRoot();
    this.ensureDirectories();
    this.migrateLegacyDataIfNeeded();
  }

  public getStorageRoot(): string {
    return this.storageRoot;
  }

  private resolveStorageRoot(): string {
    if (process.env.CLARITY_STORAGE_ROOT) {
      return path.resolve(process.env.CLARITY_STORAGE_ROOT);
    }
    // Default to workspace persistent data folder
    return path.resolve(process.cwd(), "data");
  }

  public ensureDirectories() {
    const dirs = [
      this.storageRoot,
      path.join(this.storageRoot, "projects"),
      path.join(this.storageRoot, "rag"),
      path.join(this.storageRoot, "embeddings"),
      path.join(this.storageRoot, "artifacts"),
      path.join(this.storageRoot, "uploads"),
      path.join(this.storageRoot, "cache"),
      path.join(this.storageRoot, "database"),
    ];
    for (const d of dirs) {
      if (!fs.existsSync(d)) {
        try {
          fs.mkdirSync(d, { recursive: true });
        } catch (err) {
          console.error(`Failed to create storage directory ${d}:`, err);
        }
      }
    }
  }

  private migrateLegacyDataIfNeeded() {
    try {
      const home = os.homedir() || "";
      const legacyPaths: string[] = [];
      if (process.platform === "win32") {
        const appData = process.env.APPDATA || (home ? path.join(home, "AppData", "Roaming") : "");
        if (appData) legacyPaths.push(path.join(appData, "Clarity"));
      } else if (process.platform === "darwin") {
        if (home) legacyPaths.push(path.join(home, "Library", "Application Support", "Clarity"));
      } else {
        const xdgData = process.env.XDG_DATA_HOME || (home ? path.join(home, ".local", "share") : "");
        if (xdgData) legacyPaths.push(path.join(xdgData, "clarity"));
        if (home && home !== "/root") legacyPaths.push(path.join(home, ".local", "share", "clarity"));
        legacyPaths.push("/root/.local/share/clarity");
      }

      const targetDbPath = this.getDatabasePath();
      const targetDbDir = path.dirname(targetDbPath);
      if (!fs.existsSync(targetDbDir)) {
        fs.mkdirSync(targetDbDir, { recursive: true });
      }

      // Check if target DB is missing and can be migrated from a legacy location
      if (!fs.existsSync(targetDbPath)) {
        for (const legacyRoot of legacyPaths) {
          const legacyDb = path.join(legacyRoot, "database", "clarity.db");
          const legacyDbRoot = path.join(legacyRoot, "clarity.db");
          const candidate = fs.existsSync(legacyDb) ? legacyDb : fs.existsSync(legacyDbRoot) ? legacyDbRoot : null;
          if (candidate) {
            console.log(`[StorageManager] Migrating existing database from ${candidate} to ${targetDbPath}...`);
            fs.copyFileSync(candidate, targetDbPath);
            // Also copy WAL & SHM if present
            if (fs.existsSync(`${candidate}-wal`)) {
              fs.copyFileSync(`${candidate}-wal`, `${targetDbPath}-wal`);
            }
            if (fs.existsSync(`${candidate}-shm`)) {
              fs.copyFileSync(`${candidate}-shm`, `${targetDbPath}-shm`);
            }
            break;
          }
        }
      }
    } catch (err) {
      console.warn("[StorageManager] Legacy storage migration warning:", err);
    }
  }

  public getDatabasePath(): string {
    return path.join(this.storageRoot, "database", "clarity.db");
  }

  public getStorageLimit(): number {
    return this.limitBytes;
  }

  public setStorageLimit(bytes: number) {
    if (bytes > 0) {
      this.limitBytes = bytes;
    }
  }

  public getFolderSize(dirPath: string): number {
    let totalSize = 0;
    try {
      if (!fs.existsSync(dirPath)) return 0;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          totalSize += this.getFolderSize(fullPath);
        } else if (entry.isFile()) {
          try {
            const stats = fs.statSync(fullPath);
            totalSize += stats.size;
          } catch {}
        }
      }
    } catch {}
    return totalSize;
  }

  public getStorageBreakdown(): {
    projectsBytes: number;
    ragBytes: number;
    artifactsBytes: number;
    cacheBytes: number;
    databaseBytes: number;
    totalBytes: number;
  } {
    const projectsBytes = this.getFolderSize(path.join(this.storageRoot, "projects")) + this.getFolderSize(path.join(this.storageRoot, "uploads"));
    const ragBytes = this.getFolderSize(path.join(this.storageRoot, "rag")) + this.getFolderSize(path.join(this.storageRoot, "embeddings"));
    const artifactsBytes = this.getFolderSize(path.join(this.storageRoot, "artifacts"));
    const cacheBytes = this.getFolderSize(path.join(this.storageRoot, "cache"));
    const dbPath = this.getDatabasePath();
    let databaseBytes = 0;
    try {
      if (fs.existsSync(dbPath)) {
        databaseBytes = fs.statSync(dbPath).size;
      }
    } catch {}

    const totalBytes = projectsBytes + ragBytes + artifactsBytes + cacheBytes + databaseBytes;
    return {
      projectsBytes,
      ragBytes,
      artifactsBytes,
      cacheBytes,
      databaseBytes,
      totalBytes,
    };
  }

  public getUsedStorage(): number {
    return this.getStorageBreakdown().totalBytes;
  }

  public getAvailableStorage(): number {
    return Math.max(0, this.limitBytes - this.getUsedStorage());
  }

  public getUsagePercent(): number {
    const used = this.getUsedStorage();
    if (this.limitBytes <= 0) return 0;
    return Number(((used / this.limitBytes) * 100).toFixed(2));
  }

  public checkQuota(requiredBytes: number): { allowed: boolean; status: string; message?: string } {
    const used = this.getUsedStorage();
    const percent = this.getUsagePercent();

    if (used + requiredBytes > this.limitBytes) {
      return {
        allowed: false,
        status: "blocked",
        message: "Clarity storage limit reached (50 GB). Free up space or increase the storage limit.",
      };
    }

    if (percent >= 100) {
      return {
        allowed: false,
        status: "critical",
        message: "Clarity storage is 100% full. New uploads and generations are blocked.",
      };
    }

    return { allowed: true, status: percent >= 90 ? "critical_warning" : percent >= 80 ? "warning" : "ok" };
  }

  public resolveSafePath(subDir: string, relativePath: string): string {
    const baseDir = path.join(this.storageRoot, subDir);
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    const cleanRelative = relativePath.replace(/^(\.\.[\/\\])+/, "").replace(/^[/\\]+/, "");
    const resolved = path.resolve(baseDir, cleanRelative);
    const resolvedBase = path.resolve(baseDir);
    if (!resolved.startsWith(resolvedBase)) {
      throw new Error("Path traversal security violation detected.");
    }
    return resolved;
  }
}

export const storageManager = new StorageManager();
