import { getConversation, getProject, getWorkspaceFile, toValidUuid } from "./db.js";

/**
 * Who owns a record, decided in ONE place.
 *
 * The id guards in server.ts (`app.param("pid")`, `app.param("cid")`) used to look only at records that were loaded in memory, and several
 * handlers fell back to "the first project / any file with a matching name" when an id was unknown. Both let a caller reach another user's
 * data by choosing an id. Everything that takes a project, conversation or file id from a client must answer these questions from here:
 *
 *   "owned"   the record exists and belongs to the caller
 *   "foreign" the record exists and belongs to someone else  -> answer exactly like "not found" (404), never reveal that it exists
 *   "unknown" no such record anywhere (memory or database)   -> the route decides (usually 404)
 *
 * Memory is consulted first, then the database, so a record that was never loaded into memory cannot slip past the check.
 */
export type Ownership = "owned" | "foreign" | "unknown";

/** The same rule as `isUserOwner` in server.ts: identical ids, or ids that map to the same UUID (database rows store the UUID form). */
export function sameOwner(ownerId?: string | null, userId?: string | null): boolean {
  if (!ownerId || !userId) return false;
  if (ownerId === userId) return true;
  const a = toValidUuid(ownerId), b = toValidUuid(userId);
  return Boolean(a && b && a === b);
}

function judge(owner: string | null | undefined, exists: boolean, userId?: string | null): Ownership {
  if (!exists) return "unknown";
  return sameOwner(owner, userId) ? "owned" : "foreign";
}

function viaDb<T>(read: () => T | null | undefined): T | null {
  try { return read() ?? null; } catch { return null; }
}

export function projectOwnership(id: unknown, userId?: string | null, memory?: Map<string, any>): Ownership {
  const pid = typeof id === "string" ? id : "";
  if (!pid) return "unknown";
  const m = memory?.get(pid);
  if (m) return judge(m.user_id, true, userId);
  const row: any = viaDb(() => getProject(pid));
  return judge(row?.user_id, Boolean(row), userId);
}

export function conversationOwnership(id: unknown, userId?: string | null, memory?: Map<string, any>): Ownership {
  const cid = typeof id === "string" ? id : "";
  if (!cid) return "unknown";
  const m = memory?.get(cid);
  if (m) return judge(m.user_id, true, userId);
  const row: any = viaDb(() => getConversation(cid));
  return judge(row?.user_id, Boolean(row), userId);
}

export function fileOwnership(id: unknown, userId?: string | null, memory?: Map<string, any>): Ownership {
  const fid = typeof id === "string" ? id : "";
  if (!fid) return "unknown";
  const m = memory?.get(fid);
  if (m) return judge(m.user_id, true, userId);
  const row: any = viaDb(() => getWorkspaceFile(fid));
  return judge(row?.user_id, Boolean(row), userId);
}
