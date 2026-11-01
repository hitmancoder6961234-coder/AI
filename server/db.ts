import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { storageManager } from "./storage-manager.js";
import { aivenConfigured, mirrorMessage } from "./security/aiven.js";
import {
  syncProjectToSupabase,
  deleteProjectFromSupabase,
  syncProjectFileToSupabase,
  syncArtifactToSupabase,
  syncConversationToSupabase,
  deleteConversationFromSupabase,
  syncMessageToSupabase,
  syncKnowledgeChunkToSupabase,
  deleteKnowledgeChunksFromSupabase,
  syncModelToSupabase,
  deleteModelFromSupabase,
  syncUserToSupabase,
  syncSessionToSupabase,
  deleteSessionFromSupabase,
  syncWorkspaceFileToSupabase,
  deleteWorkspaceFileFromSupabase,
  isSupabaseConfigured
} from "./supabase.js";

// Ensure storage database directory exists via storageManager
const DB_PATH = process.env.CLARITY_DB_PATH || storageManager.getDatabasePath();
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize Database connection
export const db = new DatabaseSync(DB_PATH);

/**
 * Ensures any identifier is formatted as a valid UUID.
 * Matches the logic in supabase.ts to eliminate ID mismatch during hydration.
 */
export function toValidUuid(val?: string | null): string | null {
  if (!val) return null;
  const str = String(val).trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    return str.toLowerCase();
  }
  const hash = crypto.createHash("md5").update(str).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

// Utility to sanitize parameters for strict node:sqlite binding
export function safeParam(val: any): string | number | bigint | Uint8Array | null {
  if (val === undefined || val === null) return null;
  if (typeof val === "boolean") return val ? 1 : 0;
  if (typeof val === "number") {
    if (Number.isNaN(val) || !Number.isFinite(val)) return null;
    return val;
  }
  if (typeof val === "string" || typeof val === "bigint" || val instanceof Uint8Array || Buffer.isBuffer(val)) {
    return val;
  }
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

// Global wrap on db.prepare to guarantee no SQLite parameter binding crashes
const originalPrepare = db.prepare.bind(db);
(db as any).prepare = function (sql: string) {
  const stmt = originalPrepare(sql);
  (stmt as any).source = sql;
  (stmt as any).sql = sql;
  const origRun = stmt.run.bind(stmt);
  const origGet = stmt.get.bind(stmt);
  const origAll = stmt.all.bind(stmt);

  stmt.run = function (...args: any[]) {
    const cleanArgs = args.map(safeParam);
    try {
      return origRun(...cleanArgs);
    } catch (err: any) {
      console.error(`[SQLite Error] in query: ${sql}\nParams:`, cleanArgs, "\nError:", err);
      throw err;
    }
  };

  stmt.get = function (...args: any[]) {
    const cleanArgs = args.map(safeParam);
    try {
      return origGet(...cleanArgs);
    } catch (err: any) {
      console.error(`[SQLite Error] in query: ${sql}\nParams:`, cleanArgs, "\nError:", err);
      throw err;
    }
  };

  stmt.all = function (...args: any[]) {
    const cleanArgs = args.map(safeParam);
    try {
      return origAll(...cleanArgs);
    } catch (err: any) {
      console.error(`[SQLite Error] in query: ${sql}\nParams:`, cleanArgs, "\nError:", err);
      throw err;
    }
  };

  return stmt;
};

// Enable WAL mode and foreign keys
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA synchronous = NORMAL;");

/**
 * Execute a function within an ACID transaction
 */
export function runTransaction<T>(fn: () => T): T {
  db.exec("BEGIN TRANSACTION;");
  try {
    const result = fn();
    db.exec("COMMIT;");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch (rbErr) {
      console.error("Rollback failed:", rbErr);
    }
    throw err;
  }
}

/**
 * Initialize / verify database schema and migrations
 */
export function initDatabaseSchema() {
  runTransaction(() => {
    // 1. Projects
    try {
      const info = db.prepare("PRAGMA table_info(projects)").all() as any[];
      if (info.length > 0 && !info.some(c => c.name === 'user_id')) {
        db.exec(`
          DROP TABLE IF EXISTS projects_old;
          ALTER TABLE projects RENAME TO projects_old;
          CREATE TABLE projects (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL DEFAULT 'user_default',
            name TEXT NOT NULL,
            description TEXT,
            source_type TEXT DEFAULT 'upload',
            root_path TEXT,
            status TEXT DEFAULT 'ready',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_indexed_at INTEGER,
            metadata TEXT
          );
          INSERT INTO projects (id, user_id, name, description, source_type, root_path, status, created_at, updated_at, last_indexed_at, metadata)
          SELECT id, 'user_default', name, description, source_type, root_path, status, created_at, updated_at, last_indexed_at, metadata FROM projects_old;
          DROP TABLE IF EXISTS projects_old;
        `);
      }
    } catch (e) {
      console.error("Migration error for projects.user_id:", e);
      try {
        db.exec("DROP TABLE IF EXISTS projects_old;");
      } catch {}
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'user_default',
        name TEXT NOT NULL,
        description TEXT,
        source_type TEXT DEFAULT 'upload',
        root_path TEXT,
        status TEXT DEFAULT 'ready',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_indexed_at INTEGER,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
      CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at);
    `);

    // 2. Project Files
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_files (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        extension TEXT,
        language TEXT,
        size INTEGER DEFAULT 0,
        hash TEXT,
        version INTEGER DEFAULT 1,
        content TEXT,
        is_binary INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_project_files_proj ON project_files(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_files_path ON project_files(project_id, path);
      CREATE INDEX IF NOT EXISTS idx_project_files_hash ON project_files(hash);
    `);

    // Clean up duplicate project files if any exist from older imports
    try {
      db.exec("DELETE FROM project_files WHERE rowid NOT IN (SELECT MIN(rowid) FROM project_files GROUP BY project_id, path);");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_project_files_unique_path ON project_files(project_id, path);");
    } catch (idxErr) {}

    // 3. Artifacts
    db.exec(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        file_id TEXT,
        name TEXT NOT NULL,
        path TEXT,
        mime_type TEXT,
        artifact_type TEXT,
        version INTEGER DEFAULT 1,
        hash TEXT,
        content TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_proj ON artifacts(project_id);
    `);

    // 4. Knowledge Chunks
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        file_id TEXT,
        chunk_id TEXT,
        content TEXT NOT NULL,
        chunk_type TEXT,
        symbol TEXT,
        start_line INTEGER,
        end_line INTEGER,
        hash TEXT,
        version INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_proj ON knowledge_chunks(project_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_file ON knowledge_chunks(file_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_hash ON knowledge_chunks(hash);
    `);

    // 4b. Knowledge Sources
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        extension TEXT,
        file_type TEXT,
        size INTEGER DEFAULT 0,
        chunks_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'Indexed',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_sources_proj ON knowledge_sources(project_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_sources_path ON knowledge_sources(project_id, path);
    `);

    // 5. Architecture Nodes
    db.exec(`
      CREATE TABLE IF NOT EXISTS architecture_nodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        node_type TEXT,
        name TEXT NOT NULL,
        file_id TEXT,
        metadata TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_arch_nodes_proj ON architecture_nodes(project_id);
    `);

    // 6. Architecture Edges
    db.exec(`
      CREATE TABLE IF NOT EXISTS architecture_edges (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        relationship TEXT,
        confidence REAL DEFAULT 1.0,
        evidence TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_arch_edges_proj ON architecture_edges(project_id);
    `);

    // 7. Diagnostics
    db.exec(`
      CREATE TABLE IF NOT EXISTS diagnostics (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        file_id TEXT,
        severity TEXT,
        category TEXT,
        message TEXT NOT NULL,
        line INTEGER,
        column INTEGER,
        status TEXT DEFAULT 'open',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_diagnostics_proj ON diagnostics(project_id);
    `);

    // 8. Test Runs
    db.exec(`
      CREATE TABLE IF NOT EXISTS test_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        command TEXT,
        status TEXT,
        output TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_test_runs_proj ON test_runs(project_id);
    `);

    // 9. GitHub Connections
    db.exec(`
      CREATE TABLE IF NOT EXISTS github_connections (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        repository TEXT NOT NULL,
        branch TEXT NOT NULL,
        sync_status TEXT DEFAULT 'synced',
        last_synced_at INTEGER,
        metadata TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_github_conn_proj ON github_connections(project_id);
    `);

    // 10. Project Analyses (Structured JSON payload)
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_analyses (
        project_id TEXT PRIMARY KEY,
        summary TEXT,
        project_type TEXT,
        primary_language TEXT,
        analysis_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
    `);

    // 11. Conversations
    try {
      const info = db.prepare("PRAGMA table_info(conversations)").all() as any[];
      if (info.length > 0 && !info.some(c => c.name === 'user_id')) {
        db.exec(`
          ALTER TABLE conversations RENAME TO conversations_old;
          CREATE TABLE conversations (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL DEFAULT 'user_default',
            project_id TEXT,
            title TEXT NOT NULL,
            model_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
          INSERT INTO conversations (id, user_id, project_id, title, model_id, created_at, updated_at)
          SELECT id, 'user_default', project_id, title, model_id, created_at, updated_at FROM conversations_old;
          DROP TABLE conversations_old;
        `);
      }
    } catch (e) {
      console.error("Migration error for conversations.user_id:", e);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'user_default',
        project_id TEXT,
        title TEXT NOT NULL,
        model_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_proj ON conversations(project_id);
    `);

    // 12. Messages
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        model_id TEXT,
        attachments TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
    `);

    // 13. Workspace Files (General uploads)
    try {
      const info = db.prepare("PRAGMA table_info(workspace_files)").all() as any[];
      if (info.length > 0 && !info.some(c => c.name === 'user_id')) {
        db.exec(`
          ALTER TABLE workspace_files RENAME TO workspace_files_old;
          CREATE TABLE workspace_files (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL DEFAULT 'user_default',
            filename TEXT NOT NULL,
            mime TEXT,
            size INTEGER DEFAULT 0,
            file_type TEXT,
            content TEXT,
            uploaded_at INTEGER NOT NULL
          );
          INSERT INTO workspace_files (id, user_id, filename, mime, size, file_type, content, uploaded_at)
          SELECT id, 'user_default', filename, mime, size, file_type, content, uploaded_at FROM workspace_files_old;
          DROP TABLE workspace_files_old;
        `);
      }
    } catch (e) {
      console.error("Migration error for workspace_files.user_id:", e);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_files (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'user_default',
        filename TEXT NOT NULL,
        mime TEXT,
        size INTEGER DEFAULT 0,
        file_type TEXT,
        content TEXT,
        uploaded_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_files_user ON workspace_files(user_id);
    `);

    // 14. Users
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password TEXT,
        active_model_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);

    // 15. Sessions
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    `);

    // 16. Models
    db.exec(`
      CREATE TABLE IF NOT EXISTS models (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'user_default',
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        base_url TEXT,
        api_key TEXT,
        model_name TEXT NOT NULL,
        model_type TEXT,
        capabilities TEXT,
        context_window INTEGER,
        max_output_tokens INTEGER,
        default_temperature REAL,
        default_top_p REAL,
        supports_streaming INTEGER DEFAULT 1,
        enabled INTEGER DEFAULT 1,
        status TEXT,
        is_user INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, id)
      );
    `);
    try {
      db.exec(`ALTER TABLE models ADD COLUMN user_id TEXT DEFAULT 'user_default'`);
    } catch (e) {}

    try {
      const tableInfo = db.prepare("PRAGMA table_info(models)").all() as any[];
      const pkCols = tableInfo.filter(c => c.pk > 0);
      if (pkCols.length === 1 && pkCols[0].name === 'id') {
        db.exec(`
          CREATE TABLE IF NOT EXISTS models_new (
            id TEXT NOT NULL,
            user_id TEXT NOT NULL DEFAULT 'user_default',
            name TEXT NOT NULL,
            provider TEXT NOT NULL,
            base_url TEXT,
            api_key TEXT,
            model_name TEXT NOT NULL,
            model_type TEXT,
            capabilities TEXT,
            context_window INTEGER,
            max_output_tokens INTEGER,
            default_temperature REAL,
            default_top_p REAL,
            supports_streaming INTEGER DEFAULT 1,
            enabled INTEGER DEFAULT 1,
            status TEXT,
            is_user INTEGER DEFAULT 0,
            PRIMARY KEY (user_id, id)
          );
          INSERT OR IGNORE INTO models_new SELECT id, COALESCE(user_id, 'user_default'), name, provider, base_url, api_key, model_name, model_type, capabilities, context_window, max_output_tokens, default_temperature, default_top_p, supports_streaming, enabled, status, is_user FROM models;
          DROP TABLE models;
          ALTER TABLE models_new RENAME TO models;
        `);
      }
    } catch (e) {}

    db.exec(`CREATE INDEX IF NOT EXISTS idx_models_user_id ON models(user_id);`);

    // 16b. Deleted Models Tombstone (ensures permanently deleted models never reappear)
    db.exec(`
      CREATE TABLE IF NOT EXISTS deleted_models (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        deleted_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_deleted_models_user ON deleted_models(user_id);
    `);

    // 17. Visual Assets
    db.exec(`
      CREATE TABLE IF NOT EXISTS visual_assets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        prompt TEXT,
        asset_type TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        filename TEXT NOT NULL,
        content_base64 TEXT NOT NULL,
        source TEXT DEFAULT 'ai_generator',
        model TEXT,
        dimensions TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_visual_assets_proj ON visual_assets(project_id);
    `);

    // 18. Legacy 'user_default' & Raw string user ID migration to UUIDs
    try {
      const userMappings = [
        { from: 'user_default', to: 'a8331e01-8219-c7e0-27ba-93b91f0c20aa' },
        { from: 'CLARITY-DELAYED-PERSISTENCE-TEST', to: '28f9382a-dced-f01b-bbbb-b23a6c677faa' }
      ];
      
      for (const map of userMappings) {
        try {
          db.prepare("UPDATE OR IGNORE users SET id = ? WHERE id = ?").run(map.to, map.from);
        } catch {}
        try {
          db.prepare("UPDATE OR IGNORE sessions SET user_id = ? WHERE user_id = ?").run(map.to, map.from);
        } catch {}
        try {
          db.prepare("UPDATE OR IGNORE projects SET user_id = ? WHERE user_id = ?").run(map.to, map.from);
        } catch {}
        try {
          db.prepare("UPDATE OR IGNORE conversations SET user_id = ? WHERE user_id = ?").run(map.to, map.from);
        } catch {}
        try {
          db.prepare("UPDATE OR IGNORE workspace_files SET user_id = ? WHERE user_id = ?").run(map.to, map.from);
        } catch {}
        try {
          db.prepare("UPDATE OR IGNORE models SET user_id = ? WHERE user_id = ?").run(map.to, map.from);
        } catch {}
      }
    } catch (migrateErr) {
      console.error("Failed to run user id migration:", migrateErr);
    }

    // 19. Seed baseline system users and projects to satisfy foreign key constraints
    try {
      const defaultUserId = "a8331e01-8219-c7e0-27ba-93b91f0c20aa";
      const now = Date.now();
      db.prepare(`
        INSERT OR IGNORE INTO users (id, email, name, password, created_at)
        VALUES (?, ?, ?, NULL, ?)
      `).run(defaultUserId, "default@clarity.local", "Default User", now);

      db.prepare(`
        INSERT OR IGNORE INTO users (id, email, name, password, created_at)
        VALUES (?, ?, ?, NULL, ?)
      `).run("user_default", "legacy-default@clarity.local", "Default User", now);

      const defaultProjects = [
        { id: "global", name: "Global Workspace", desc: "Global workspace project context" }
      ];

      for (const dp of defaultProjects) {
        db.prepare(`
          INSERT OR IGNORE INTO projects (id, user_id, name, description, source_type, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'system', 'ready', ?, ?)
        `).run(dp.id, defaultUserId, dp.name, dp.desc, now, now);
      }
    } catch (seedErr) {
      console.error("Baseline seeding notice:", seedErr);
    }
  });
}

/**
 * Ensures a user row exists in SQLite to satisfy foreign key constraints.
 */
export function ensureUserExists(userId?: string | null, email?: string, name?: string): string {
  const validId = toValidUuid(userId || "user_default") || "a8331e01-8219-c7e0-27ba-93b91f0c20aa";
  const now = Date.now();
  const safeEmail = (email || `${validId}@clarity.local`).toLowerCase().trim();
  const safeName = (name || "User").trim();
  try {
    db.prepare(`
      INSERT OR IGNORE INTO users (id, email, name, created_at)
      VALUES (?, ?, ?, ?)
    `).run(validId, safeEmail, safeName, now);
  } catch {}
  return validId;
}

/**
 * Ensures a project row exists in SQLite to satisfy foreign key constraints.
 */
export function ensureProjectExists(projectId?: string | null, userId?: string, name?: string): string {
  const pid = String(projectId || "global").trim() || "global";
  const validUserId = ensureUserExists(userId || "user_default");
  const now = Date.now();
  try {
    db.prepare(`
      INSERT OR IGNORE INTO projects (id, user_id, name, description, source_type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'system', 'ready', ?, ?)
    `).run(pid, validUserId, name || (pid === "global" ? "Global Workspace" : `Project ${pid}`), "Auto-provisioned project context", now, now);
  } catch {}
  return pid;
}

/**
 * Ensures a conversation row exists in SQLite to satisfy foreign key constraints.
 */
export function ensureConversationExists(conversationId?: string | null, userId?: string, title?: string): string {
  const cid = String(conversationId || "default_conv").trim() || "default_conv";
  const validUserId = ensureUserExists(userId || "user_default");
  const now = Date.now();
  try {
    db.prepare(`
      INSERT OR IGNORE INTO conversations (id, user_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(cid, validUserId, title || "Chat Conversation", now, now);
  } catch {}
  return cid;
}

// ---------------------------------------------------------------------------
// Typed CRUD Interface & Services
// ---------------------------------------------------------------------------

export interface DbProject {
  id: string;
  user_id: string;
  name: string;
  description: string;
  source_type: string;
  root_path: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  last_indexed_at: number | null;
  metadata: string | null; // JSON string
}

export interface DbProjectFile {
  id: string;
  project_id: string;
  path: string;
  name: string;
  extension: string;
  language: string;
  size: number;
  hash: string;
  version: number;
  content: string;
  is_binary: number;
  created_at: number;
  updated_at: number;
}

export interface DbArtifact {
  id: string;
  project_id: string;
  file_id: string | null;
  name: string;
  path: string | null;
  mime_type: string | null;
  artifact_type: string | null;
  version: number;
  hash: string | null;
  content: string | null;
  created_at: number;
  updated_at: number;
}

export interface DbKnowledgeChunk {
  id: string;
  project_id: string;
  file_id: string;
  chunk_id: string;
  content: string;
  chunk_type: string;
  symbol: string;
  start_line: number;
  end_line: number;
  hash: string;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface DbKnowledgeSource {
  id: string;
  project_id: string;
  path: string;
  name: string;
  extension: string;
  file_type: string;
  size: number;
  chunks_count: number;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface DbArchitectureNode {
  id: string;
  project_id: string;
  node_type: string;
  name: string;
  file_id: string | null;
  metadata: string | null;
}

export interface DbArchitectureEdge {
  id: string;
  project_id: string;
  source_node_id: string;
  target_node_id: string;
  relationship: string;
  confidence: number;
  evidence: string | null;
}

export interface DbDiagnostic {
  id: string;
  project_id: string;
  file_id: string | null;
  severity: string;
  category: string;
  message: string;
  line: number | null;
  column: number | null;
  status: string;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Projects Service
// ---------------------------------------------------------------------------
export function parseMetadataSafely(raw: any): any {
  if (!raw) return {};
  let cur = raw;
  for (let i = 0; i < 3; i++) {
    if (typeof cur === "string") {
      try {
        cur = JSON.parse(cur);
      } catch {
        break;
      }
    } else {
      break;
    }
  }
  return typeof cur === "object" && cur !== null ? cur : {};
}

export function createProject(project: {
  id: string;
  user_id?: string;
  name: string;
  description?: string;
  source_type?: string;
  root_path?: string | null;
  status?: string;
  created_at?: number;
  updated_at?: number;
  metadata?: any;
}, skipSync = false): DbProject {
  const now = Date.now();
  const created = project.created_at || now;
  const updated = project.updated_at || now;
  const userId = toValidUuid(project.user_id || "user_default")!;
  let metaStr: string | null = null;
  if (project.metadata) {
    if (typeof project.metadata === "string") {
      try {
        // Validate if already valid JSON string
        JSON.parse(project.metadata);
        metaStr = project.metadata;
      } catch {
        metaStr = JSON.stringify(project.metadata);
      }
    } else {
      metaStr = JSON.stringify(project.metadata);
    }
  }

  const stmt = db.prepare(`
    INSERT INTO projects (id, user_id, name, description, source_type, root_path, status, created_at, updated_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      name = excluded.name,
      description = excluded.description,
      source_type = excluded.source_type,
      root_path = excluded.root_path,
      status = excluded.status,
      updated_at = excluded.updated_at,
      metadata = excluded.metadata
  `);

  ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).sql || (stmt as any).source || "projects insert"); throw e; } })(
    project.id,
    userId,
    project.name,
    project.description || "",
    project.source_type || "upload",
    project.root_path || null,
    project.status || "ready",
    created,
    updated,
    metaStr
  );

  const createdProj = getProject(project.id)!;
  if (isSupabaseConfigured() && !skipSync && createdProj) {
    syncProjectToSupabase(createdProj).catch(() => {});
  }
  return createdProj;
}

export function getProject(id: string): DbProject | null {
  const stmt = db.prepare("SELECT * FROM projects WHERE id = ?");
  const row = stmt.get(id) as any;
  if (!row) return null;
  return row as DbProject;
}

export function listProjects(userId?: string): DbProject[] {
  if (userId) {
    const validUserId = toValidUuid(userId)!;
    const stmt = db.prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC");
    return (stmt.all(validUserId) as any[]) as DbProject[];
  }
  const stmt = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC");
  return (stmt.all() as any[]) as DbProject[];
}

export function countProjectFiles(projectId: string): number {
  try {
    const row = db.prepare("SELECT COUNT(*) as count FROM project_files WHERE project_id = ?").get(projectId) as any;
    return row ? row.count : 0;
  } catch {
    return 0;
  }
}

export function updateProject(
  id: string,
  updates: Partial<Omit<DbProject, "id" | "created_at">> & { metadata?: any }
): DbProject | null {
  const current = getProject(id);
  if (!current) return null;

  const now = Date.now();
  const name = updates.name !== undefined ? updates.name : current.name;
  const description = updates.description !== undefined ? updates.description : current.description;
  const source_type = updates.source_type !== undefined ? updates.source_type : current.source_type;
  const root_path = updates.root_path !== undefined ? updates.root_path : current.root_path;
  const status = updates.status !== undefined ? updates.status : current.status;
  const last_indexed_at = updates.last_indexed_at !== undefined ? updates.last_indexed_at : current.last_indexed_at;
  
  let metadataStr = current.metadata;
  if (updates.metadata !== undefined) {
    if (typeof updates.metadata === "string") {
      try {
        JSON.parse(updates.metadata);
        metadataStr = updates.metadata;
      } catch {
        metadataStr = JSON.stringify(updates.metadata);
      }
    } else {
      metadataStr = JSON.stringify(updates.metadata);
    }
  }

  const stmt = db.prepare(`
    UPDATE projects
    SET name = ?, description = ?, source_type = ?, root_path = ?, status = ?, updated_at = ?, last_indexed_at = ?, metadata = ?
    WHERE id = ?
  `);

  ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).source || (stmt as any).sql || "updateProject"); throw e; } })(name, description, source_type, root_path, status, now, last_indexed_at, metadataStr, id);
  return getProject(id);
}

/**
 * Completely and atomically delete a project and all cascading resources
 */
export function deleteProject(projectId: string, userId?: string): boolean {
  if (!projectId) return false;
  return runTransaction(() => {
    // Explicit deletions in transaction to guarantee 100% cascade across all SQLite environments
    db.prepare("DELETE FROM project_files WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM artifacts WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM knowledge_chunks WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM knowledge_sources WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM architecture_nodes WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM architecture_edges WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM diagnostics WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM test_runs WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM github_connections WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM project_analyses WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id = ?)").run(projectId);
    db.prepare("DELETE FROM conversations WHERE project_id = ?").run(projectId);

    let res: any;
    if (userId) {
      const validUid = toValidUuid(userId)!;
      const defaultUid = toValidUuid("user_default")!;
      res = db.prepare("DELETE FROM projects WHERE id = ? AND (user_id = ? OR user_id = ? OR user_id = 'user_default' OR user_id = ?)").run(projectId, userId, validUid, defaultUid);
    } else {
      res = db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    }

    if (res.changes > 0 && isSupabaseConfigured()) {
      deleteProjectFromSupabase(projectId, userId).catch((err) => {
        console.warn("[deleteProject] Notice deleting project from Supabase:", err);
      });
    }

    return res.changes > 0;
  });
}

// ---------------------------------------------------------------------------
// Project Files Service
// ---------------------------------------------------------------------------
export function createFilesBatch(filesList: Array<{
  id: string;
  project_id: string;
  path: string;
  name: string;
  extension?: string;
  language?: string;
  size?: number;
  hash?: string;
  version?: number;
  content?: string;
  is_binary?: boolean | number;
}>): void {
  if (!filesList || filesList.length === 0) return;
  const now = Date.now();
  runTransaction(() => {
    const stmt = db.prepare(`
      INSERT INTO project_files (id, project_id, path, name, extension, language, size, hash, version, content, is_binary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, path) DO UPDATE SET
        name = excluded.name,
        extension = excluded.extension,
        language = excluded.language,
        size = excluded.size,
        hash = excluded.hash,
        version = project_files.version + 1,
        content = excluded.content,
        is_binary = excluded.is_binary,
        updated_at = excluded.updated_at
    `);
    for (const file of filesList) {
      ensureProjectExists(file.project_id);
      ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).source || (stmt as any).sql || "createFilesBatch"); throw e; } })(
        file.id,
        file.project_id,
        file.path,
        file.name,
        file.extension || path.extname(file.name),
        file.language || "text",
        file.size || 0,
        file.hash || "",
        file.version || 1,
        file.content || "",
        file.is_binary ? 1 : 0,
        now,
        now
      );
    }
  });
}

export function createFile(file: {
  id: string;
  project_id: string;
  path: string;
  name: string;
  extension?: string;
  language?: string;
  size?: number;
  hash?: string;
  version?: number;
  content?: string;
  is_binary?: boolean | number;
}): DbProjectFile {
  ensureProjectExists(file.project_id);
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO project_files (id, project_id, path, name, extension, language, size, hash, version, content, is_binary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, path) DO UPDATE SET
      name = excluded.name,
      extension = excluded.extension,
      language = excluded.language,
      size = excluded.size,
      hash = excluded.hash,
      version = project_files.version + 1,
      content = excluded.content,
      is_binary = excluded.is_binary,
      updated_at = excluded.updated_at
  `);

  ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).source || (stmt as any).sql || "createFile"); throw e; } })(
    file.id,
    file.project_id,
    file.path,
    file.name,
    file.extension || path.extname(file.name),
    file.language || "text",
    file.size || 0,
    file.hash || "",
    file.version || 1,
    file.content || "",
    file.is_binary ? 1 : 0,
    now,
    now
  );

  const createdFile = getProjectFileByPath(file.project_id, file.path)!;
  if (isSupabaseConfigured() && createdFile) {
    syncProjectFileToSupabase(createdFile).catch(() => {});
  }
  return createdFile;
}

export function getFile(id: string): DbProjectFile | null {
  const stmt = db.prepare("SELECT * FROM project_files WHERE id = ?");
  const row = stmt.get(id);
  return (row as DbProjectFile) || null;
}

export function getProjectFileByPath(projectId: string, filePath: string): DbProjectFile | null {
  const stmt = db.prepare("SELECT * FROM project_files WHERE project_id = ? AND path = ?");
  const row = stmt.get(projectId, filePath);
  return (row as DbProjectFile) || null;
}

export function listFiles(projectId: string): DbProjectFile[] {
  const stmt = db.prepare("SELECT * FROM project_files WHERE project_id = ? ORDER BY path ASC");
  return (stmt.all(projectId) as any[]) as DbProjectFile[];
}

export function updateFile(
  id: string,
  updates: Partial<Omit<DbProjectFile, "id" | "project_id" | "created_at">>
): DbProjectFile | null {
  const current = getFile(id);
  if (!current) return null;

  const now = Date.now();
  const filePath = updates.path !== undefined ? updates.path : current.path;
  const name = updates.name !== undefined ? updates.name : current.name;
  const ext = updates.extension !== undefined ? updates.extension : current.extension;
  const lang = updates.language !== undefined ? updates.language : current.language;
  const size = updates.size !== undefined ? updates.size : current.size;
  const hash = updates.hash !== undefined ? updates.hash : current.hash;
  const ver = updates.version !== undefined ? updates.version : current.version + 1;
  const content = updates.content !== undefined ? updates.content : current.content;
  const isBinary = updates.is_binary !== undefined ? updates.is_binary : current.is_binary;

  const stmt = db.prepare(`
    UPDATE project_files
    SET path = ?, name = ?, extension = ?, language = ?, size = ?, hash = ?, version = ?, content = ?, is_binary = ?, updated_at = ?
    WHERE id = ?
  `);

  ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).source || (stmt as any).sql || "updateFile"); throw e; } })(filePath, name, ext, lang, size, hash, ver, content, isBinary, now, id);
  return getFile(id);
}

export function deleteFile(id: string): boolean {
  return runTransaction(() => {
    const file = getFile(id);
    if (file) {
      db.prepare("DELETE FROM knowledge_chunks WHERE project_id = ? AND file_id = ?").run(file.project_id, file.path);
    }
    const res = db.prepare("DELETE FROM project_files WHERE id = ?").run(id);
    return res.changes > 0;
  });
}

export function deleteProjectFileByPath(projectId: string, filePath: string): boolean {
  return runTransaction(() => {
    const file = getProjectFileByPath(projectId, filePath);
    if (!file) return false;
    db.prepare("DELETE FROM knowledge_chunks WHERE project_id = ? AND file_id = ?").run(projectId, filePath);
    const res = db.prepare("DELETE FROM project_files WHERE id = ?").run(file.id);
    return res.changes > 0;
  });
}

export function updateFileByPath(
  projectId: string,
  filePath: string,
  updates: Partial<Omit<DbProjectFile, "id" | "project_id" | "created_at">>
): DbProjectFile | null {
  const file = getProjectFileByPath(projectId, filePath);
  if (!file) return null;
  return updateFile(file.id, updates);
}

export function renameProjectFolderFiles(projectId: string, oldFolder: string, newFolder: string): number {
  return runTransaction(() => {
    const oldPrefix = oldFolder.endsWith("/") ? oldFolder : oldFolder + "/";
    const newPrefix = newFolder.endsWith("/") ? newFolder : newFolder + "/";
    const files = listFiles(projectId);
    let count = 0;
    const now = Date.now();
    for (const f of files) {
      if (f.path.startsWith(oldPrefix)) {
        const newPath = newPrefix + f.path.substring(oldPrefix.length);
        const newName = path.basename(newPath);
        const newExt = path.extname(newName);
        db.prepare(`
          UPDATE project_files
          SET path = ?, name = ?, extension = ?, version = version + 1, updated_at = ?
          WHERE id = ?
        `).run(newPath, newName, newExt, now, f.id);
        db.prepare("UPDATE knowledge_chunks SET file_id = ? WHERE project_id = ? AND file_id = ?")
          .run(newPath, projectId, f.path);
        count++;
      } else if (f.path === oldFolder) {
        const newName = path.basename(newFolder);
        const newExt = path.extname(newName);
        db.prepare(`
          UPDATE project_files
          SET path = ?, name = ?, extension = ?, version = version + 1, updated_at = ?
          WHERE id = ?
        `).run(newFolder, newName, newExt, now, f.id);
        db.prepare("UPDATE knowledge_chunks SET file_id = ? WHERE project_id = ? AND file_id = ?")
          .run(newFolder, projectId, f.path);
        count++;
      }
    }
    return count;
  });
}

export function deleteProjectFolderFiles(projectId: string, folderPath: string): number {
  return runTransaction(() => {
    const prefix = folderPath.endsWith("/") ? folderPath : folderPath + "/";
    const files = listFiles(projectId).filter((f) => f.path.startsWith(prefix) || f.path === folderPath);
    for (const f of files) {
      db.prepare("DELETE FROM knowledge_chunks WHERE project_id = ? AND file_id = ?").run(projectId, f.path);
      db.prepare("DELETE FROM project_files WHERE id = ?").run(f.id);
    }
    return files.length;
  });
}

// ---------------------------------------------------------------------------
// Artifacts Service
// ---------------------------------------------------------------------------
export function createArtifact(artifact: {
  id: string;
  project_id: string;
  file_id?: string | null;
  name: string;
  path?: string | null;
  mime_type?: string | null;
  artifact_type?: string | null;
  version?: number;
  hash?: string | null;
  content?: string | null;
}): DbArtifact {
  ensureProjectExists(artifact.project_id);
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO artifacts (id, project_id, file_id, name, path, mime_type, artifact_type, version, hash, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      path = excluded.path,
      mime_type = excluded.mime_type,
      artifact_type = excluded.artifact_type,
      version = artifacts.version + 1,
      hash = excluded.hash,
      content = excluded.content,
      updated_at = excluded.updated_at
  `);

  ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).source || (stmt as any).sql || "createArtifact"); throw e; } })(
    artifact.id,
    artifact.project_id,
    artifact.file_id || null,
    artifact.name,
    artifact.path || null,
    artifact.mime_type || null,
    artifact.artifact_type || null,
    artifact.version || 1,
    artifact.hash || null,
    artifact.content || null,
    now,
    now
  );

  const createdArt = getArtifact(artifact.id)!;
  if (isSupabaseConfigured() && createdArt) {
    syncArtifactToSupabase(createdArt).catch(() => {});
  }
  return createdArt;
}

export function getArtifact(id: string): DbArtifact | null {
  const stmt = db.prepare("SELECT * FROM artifacts WHERE id = ?");
  const row = stmt.get(id);
  return (row as DbArtifact) || null;
}

export function listArtifacts(projectId: string): DbArtifact[] {
  const stmt = db.prepare("SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at DESC");
  return (stmt.all(projectId) as any[]) as DbArtifact[];
}

export function deleteArtifact(id: string): boolean {
  const res = db.prepare("DELETE FROM artifacts WHERE id = ?").run(id);
  return res.changes > 0;
}

// ---------------------------------------------------------------------------
// Knowledge Chunks Service
// ---------------------------------------------------------------------------
export function createKnowledgeChunksBatch(chunksList: Array<any>): void {
  if (!chunksList || chunksList.length === 0) return;

  const now = Date.now();
  runTransaction(() => {
    const stmt = db.prepare(`
      INSERT INTO knowledge_chunks (id, project_id, file_id, chunk_id, content, chunk_type, symbol, start_line, end_line, hash, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        chunk_type = excluded.chunk_type,
        symbol = excluded.symbol,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        hash = excluded.hash,
        version = knowledge_chunks.version + 1,
        updated_at = excluded.updated_at
    `);

    for (const chunk of chunksList) {
      const pid = chunk.projectId || chunk.project_id;
      ensureProjectExists(pid);
      stmt.run(
        chunk.id,
        pid,
        chunk.fileId || chunk.file_id,
        chunk.chunkId || chunk.chunk_id,
        chunk.content,
        chunk.chunkType || chunk.chunk_type || "text",
        chunk.symbol || "",
        (chunk.startLine !== undefined ? chunk.startLine : chunk.start_line) ?? null,
        (chunk.endLine !== undefined ? chunk.endLine : chunk.end_line) ?? null,
        chunk.hash || "",
        chunk.version || 1,
        now,
        now
      );
    }
  });

  if (isSupabaseConfigured()) {
    for (const chunk of chunksList) {
      syncKnowledgeChunkToSupabase({
        id: chunk.id,
        project_id: chunk.projectId || chunk.project_id,
        file_id: chunk.fileId || chunk.file_id,
        chunk_id: chunk.chunkId || chunk.chunk_id,
        content: chunk.content,
        chunk_type: chunk.chunkType || chunk.chunk_type || "text",
        symbol: chunk.symbol || "",
        start_line: (chunk.startLine !== undefined ? chunk.startLine : chunk.start_line) ?? undefined,
        end_line: (chunk.endLine !== undefined ? chunk.endLine : chunk.end_line) ?? undefined,
        hash: chunk.hash || "",
        version: chunk.version || 1,
        created_at: now,
      }).catch(() => {});
    }
  }
}

export function createKnowledgeChunk(chunk: {
  id: string;
  project_id: string;
  file_id: string;
  chunk_id: string;
  content: string;
  chunk_type?: string;
  symbol?: string;
  start_line?: number;
  end_line?: number;
  hash?: string;
  version?: number;
}): DbKnowledgeChunk {
  ensureProjectExists(chunk.project_id);
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO knowledge_chunks (id, project_id, file_id, chunk_id, content, chunk_type, symbol, start_line, end_line, hash, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      content = excluded.content,
      chunk_type = excluded.chunk_type,
      symbol = excluded.symbol,
      start_line = excluded.start_line,
      end_line = excluded.end_line,
      hash = excluded.hash,
      version = knowledge_chunks.version + 1,
      updated_at = excluded.updated_at
  `);

  ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).source || (stmt as any).sql || "createKnowledgeChunk"); throw e; } })(
    chunk.id,
    chunk.project_id,
    chunk.file_id,
    chunk.chunk_id,
    chunk.content,
    chunk.chunk_type || "text",
    chunk.symbol || "",
    chunk.start_line !== undefined ? chunk.start_line : null,
    chunk.end_line !== undefined ? chunk.end_line : null,
    chunk.hash || "",
    chunk.version || 1,
    now,
    now
  );

  const row = db.prepare("SELECT * FROM knowledge_chunks WHERE id = ?").get(chunk.id);
  return row as DbKnowledgeChunk;
}

export function listKnowledgeChunks(projectId: string, fileId?: string): DbKnowledgeChunk[] {
  if (fileId) {
    const stmt = db.prepare("SELECT * FROM knowledge_chunks WHERE project_id = ? AND file_id = ? ORDER BY start_line ASC");
    return (stmt.all(projectId, fileId) as any[]) as DbKnowledgeChunk[];
  }
  const stmt = db.prepare("SELECT * FROM knowledge_chunks WHERE project_id = ? ORDER BY file_id ASC, start_line ASC");
  return (stmt.all(projectId) as any[]) as DbKnowledgeChunk[];
}

export function deleteKnowledgeForProject(projectId: string): number {
  const res = db.prepare("DELETE FROM knowledge_chunks WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM knowledge_sources WHERE project_id = ?").run(projectId);
  if (isSupabaseConfigured()) {
    deleteKnowledgeChunksFromSupabase(projectId).catch(() => {});
  }
  return res.changes;
}

export function deleteKnowledgeChunksForFile(projectId: string, fileId: string): number {
  const res = db.prepare("DELETE FROM knowledge_chunks WHERE project_id = ? AND file_id = ?").run(projectId, fileId);
  if (isSupabaseConfigured()) {
    deleteKnowledgeChunksFromSupabase(projectId, fileId).catch(() => {});
  }
  return res.changes;
}

export function upsertKnowledgeSource(source: Partial<DbKnowledgeSource> & { id: string; project_id: string; path: string; name: string }): DbKnowledgeSource {
  ensureProjectExists(source.project_id);
  const now = Date.now();
  db.prepare(`
    INSERT INTO knowledge_sources (id, project_id, path, name, extension, file_type, size, chunks_count, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      path = excluded.path,
      name = excluded.name,
      extension = excluded.extension,
      file_type = excluded.file_type,
      size = excluded.size,
      chunks_count = excluded.chunks_count,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(
    source.id,
    source.project_id,
    source.path,
    source.name,
    source.extension || "",
    source.file_type || "Document",
    source.size || 0,
    source.chunks_count || 0,
    source.status || "Indexed",
    now,
    now
  );

  return db.prepare("SELECT * FROM knowledge_sources WHERE id = ?").get(source.id) as DbKnowledgeSource;
}

export function listKnowledgeSources(projectId: string): DbKnowledgeSource[] {
  const stmt = db.prepare("SELECT * FROM knowledge_sources WHERE project_id = ? ORDER BY updated_at DESC");
  return (stmt.all(projectId) as any[]) as DbKnowledgeSource[];
}

export function getKnowledgeSource(projectId: string, idOrPath: string): DbKnowledgeSource | null {
  const row = db.prepare("SELECT * FROM knowledge_sources WHERE project_id = ? AND (id = ? OR path = ?)").get(projectId, idOrPath, idOrPath);
  return (row as DbKnowledgeSource) || null;
}

export function deleteKnowledgeSource(projectId: string, idOrPath: string): boolean {
  const source = getKnowledgeSource(projectId, idOrPath);
  const targetPath = source ? source.path : idOrPath;
  const targetId = source ? source.id : idOrPath;

  runTransaction(() => {
    db.prepare("DELETE FROM knowledge_chunks WHERE project_id = ? AND (file_id = ? OR file_id = ?)").run(projectId, targetPath, targetId);
    db.prepare("DELETE FROM knowledge_sources WHERE project_id = ? AND (id = ? OR path = ?)").run(projectId, targetId, targetPath);
  });
  return true;
}

// ---------------------------------------------------------------------------
// Architecture & Diagnostics Services
// ---------------------------------------------------------------------------
export function saveArchitecture(
  projectId: string,
  nodes: Array<{ id: string; node_type?: string; name: string; file_id?: string | null; metadata?: any }>,
  edges: Array<{ id: string; source_node_id: string; target_node_id: string; relationship?: string; confidence?: number; evidence?: string | null }>
) {
  ensureProjectExists(projectId);
  runTransaction(() => {
    db.prepare("DELETE FROM architecture_nodes WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM architecture_edges WHERE project_id = ?").run(projectId);

    const insertNode = db.prepare(`
      INSERT INTO architecture_nodes (id, project_id, node_type, name, file_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const seenNodes = new Set();
    for (const n of nodes) {
      if (!n.id) continue;
      const internalId = projectId + "_" + n.id;
      if (seenNodes.has(internalId)) continue;
      seenNodes.add(internalId);

      const nodeType = n.node_type || (n as any).type || "component";
      const nodeName = n.name || (n as any).label || n.id;
      const fileId = n.file_id || ((n as any).files && (n as any).files[0]) || null;
      const meta = n.metadata ? n.metadata : {
        subType: (n as any).subType,
        description: (n as any).description,
        files: (n as any).files,
        level: (n as any).level,
        evidence: (n as any).evidence,
        metrics: (n as any).metrics,
      };
      insertNode.run(
        internalId,
        projectId,
        nodeType,
        nodeName,
        fileId,
        meta ? JSON.stringify(meta) : null
      );
    }

    const insertEdge = db.prepare(`
      INSERT INTO architecture_edges (id, project_id, source_node_id, target_node_id, relationship, confidence, evidence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const seenEdges = new Set();
    let edgeCounter = 0;
    for (const e of edges) {
      edgeCounter++;
      const src = e.source_node_id || (e as any).source || (e as any).from;
      const tgt = e.target_node_id || (e as any).target || (e as any).to;
      let edgeId = e.id || `${src}_${tgt}_${edgeCounter}`;
      const internalEdgeId = projectId + "_" + edgeId;
      if (seenEdges.has(internalEdgeId)) continue;
      seenEdges.add(internalEdgeId);

      const evidenceStr = e.evidence ? (typeof e.evidence === 'string' ? e.evidence : JSON.stringify(e.evidence)) : null;
      insertEdge.run(
        internalEdgeId,
        projectId,
        projectId + "_" + src,
        projectId + "_" + tgt,
        e.relationship || (e as any).label || "depends_on",
        e.confidence !== undefined ? e.confidence : 1.0,
        evidenceStr
      );
    }
  });
}


export function getArchitecture(projectId: string) {
  const nodes = db.prepare("SELECT * FROM architecture_nodes WHERE project_id = ?").all(projectId) as any[];
  const edges = db.prepare("SELECT * FROM architecture_edges WHERE project_id = ?").all(projectId) as any[];
  
  const prefix = projectId + "_";
  return {
    nodes: nodes.map(n => {
      let outId = n.id;
      if (outId.startsWith(prefix)) outId = outId.substring(prefix.length);
      return { ...n, id: outId, metadata: n.metadata ? JSON.parse(n.metadata) : null };
    }),
    edges: edges.map(e => {
      let outId = e.id;
      let srcId = e.source_node_id;
      let tgtId = e.target_node_id;
      if (outId.startsWith(prefix)) outId = outId.substring(prefix.length);
      if (srcId.startsWith(prefix)) srcId = srcId.substring(prefix.length);
      if (tgtId.startsWith(prefix)) tgtId = tgtId.substring(prefix.length);
      return { ...e, id: outId, source_node_id: srcId, target_node_id: tgtId, source: srcId, target: tgtId };
    })
  };
}

export function deleteArchitectureForProject(projectId: string): void {
  runTransaction(() => {
    db.prepare("DELETE FROM architecture_nodes WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM architecture_edges WHERE project_id = ?").run(projectId);
  });
}

export function saveDiagnostics(projectId: string, diags: Array<Omit<DbDiagnostic, "id" | "project_id" | "created_at"> & { id?: string }>) {
  ensureProjectExists(projectId);
  runTransaction(() => {
    db.prepare("DELETE FROM diagnostics WHERE project_id = ?").run(projectId);
    const stmt = db.prepare(`
      INSERT INTO diagnostics (id, project_id, file_id, severity, category, message, line, column, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    for (const d of diags) {
      const id = d.id || `diag_${projectId}_${Math.random().toString(36).substr(2, 9)}`;
      ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).source || (stmt as any).sql || "saveDiagnostics"); throw e; } })(
        id,
        projectId,
        d.file_id || null,
        d.severity || "info",
        d.category || "general",
        d.message,
        d.line !== undefined ? d.line : null,
        d.column !== undefined ? d.column : null,
        d.status || "open",
        now
      );
    }
  });
}

export function getDiagnostics(projectId: string): DbDiagnostic[] {
  const stmt = db.prepare("SELECT * FROM diagnostics WHERE project_id = ? ORDER BY severity DESC, line ASC");
  return (stmt.all(projectId) as any[]) as DbDiagnostic[];
}

export function deleteDiagnosticsForProject(projectId: string): number {
  const res = db.prepare("DELETE FROM diagnostics WHERE project_id = ?").run(projectId);
  return res.changes;
}

// ---------------------------------------------------------------------------
// Project Analysis Cache Service
// ---------------------------------------------------------------------------
export function saveProjectAnalysis(projectId: string, analysis: any) {
  ensureProjectExists(projectId);
  const now = Date.now();
  const summary = analysis?.summary || "";
  const pType = analysis?.projectType || "";
  const pLang = analysis?.primaryLanguage || "";
  const jsonStr = JSON.stringify(analysis);

  const stmt = db.prepare(`
    INSERT INTO project_analyses (project_id, summary, project_type, primary_language, analysis_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      summary = excluded.summary,
      project_type = excluded.project_type,
      primary_language = excluded.primary_language,
      analysis_json = excluded.analysis_json,
      updated_at = excluded.updated_at
  `);

  ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).source || (stmt as any).sql || "saveProjectAnalysis"); throw e; } })(projectId, summary, pType, pLang, jsonStr, now);
}

export function getProjectAnalysis(projectId: string): any | null {
  const stmt = db.prepare("SELECT analysis_json FROM project_analyses WHERE project_id = ?");
  const row = stmt.get(projectId) as any;
  if (!row || !row.analysis_json) return null;
  try {
    return JSON.parse(row.analysis_json);
  } catch {
    return null;
  }
}

export function deleteProjectAnalysis(projectId: string): boolean {
  const res = db.prepare("DELETE FROM project_analyses WHERE project_id = ?").run(projectId);
  return res.changes > 0;
}

// ---------------------------------------------------------------------------
// Conversations & Messages Service
// ---------------------------------------------------------------------------
export function saveConversation(
  convOrId: string | { id: string; user_id: string; project_id?: string | null; title: string; model_id?: string | null; created_at?: number; updated_at?: number },
  user_id?: string,
  title?: string,
  model_id?: string | null,
  skipSync = false
) {
  const rawConv = typeof convOrId === "object" ? convOrId : {
    id: convOrId,
    user_id: user_id || "default",
    title: title || "New Chat",
    model_id: model_id || null,
    project_id: undefined,
    created_at: undefined,
    updated_at: undefined,
  };
  const validUserId = ensureUserExists(rawConv.user_id || "user_default");
  if (rawConv.project_id) {
    ensureProjectExists(rawConv.project_id, validUserId);
  }
  const conv = {
    ...rawConv,
    user_id: validUserId
  };
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO conversations (id, user_id, project_id, title, model_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      title = excluded.title,
      model_id = excluded.model_id,
      updated_at = excluded.updated_at
  `);

  ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).source || (stmt as any).sql || "saveConversation"); throw e; } })(
    conv.id,
    conv.user_id,
    conv.project_id || null,
    conv.title,
    conv.model_id || null,
    conv.created_at || now,
    conv.updated_at || now
  );

  if (isSupabaseConfigured() && !skipSync) {
    syncConversationToSupabase({
      id: conv.id,
      user_id: conv.user_id,
      title: conv.title,
      model_id: conv.model_id || "",
      project_id: conv.project_id || undefined,
      created_at: conv.created_at || now,
      updated_at: conv.updated_at || now,
    }).catch(() => {});
  }
}

export function getConversation(id: string) {
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as any;
}

export function listConversations(userId?: string) {
  if (userId) {
    const validUserId = toValidUuid(userId)!;
    return db.prepare("SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC").all(validUserId) as any[];
  }
  return db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC").all() as any[];
}

export function deleteConversation(id: string, userId?: string) {
  return runTransaction(() => {
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
    let res: any;
    if (userId) {
      const validUid = toValidUuid(userId)!;
      res = db.prepare("DELETE FROM conversations WHERE id = ? AND (user_id = ? OR user_id = ?)").run(id, userId, validUid);
    } else {
      res = db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    }
    if (isSupabaseConfigured()) {
      deleteConversationFromSupabase(id, userId).catch(() => {});
    }
    return res.changes > 0;
  });
}

export function saveMessage(
  msgOrId: string | { id: string; conversation_id: string; role: string; content: string; model_id?: string | null; attachments?: any; created_at?: number },
  conversation_id?: string,
  role?: string,
  content?: string,
  model_id?: string | null,
  attachmentsOrSkipSync?: any,
  skipSyncParam = false
) {
  const msg = typeof msgOrId === "object" ? msgOrId : {
    id: msgOrId,
    conversation_id: conversation_id!,
    role: role!,
    content: content || "",
    model_id: model_id || null,
    attachments: typeof attachmentsOrSkipSync === "boolean" ? null : attachmentsOrSkipSync,
  };
  ensureConversationExists(msg.conversation_id);
  const skipSync = typeof attachmentsOrSkipSync === "boolean" ? attachmentsOrSkipSync : skipSyncParam;
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, model_id, attachments, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      content = excluded.content,
      model_id = excluded.model_id,
      attachments = excluded.attachments
  `);

  ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).source || (stmt as any).sql || "saveMessage"); throw e; } })(
    msg.id,
    msg.conversation_id,
    msg.role,
    msg.content,
    msg.model_id || null,
    msg.attachments ? (typeof msg.attachments === "string" ? msg.attachments : JSON.stringify(msg.attachments)) : null,
    msg.created_at || now
  );

  if (isSupabaseConfigured() && !skipSync) {
    let resolvedUserId: string | undefined = undefined;
    try {
      const conv = getConversation(msg.conversation_id);
      if (conv) {
        resolvedUserId = conv.user_id;
      }
    } catch (err) {
      console.warn("[saveMessage] Could not look up user_id for sync:", err);
    }
    syncMessageToSupabase({
      id: msg.id,
      conversation_id: msg.conversation_id,
      user_id: resolvedUserId,
      role: msg.role,
      content: msg.content,
      model_id: msg.model_id || undefined,
      created_at: msg.created_at || now,
    }).catch(() => {});
  }

  if (!skipSync && aivenConfigured()) {
    let ownerId: string | undefined;
    try {
      ownerId = getConversation(msg.conversation_id)?.user_id;
    } catch {
      /* mirror is best-effort */
    }
    mirrorMessage({
      id: msg.id,
      conversation_id: msg.conversation_id,
      user_id: ownerId,
      role: msg.role,
      content: msg.content,
      created_at: msg.created_at || now,
    });
  }
}

export function deleteMessage(id: string) {
  return db.prepare("DELETE FROM messages WHERE id = ?").run(id).changes > 0;
}

export function listMessages(conversationId: string) {
  const rows = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(conversationId) as any[];
  return rows.map(r => {
    let parsed: any = null;
    try { if (r.attachments) parsed = JSON.parse(r.attachments); } catch(e) {}
    
    const isObj = parsed && typeof parsed === "object" && !Array.isArray(parsed);
    const attachments = isObj ? (parsed.attachments || []) : (Array.isArray(parsed) ? parsed : []);
    const artifacts = isObj ? parsed.artifacts : (r.artifacts ? JSON.parse(r.artifacts) : undefined);
    const suggested_actions = isObj ? parsed.suggested_actions : undefined;

    return {
      ...r,
      attachments,
      artifacts,
      suggested_actions,
    };
  });
}

export function getConversationMessageCounts(): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const rows = db.prepare("SELECT conversation_id, COUNT(*) as count FROM messages WHERE role IN ('user', 'assistant') GROUP BY conversation_id").all() as any[];
    for (const r of rows) {
      if (r.conversation_id) map.set(r.conversation_id, r.count);
    }
  } catch (e) {}
  return map;
}

// ---------------------------------------------------------------------------
// Workspace Files Service
// ---------------------------------------------------------------------------
export function saveWorkspaceFile(f: {
  id: string;
  user_id: string;
  filename: string;
  mime?: string;
  size?: number;
  file_type?: string;
  content?: string;
  uploaded_at?: number;
}) {
  const validUserId = ensureUserExists(f.user_id);
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO workspace_files (id, user_id, filename, mime, size, file_type, content, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      filename = excluded.filename,
      mime = excluded.mime,
      size = excluded.size,
      file_type = excluded.file_type,
      content = excluded.content
  `);

  ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).source || (stmt as any).sql || "saveWorkspaceFile"); throw e; } })(
    f.id,
    validUserId,
    f.filename,
    f.mime || "text/plain",
    f.size || 0,
    f.file_type || "document",
    f.content || "",
    f.uploaded_at || now
  );

  if (isSupabaseConfigured()) {
    syncWorkspaceFileToSupabase({
      id: f.id,
      user_id: validUserId,
      filename: f.filename,
      mime: f.mime || "text/plain",
      size: f.size || 0,
      file_type: f.file_type || "document",
      content: f.content || "",
      uploaded_at: f.uploaded_at || now,
    }).catch(() => {});
  }
}

export function getWorkspaceFile(id: string) {
  return db.prepare("SELECT * FROM workspace_files WHERE id = ?").get(id) as any;
}

export function listWorkspaceFiles(userId?: string) {
  if (userId) {
    const validUserId = toValidUuid(userId)!;
    return db.prepare("SELECT * FROM workspace_files WHERE user_id = ? ORDER BY uploaded_at DESC").all(validUserId) as any[];
  }
  return db.prepare("SELECT * FROM workspace_files ORDER BY uploaded_at DESC").all() as any[];
}

export function deleteWorkspaceFile(id: string) {
  const changes = db.prepare("DELETE FROM workspace_files WHERE id = ?").run(id).changes;
  if (changes > 0 && isSupabaseConfigured()) {
    deleteWorkspaceFileFromSupabase(id).catch(() => {});
  }
  return changes > 0;
}

// ---------------------------------------------------------------------------
// GitHub Connections Service
// ---------------------------------------------------------------------------
export function saveGithubConnection(projectId: string, conn: {
  repository: string;
  branch: string;
  sync_status?: string;
  last_synced_at?: number;
  metadata?: any;
}) {
  ensureProjectExists(projectId);
  const id = `gh_${projectId}`;
  const stmt = db.prepare(`
    INSERT INTO github_connections (id, project_id, repository, branch, sync_status, last_synced_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      repository = excluded.repository,
      branch = excluded.branch,
      sync_status = excluded.sync_status,
      last_synced_at = excluded.last_synced_at,
      metadata = excluded.metadata
  `);

  ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).source || (stmt as any).sql || "saveGithubConnection"); throw e; } })(
    id,
    projectId,
    conn.repository,
    conn.branch,
    conn.sync_status || "synced",
    conn.last_synced_at || Date.now(),
    conn.metadata ? JSON.stringify(conn.metadata) : null
  );
}

export function getGithubConnection(projectId: string) {
  const row = db.prepare("SELECT * FROM github_connections WHERE project_id = ?").get(projectId) as any;
  if (!row) return null;
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null
  };
}

// Initialize schema on load
initDatabaseSchema();

export function dbRecordDeletedModel(id: string, userId: string) {
  const validUserId = toValidUuid(userId) || userId || "user_default";
  const rawId = String(id || "").trim();
  const cleanId = rawId.includes(":::") ? rawId.split(":::").pop()! : rawId;
  const now = Date.now();
  try {
    db.prepare("INSERT OR REPLACE INTO deleted_models (id, user_id, deleted_at) VALUES (?, ?, ?)").run(cleanId, validUserId, now);
    if (userId && userId !== validUserId) {
      db.prepare("INSERT OR REPLACE INTO deleted_models (id, user_id, deleted_at) VALUES (?, ?, ?)").run(cleanId, userId, now);
    }
  } catch (err) {
    console.warn("[dbRecordDeletedModel] Notice recording deleted model:", err);
  }
}

export function dbIsModelDeleted(id: string, userId?: string | null): boolean {
  if (!id) return false;
  const rawId = String(id || "").trim();
  const cleanId = rawId.includes(":::") ? rawId.split(":::").pop()! : rawId;
  const targetUser = userId || "user_default";
  const validUserId = toValidUuid(targetUser) || targetUser;
  try {
    const row = db.prepare(
      "SELECT 1 FROM deleted_models WHERE (id = ? OR id = ?) AND (user_id = ? OR user_id = ? OR user_id = 'user_default')"
    ).get(cleanId, rawId, validUserId, targetUser);
    return Boolean(row);
  } catch {
    return false;
  }
}

export function dbClearDeletedModel(id: string, userId?: string | null) {
  if (!id) return;
  const rawId = String(id || "").trim();
  const cleanId = rawId.includes(":::") ? rawId.split(":::").pop()! : rawId;
  const targetUser = userId || "user_default";
  const validUserId = toValidUuid(targetUser) || targetUser;
  try {
    db.prepare("DELETE FROM deleted_models WHERE (id = ? OR id = ?) AND (user_id = ? OR user_id = ?)").run(cleanId, rawId, validUserId, targetUser);
  } catch {}
}

export function dbGetModels(userId?: string): any[] {
  let rows: any[] = [];
  if (userId) {
    const validUserId = toValidUuid(userId)!;
    rows = db.prepare("SELECT * FROM models WHERE (user_id = ? OR user_id = ? OR user_id = 'user_default' OR user_id = 'global' OR user_id IS NULL)").all(validUserId, userId);
  } else {
    rows = db.prepare("SELECT * FROM models").all();
  }
  return rows
    .map((r) => ({
      ...r,
      id: r.id && r.id.includes(":::") ? r.id.split(":::").pop()! : r.id,
    }))
    .filter((r) => !dbIsModelDeleted(r.id, userId || r.user_id));
}

export function dbGetModel(id: string, userId?: string): any {
  const cleanId = id.includes(":::") ? id.split(":::").pop()! : id;
  if (dbIsModelDeleted(cleanId, userId)) return null;

  let row: any = null;
  if (userId) {
    const validUserId = toValidUuid(userId)!;
    row = db.prepare("SELECT * FROM models WHERE (id = ? OR id = ?) AND (user_id = ? OR user_id = ?)").get(cleanId, `${validUserId}:::${cleanId}`, validUserId, userId);
  } else {
    row = db.prepare("SELECT * FROM models WHERE id = ?").get(cleanId);
  }
  if (!row) return null;
  const item = {
    ...row,
    id: row.id && row.id.includes(":::") ? row.id.split(":::").pop()! : row.id,
  };
  if (dbIsModelDeleted(item.id, userId || item.user_id)) return null;
  return item;
}

export function dbSaveModel(model: any) {
  const rawId = String(model.id || "").trim();
  const cleanId = rawId.includes(":::") ? rawId.split(":::").pop()! : rawId;
  const validUserId = ensureUserExists(model.user_id || "user_default");

  // Re-adding or editing a model clears any previous deletion tombstone
  dbClearDeletedModel(cleanId, validUserId);
  if (model.user_id && model.user_id !== validUserId) {
    dbClearDeletedModel(cleanId, model.user_id);
  }

  const stmt = db.prepare(`
    INSERT INTO models (id, user_id, name, provider, base_url, api_key, model_name, model_type, capabilities, context_window, max_output_tokens, default_temperature, default_top_p, supports_streaming, enabled, status, is_user)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, id) DO UPDATE SET
      name = excluded.name,
      provider = excluded.provider,
      base_url = excluded.base_url,
      api_key = excluded.api_key,
      model_name = excluded.model_name,
      model_type = excluded.model_type,
      capabilities = excluded.capabilities,
      context_window = excluded.context_window,
      max_output_tokens = excluded.max_output_tokens,
      default_temperature = excluded.default_temperature,
      default_top_p = excluded.default_top_p,
      supports_streaming = excluded.supports_streaming,
      enabled = excluded.enabled,
      status = excluded.status,
      is_user = excluded.is_user
  `);
  
  ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).source || (stmt as any).sql || "dbSaveModel"); throw e; } })(
    cleanId, validUserId, model.name || cleanId, model.provider || "custom", model.baseUrl || model.base_url || null, model.apiKey || model.api_key || model.api_secret || null,
    model.modelName || model.model_name || model.provider_model_id || cleanId, model.modelType || model.model_type || "text",
    typeof model.capabilities === 'string' ? model.capabilities : JSON.stringify(model.capabilities || {}),
    model.contextWindow || model.context_window || 0, model.maxOutputTokens || model.max_output_tokens || 0,
    model.defaultTemperature ?? model.default_temperature ?? 0.7, model.defaultTopP ?? model.default_top_p ?? 1.0,
    model.supportsStreaming !== false && model.supports_streaming !== 0 ? 1 : 0, model.enabled !== false && model.enabled !== 0 ? 1 : 0,
    model.status || "available", model.isUser || model.is_user ? 1 : 0
  );
}

export function dbDeleteModel(id: string, userId?: string) {
  const rawId = String(id || "").trim();
  const cleanId = rawId.includes(":::") ? rawId.split(":::").pop()! : rawId;

  // 1. Record tombstone
  dbRecordDeletedModel(cleanId, userId || "user_default");

  // 2. Delete from SQLite
  if (userId) {
    const validUserId = toValidUuid(userId)!;
    db.prepare("DELETE FROM models WHERE (id = ? OR id = ? OR id = ?) AND (user_id = ? OR user_id = ?)").run(cleanId, rawId, `${validUserId}:::${cleanId}`, validUserId, userId);
  } else {
    db.prepare("DELETE FROM models WHERE id = ? OR id = ?").run(cleanId, rawId);
  }

  // 3. Delete from Supabase
  if (isSupabaseConfigured()) {
    deleteModelFromSupabase(cleanId, userId).catch((err) => {
      console.warn("[dbDeleteModel] Notice deleting model from Supabase:", err);
    });
  }
}

// ---------------------------------------------------------------------------
// Users and Sessions Service
// ---------------------------------------------------------------------------
export interface DbUser {
  id: string;
  email: string;
  name: string;
  password?: string;
  active_model_id?: string | null;
  created_at: number;
}

export function dbSaveUser(user: {
  id: string;
  email: string;
  name: string;
  password?: string;
  active_model_id?: string | null;
  created_at?: number;
}) {
  const validId = toValidUuid(user.id)!;
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO users (id, email, name, password, active_model_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      password = COALESCE(excluded.password, users.password),
      active_model_id = excluded.active_model_id
  `);
  ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).source || (stmt as any).sql || "dbSaveUser"); throw e; } })(
    validId,
    user.email.toLowerCase().trim(),
    user.name.trim(),
    user.password || null,
    user.active_model_id || null,
    user.created_at || now
  );

  if (isSupabaseConfigured()) {
    syncUserToSupabase({
      id: validId,
      email: user.email.toLowerCase().trim(),
      name: user.name.trim(),
      password: user.password || "",
      active_model_id: user.active_model_id || "",
      created_at: user.created_at || now,
    }).catch(() => {});
  }
}

export function dbGetUser(id: string): DbUser | null {
  const validId = toValidUuid(id)!;
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(validId) as any;
  return row || null;
}

export function dbGetUserByEmail(email: string): DbUser | null {
  const row = db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(email.toLowerCase().trim()) as any;
  return row || null;
}

export function dbListUsers(): DbUser[] {
  return (db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as any[]) as DbUser[];
}

export function dbSaveSession(token: string, userId: string, expiresAt: number) {
  const validUserId = ensureUserExists(userId);
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO sessions (token, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET
      user_id = excluded.user_id,
      expires_at = excluded.expires_at
  `);
  ((...args) => { try { return stmt.run(...args); } catch(e) { console.error("SQL ERROR in:", (stmt as any).source || (stmt as any).sql || "dbSaveSession"); throw e; } })(token, validUserId, now, expiresAt);

  if (isSupabaseConfigured()) {
    syncSessionToSupabase({
      token,
      user_id: validUserId,
      created_at: now,
      expires_at: expiresAt,
    }).catch(() => {});
  }
}

export function dbGetSession(token: string): { token: string; user_id: string; created_at: number; expires_at: number } | null {
  const row = db.prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > ?").get(token, Date.now()) as any;
  return row || null;
}

export function dbListActiveSessions(): { token: string; user_id: string; created_at: number; expires_at: number }[] {
  return ((db.prepare("SELECT * FROM sessions WHERE expires_at > ?").all(Date.now()) as any[]) || []);
}

export function dbDeleteSession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  if (isSupabaseConfigured()) {
    deleteSessionFromSupabase(token).catch(() => {});
  }
}

export function dbDeleteExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}

// ---------------------------------------------------------------------------
// Visual Assets Service
// ---------------------------------------------------------------------------

export interface DbVisualAsset {
  id: string;
  project_id: string;
  prompt: string | null;
  asset_type: string;
  mime_type: string;
  filename: string;
  content_base64: string;
  source: string;
  model: string | null;
  dimensions: string | null;
  created_at: number;
  updated_at: number;
}

export function saveVisualAsset(asset: any): DbVisualAsset {
  const now = Date.now();
  const rawPid = String(asset.project_id || asset.projectId || "global");
  const pid = ensureProjectExists(rawPid);
  const prompt = asset.prompt || asset.promptUsed || null;
  const assetType = String(asset.asset_type || asset.assetType || "architecture_diagram");
  const mimeType = String(asset.mime_type || asset.mimeType || "image/png");
  const filename = String(asset.filename || `${asset.id || "asset"}.${mimeType === "image/svg+xml" ? "svg" : "png"}`);
  const contentBase64 = String(asset.content_base64 || asset.contentBase64 || "");
  const source = String(asset.source || "gemini");
  const model = asset.model || asset.modelUsed || null;
  const dimensions = asset.dimensions || (asset.width && asset.height ? `${asset.width}x${asset.height}` : null);

  let parsedCreatedAt = now;
  if (typeof asset.created_at === "number" && !isNaN(asset.created_at)) {
    parsedCreatedAt = asset.created_at;
  } else if (typeof asset.created_at === "string") {
    const t = Date.parse(asset.created_at);
    parsedCreatedAt = isNaN(t) ? now : t;
  }

  let parsedUpdatedAt = now;
  if (typeof asset.updated_at === "number" && !isNaN(asset.updated_at)) {
    parsedUpdatedAt = asset.updated_at;
  } else if (typeof asset.updated_at === "string") {
    const t = Date.parse(asset.updated_at);
    parsedUpdatedAt = isNaN(t) ? now : t;
  }

  const fullAsset: DbVisualAsset = {
    id: String(asset.id || `vasset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`),
    project_id: pid,
    prompt: prompt,
    asset_type: assetType,
    mime_type: mimeType,
    filename: filename,
    content_base64: contentBase64,
    source: source,
    model: model,
    dimensions: dimensions,
    created_at: parsedCreatedAt,
    updated_at: parsedUpdatedAt,
  };

  try {
    const stmt = db.prepare(`
      INSERT INTO visual_assets (id, project_id, prompt, asset_type, mime_type, filename, content_base64, source, model, dimensions, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        prompt = excluded.prompt,
        asset_type = excluded.asset_type,
        mime_type = excluded.mime_type,
        filename = excluded.filename,
        content_base64 = excluded.content_base64,
        source = excluded.source,
        model = excluded.model,
        dimensions = excluded.dimensions,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      fullAsset.id,
      fullAsset.project_id,
      fullAsset.prompt,
      fullAsset.asset_type,
      fullAsset.mime_type,
      fullAsset.filename,
      fullAsset.content_base64,
      fullAsset.source,
      fullAsset.model,
      fullAsset.dimensions,
      fullAsset.created_at,
      fullAsset.updated_at
    );
  } catch (err) {
    console.error("[saveVisualAsset] Failed to persist visual asset:", err);
  }

  return fullAsset;
}

export function listVisualAssets(projectId: string): DbVisualAsset[] {
  return (db.prepare("SELECT * FROM visual_assets WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as any[]) as DbVisualAsset[];
}

export function getVisualAsset(id: string): DbVisualAsset | null {
  const row = db.prepare("SELECT * FROM visual_assets WHERE id = ?").get(id) as any;
  return row || null;
}

export function deleteVisualAsset(id: string): boolean {
  const result = db.prepare("DELETE FROM visual_assets WHERE id = ?").run(id);
  return result.changes > 0;
}

export function deleteVisualAssetsForProject(projectId: string): void {
  db.prepare("DELETE FROM visual_assets WHERE project_id = ?").run(projectId);
}


