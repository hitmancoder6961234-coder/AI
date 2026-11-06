/**
 * Export / erase a single user's data from the SQLite store.
 * In-memory caches inside server.ts are cleared by the caller (see eraseUserData's return value).
 */
import {
  db,
  dbDeleteModel,
  dbGetModels,
  dbGetUser,
  deleteConversation,
  deleteProject,
  deleteWorkspaceFile,
  listConversations,
  listMessages,
  listProjects,
  listWorkspaceFiles,
  toValidUuid,
} from "../db.js";

function maskModel(m: any) {
  const { apiKey, api_key, ...rest } = m || {};
  return { ...rest, hasApiKey: Boolean(apiKey || api_key) };
}

/** Rows from the feature tables (Copilot, original app). They may not exist yet, so a missing table is just "none". */
function tableRows(sql: string, userId: string): any[] {
  try {
    return db.prepare(sql).all(userId) as any[];
  } catch {
    return [];
  }
}

export function exportUserData(userId: string) {
  const user: any = dbGetUser(userId);
  const conversations = (listConversations(userId) as any[]).map((c) => ({
    ...c,
    messages: (listMessages(c.id) as any[]).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
    })),
  }));
  return {
    account: user ? { id: user.id, email: user.email, name: user.name, created_at: user.created_at } : null,
    conversations,
    projects: (listProjects(userId) as any[]).map((p) => ({ id: p.id, name: p.name, created_at: p.created_at })),
    workspaceFiles: (listWorkspaceFiles(userId) as any[]).map((f) => ({ id: f.id, filename: f.filename })),
    models: (dbGetModels(userId) as any[]).map(maskModel),
    copilot: tableRows("SELECT id, title, created_at, updated_at FROM copilot_conversations WHERE user_id = ? ORDER BY updated_at DESC", userId).map((c) => ({
      ...c,
      messages: db.prepare("SELECT role, content, created_at FROM copilot_messages WHERE conversation_id = ? AND user_id = ? ORDER BY seq").all(c.id, userId),
    })),
    memories: tableRows("SELECT content, category, always_use, enabled, source, created_at, updated_at, last_used_at, use_count FROM memories WHERE user_id = ? ORDER BY updated_at DESC", toValidUuid(userId) || userId),
    prompts: tableRows("SELECT id, title, category, description, tags, body, favorite, version, created_at, updated_at FROM prompts WHERE user_id = ? ORDER BY updated_at DESC", toValidUuid(userId) || userId),
    agentRuns: tableRows("SELECT id, status, goal, steps, model, created_at, updated_at, finished_at FROM agent_sessions WHERE user_id = ? ORDER BY updated_at DESC", toValidUuid(userId) || userId),
    memorySettings: tableRows("SELECT enabled, updated_at FROM memory_settings WHERE user_id = ?", toValidUuid(userId) || userId),
    originalApp: {
      conversations: tableRows("SELECT id, title, messages, created_at, updated_at FROM classic_conversations WHERE user_id = ?", userId),
      analyticsEvents: tableRows("SELECT event, data, created_at FROM classic_analytics WHERE user_id = ?", userId),
      webhooks: tableRows("SELECT id, url, events, created_at FROM classic_webhooks WHERE user_id = ?", userId),
    },
  };
}

/** Permanently removes the user's rows. Returns counts of what was deleted. */
export function eraseUserData(userId: string): Record<string, number> {
  const removed: Record<string, number> = { conversations: 0, projects: 0, workspaceFiles: 0, models: 0, sessions: 0, account: 0 };

  for (const c of listConversations(userId) as any[]) if (deleteConversation(c.id, userId)) removed.conversations++;
  for (const p of listProjects(userId) as any[]) if (deleteProject(p.id, userId)) removed.projects++;
  for (const f of listWorkspaceFiles(userId) as any[]) if (deleteWorkspaceFile(f.id)) removed.workspaceFiles++;
  for (const m of dbGetModels(userId) as any[]) {
    dbDeleteModel(m.id, userId);
    removed.models++;
  }
  for (const t of ["memories", "memory_settings", "agent_runs", "agent_sessions", "agent_events", "prompts", "prompt_versions"]) {
    try { removed[t] = Number((db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(toValidUuid(userId) || userId) as any).changes || 0); } catch { removed[t] = 0; }
  }
  removed.sessions = Number((db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId) as any).changes || 0);
  try { removed.password_resets = Number((db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(userId) as any).changes || 0); } catch { removed.password_resets = 0; /* the table exists only once recovery has been set up */ }
  removed.account = Number((db.prepare("DELETE FROM users WHERE id = ?").run(userId) as any).changes || 0);
  return removed;
}
