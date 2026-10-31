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
} from "../db.js";

function maskModel(m: any) {
  const { apiKey, api_key, ...rest } = m || {};
  return { ...rest, hasApiKey: Boolean(apiKey || api_key) };
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
  removed.sessions = Number((db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId) as any).changes || 0);
  removed.account = Number((db.prepare("DELETE FROM users WHERE id = ?").run(userId) as any).changes || 0);
  return removed;
}
