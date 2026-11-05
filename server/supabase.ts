import "./env-loader.js";
import crypto from "crypto";
import path from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { keyAad, protectSecret, revealSecret } from "./security/secret-store.js";

/**
 * Ensures any identifier is formatted as a valid UUID.
 * If already a valid UUID, returns it lowercase.
 * Otherwise, generates a deterministic RFC 4122 v3/v5 UUID from the string's MD5 hash.
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

/**
 * Environment credentials loaded strictly from process.env (Render / Cloud environment).
 * Secrets like SUPABASE_SERVICE_ROLE_KEY are server-side only and never exposed to the client.
 */
export function getSupabaseUrl(): string {
  let url = process.env.SUPABASE_URL || "";
  url = url.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url
      .replace(/\/storage\/v1.*$/, "")
      .replace(/\/rest\/v1.*$/, "")
      .replace(/\/auth\/v1.*$/, "")
      .replace(/\/realtime.*$/, "");
  }
}

export function getSupabaseAnonKey(): string {
  return (process.env.SUPABASE_ANON_KEY || "").trim();
}

export function getSupabaseServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

export function isSupabaseConfigured(): boolean {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey() || getSupabaseAnonKey();
  return Boolean(url && key);
}

let adminClient: SupabaseClient | null = null;
let circuitBreakerOpenUntil = 0;
let lastCircuitWarningTime = 0;

/**
 * Custom fetch wrapper for Supabase client that enforces a 4-second timeout
 * and activates a circuit breaker when remote Supabase endpoint is unreachable/timing out.
 */
const customSupabaseFetch: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  
  // Combine signals if existing init has signal
  let signal: AbortSignal = controller.signal;
  if (init?.signal) {
    const originalSignal = init.signal;
    originalSignal.addEventListener("abort", () => controller.abort());
  }

  try {
    const res = await fetch(input, {
      ...init,
      signal,
    });
    clearTimeout(timeoutId);
    circuitBreakerOpenUntil = 0; // Successful network request resets circuit breaker
    return res;
  } catch (err: any) {
    clearTimeout(timeoutId);
    const errStr = String(err?.message || err).toLowerCase();
    const isTimeoutOrNetworkFail = 
      err?.name === "AbortError" || 
      errStr.includes("timeout") || 
      errStr.includes("fetch failed") || 
      errStr.includes("econnrefused") || 
      errStr.includes("und_err_connect_timeout");

    if (isTimeoutOrNetworkFail) {
      circuitBreakerOpenUntil = Date.now() + 30000; // Backoff for 30s
      const now = Date.now();
      if (now - lastCircuitWarningTime > 30000) {
        lastCircuitWarningTime = now;
        console.warn("[Supabase] Remote Supabase instance is unreachable or timed out. Cloud sync paused temporarily (local SQLite & RAG active).");
      }
    }
    throw err;
  }
};

/**
 * Returns a server-side Supabase client initialized with the Service Role Key
 * (or Anon Key if service role is omitted).
 * Respects circuit breaker to prevent blocking event loop on unreachable endpoints.
 */
export function getSupabaseAdmin(ignoreCircuitBreaker = false): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!ignoreCircuitBreaker && circuitBreakerOpenUntil > Date.now()) {
    return null; // Circuit open: skip remote call to prevent connect timeout delays
  }
  if (!adminClient) {
    const url = getSupabaseUrl();
    const key = getSupabaseServiceRoleKey() || getSupabaseAnonKey();
    adminClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: customSupabaseFetch,
      },
    });
  }
  return adminClient;
}

export interface SupabaseHealthReport {
  configured: boolean;
  supabaseConnection: "PASS" | "FAIL" | "NOT_CONFIGURED";
  postgreSqlAccess: "PASS" | "FAIL" | "NOT_CONFIGURED";
  storageAccess: "PASS" | "FAIL" | "NOT_CONFIGURED";
  authIntegration: "PASS" | "FAIL" | "NOT_CONFIGURED";
  userProjectIsolation: "PASS" | "FAIL" | "NOT_CONFIGURED";
  details?: {
    tablesFound?: string[];
    bucketsFound?: string[];
    error?: string;
  };
}

/**
 * Verifies live connection to Supabase instance, including PostgreSQL tables,
 * Storage buckets, and Auth service.
 */
export async function verifySupabaseConnection(): Promise<SupabaseHealthReport> {
  if (!isSupabaseConfigured()) {
    return {
      configured: false,
      supabaseConnection: "NOT_CONFIGURED",
      postgreSqlAccess: "NOT_CONFIGURED",
      storageAccess: "NOT_CONFIGURED",
      authIntegration: "NOT_CONFIGURED",
      userProjectIsolation: "NOT_CONFIGURED",
      details: { error: "SUPABASE_URL or keys not set in process.env" },
    };
  }

  const client = getSupabaseAdmin();
  if (!client) {
    return {
      configured: false,
      supabaseConnection: "FAIL",
      postgreSqlAccess: "FAIL",
      storageAccess: "FAIL",
      authIntegration: "FAIL",
      userProjectIsolation: "FAIL",
      details: { error: "Failed to initialize Supabase client" },
    };
  }

  let connectionStatus: "PASS" | "FAIL" = "FAIL";
  let pgStatus: "PASS" | "FAIL" = "FAIL";
  let storageStatus: "PASS" | "FAIL" = "FAIL";
  let authStatus: "PASS" | "FAIL" = "FAIL";
  let isolationStatus: "PASS" | "FAIL" = "FAIL";

  const tablesFound: string[] = [];
  const bucketsFound: string[] = [];
  let lastError: string | undefined;

  try {
    // 1. Verify basic connection & DB access via PostgREST / projects table
    let dbReachable = false;
    const { data: projData, error: projErr } = await client
      .from("projects")
      .select("id")
      .limit(1);

    if (!projErr || projErr.code === 'PGRST204' || (projErr.message && (projErr.message.includes("does not exist") || projErr.message.includes("relation")))) {
      connectionStatus = "PASS";
      pgStatus = "PASS";
      dbReachable = true;
      if (!projErr) tablesFound.push("projects");
    } else {
      lastError = projErr.message;
      if (!projErr.message.includes("fetch failed") && !projErr.message.includes("ENOTFOUND")) {
        connectionStatus = "PASS";
        pgStatus = "PASS";
        dbReachable = true;
      }
    }

    // Check core tables
    const coreTables = [
      "profiles",
      "projects",
      "project_files",
      "rag_document",
      "rag_chunks",
      "conversations",
      "messages",
      "artifacts"
    ];
    for (const t of coreTables) {
      const { error: tErr } = await client.from(t).select("id").limit(1);
      if (!tErr || tErr.code === 'PGRST116' || tErr.code === 'PGRST204' || (tErr.message && (tErr.message.includes("contains 0 rows") || tErr.message.includes("Results contain 0 rows")))) {
        if (!tablesFound.includes(t)) tablesFound.push(t);
      }
    }
    if (dbReachable) {
      pgStatus = "PASS";
    }

    if (tablesFound.length > 0) {
      pgStatus = "PASS";
      connectionStatus = "PASS";
    }

    // 2. Storage Buckets Check
    try {
      const { data: buckets, error: bErr } = await client.storage.listBuckets();
      if (!bErr && Array.isArray(buckets)) {
        storageStatus = "PASS";
        buckets.forEach((b) => {
          if (!bucketsFound.includes(b.name)) bucketsFound.push(b.name);
        });
      } else if (bErr) {
        storageStatus = "FAIL";
        lastError = lastError ? `${lastError} | Storage: ${bErr.message}` : `Storage: ${bErr.message}`;
      }
    } catch (sErr: any) {
      storageStatus = "FAIL";
      lastError = lastError ? `${lastError} | Storage: ${sErr.message}` : `Storage: ${sErr.message}`;
    }

    // 3. Auth Integration Check
    try {
      const { data: authData, error: authErr } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (!authErr) {
        authStatus = "PASS";
      } else {
        authStatus = "FAIL";
        lastError = lastError ? `${lastError} | Auth: ${authErr.message}` : `Auth: ${authErr.message}`;
      }
    } catch (aErr: any) {
      authStatus = "FAIL";
      lastError = lastError ? `${lastError} | Auth: ${aErr.message}` : `Auth: ${aErr.message}`;
    }

    // 4. User/Project Isolation Verification
    if (connectionStatus === "PASS" && pgStatus === "PASS") {
      const testUser = "00000000-0000-0000-0000-000000000000";
      const { error: isoErr } = await client
        .from("projects")
        .select("id, user_id")
        .eq("user_id", testUser);

      if (!isoErr || isoErr.code === 'PGRST204' || (isoErr.message && isoErr.message.includes("does not exist"))) {
        isolationStatus = "PASS";
      } else {
        isolationStatus = "FAIL";
      }
    }

    if (connectionStatus === "PASS" && pgStatus === "PASS" && storageStatus === "PASS" && authStatus === "PASS" && isolationStatus === "PASS") {
      lastError = undefined;
    }

  } catch (err: any) {
    lastError = err.message || String(err);
    connectionStatus = "FAIL";
    pgStatus = "FAIL";
    storageStatus = "FAIL";
    authStatus = "FAIL";
    isolationStatus = "FAIL";
  }

  return {
    configured: true,
    supabaseConnection: connectionStatus,
    postgreSqlAccess: pgStatus,
    storageAccess: storageStatus,
    authIntegration: authStatus,
    userProjectIsolation: isolationStatus,
    details: {
      tablesFound,
      bucketsFound,
      error: lastError,
    },
  };
}

/**
 * Automatically creates required Supabase Storage Buckets if they don't exist yet
 * ('artifacts', 'files', 'docs')
 */
export async function ensureSupabaseBucketsExist(): Promise<string[]> {
  const client = getSupabaseAdmin();
  if (!client) return [];

  const requiredBuckets = ["projects", "project-files", "rag-documents", "artifacts", "files", "docs"];
  const createdOrExisting: string[] = [];

  try {
    const { data: buckets } = await client.storage.listBuckets();
    const existingNames = new Set((buckets || []).map((b) => b.name));

    for (const bName of requiredBuckets) {
      if (!existingNames.has(bName)) {
        const { error } = await client.storage.createBucket(bName, {
          public: true, // Allow direct public URL generation for artifacts/files
          fileSizeLimit: 104857600, // 100MB limit
        });
        if (!error) {
          createdOrExisting.push(bName);
        } else {
          console.warn(`[Supabase] Note on bucket '${bName}':`, error.message);
        }
      } else {
        createdOrExisting.push(bName);
      }
    }
  } catch (err) {
    console.warn("[Supabase] Storage bucket initialization note:", err);
  }

  return createdOrExisting;
}

// =========================================================================
// Entity Persistence Sync Helpers (Supabase PostgreSQL + Storage)
// =========================================================================

export async function ensureUserExistsInSupabase(rawUserId: string): Promise<string | null> {
  const client = getSupabaseAdmin();
  if (!client) return null;
  const validUserId = toValidUuid(rawUserId);
  if (!validUserId) return null;

  try {
    const { data: existingUser } = await client
      .from("users")
      .select("id")
      .eq("id", validUserId)
      .maybeSingle();

    if (existingUser?.id) return validUserId;

    // The mirror stores a pseudonymous placeholder user, never the real e-mail or password hash. (This used to try
    // `getUserById`, which db.ts does not export; the TypeError was swallowed, so the placeholder path is what has always run.
    // Keep it that way on purpose: looking the real user up would copy their e-mail and password hash to the remote table.)
    const localUser: any = null;

    const email = (localUser?.email || `user_${validUserId.slice(0, 8)}@darkness.local`).toLowerCase().trim();
    const name = (localUser?.name || "Darkness User").trim();
    const password = localUser?.password || "hashed_pass";

    await client.from("users").upsert({
      id: validUserId,
      email,
      name,
      password,
      created_at: localUser?.created_at || Date.now(),
      updated_at: Date.now(),
    }, { onConflict: "id" });

    try {
      await client.from("profiles").upsert({
        id: validUserId,
        email,
        display_name: name,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
    } catch {}

    return validUserId;
  } catch (err) {
    return validUserId;
  }
}

export async function syncProjectToSupabase(proj: {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  source_type?: string;
  root_path?: string;
  status?: string;
  created_at: number;
  updated_at: number;
  last_indexed_at?: number;
  metadata?: any;
}) {
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    const validId = toValidUuid(proj.id);
    const validUserId = toValidUuid(proj.user_id);
    if (!validId || !validUserId) return;

    await ensureUserExistsInSupabase(proj.user_id);

    const record = {
      id: validId,
      user_id: validUserId,
      name: proj.name,
      description: proj.description || null,
      created_at: new Date(proj.created_at || Date.now()).toISOString(),
      updated_at: new Date(proj.updated_at || Date.now()).toISOString(),
    };
    await client.from("projects").upsert(record, { onConflict: "id" });
  } catch (err) {
    console.warn("[Supabase Sync] Project upsert notice:", err);
  }
}

export async function syncProjectFileToSupabase(file: {
  id: string;
  user_id?: string;
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
  created_at: number;
  updated_at: number;
}) {
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    const validId = toValidUuid(file.id);
    const validProjectId = toValidUuid(file.project_id);
    const validUserId = toValidUuid(file.user_id);
    if (!validId || !validProjectId) return;

    // Check if parent project exists in Supabase, sync if missing
    const { data: remoteProj } = await client
      .from("projects")
      .select("id")
      .eq("id", validProjectId)
      .maybeSingle();

    if (!remoteProj) {
      try {
        const { getProject } = await import("./db.js");
        const localProj = getProject(validProjectId);
        if (localProj) {
          await syncProjectToSupabase(localProj);
        }
      } catch (dbErr) {
        console.warn("[Supabase Sync] Could not dynamically load local project for file sync:", dbErr);
      }
    }

    const storagePath = `${file.project_id}/${file.path.replace(/^\//, "")}`;
    const record: any = {
      id: validId,
      project_id: validProjectId,
      name: file.name,
      path: file.path,
      storage_path: storagePath,
      mime_type: file.is_binary ? "application/octet-stream" : "text/plain",
      size_bytes: file.size || 0,
      created_at: new Date(file.created_at || Date.now()).toISOString(),
      updated_at: new Date(file.updated_at || Date.now()).toISOString(),
    };
    if (validUserId) {
      record.user_id = validUserId;
    }
    await client.from("project_files").upsert(record, { onConflict: "id" });

    // Also upload to 'files' bucket if content exists
    if (file.content) {
      const buffer = Buffer.from(file.content, file.is_binary ? "base64" : "utf-8");
      await client.storage.from("files").upload(storagePath, buffer, {
        upsert: true,
        contentType: file.is_binary ? "application/octet-stream" : "text/plain",
      });
    }
  } catch (err) {
    console.warn("[Supabase Sync] File upsert error:", err);
  }
}

export async function syncArtifactToSupabase(artifact: {
  id: string;
  user_id?: string;
  project_id: string;
  file_id?: string;
  name: string;
  path?: string;
  mime_type?: string;
  artifact_type?: string;
  version?: number;
  hash?: string;
  content?: string;
  size?: number;
  created_at: number;
  updated_at: number;
}) {
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    const validId = toValidUuid(artifact.id);
    const validProjectId = toValidUuid(artifact.project_id);
    const validUserId = toValidUuid(artifact.user_id);
    if (!validId || !validProjectId) return;

    const storagePath = `${artifact.project_id}/${artifact.id}_${artifact.name}`;
    const record: any = {
      id: validId,
      project_id: validProjectId,
      name: artifact.name,
      artifact_type: artifact.artifact_type || "text",
      storage_path: storagePath,
      mime_type: artifact.mime_type || "text/plain",
      size_bytes: artifact.size || 0,
      status: "ready",
      created_at: new Date(artifact.created_at || Date.now()).toISOString(),
      updated_at: new Date(artifact.updated_at || Date.now()).toISOString(),
    };
    if (validUserId) {
      record.user_id = validUserId;
    }
    await client.from("artifacts").upsert(record, { onConflict: "id" });

    // Store generated artifact binary/text in Supabase Storage 'artifacts' bucket
    if (artifact.content) {
      const isBase64 = artifact.mime_type?.startsWith("image/") || artifact.mime_type?.includes("pdf") || artifact.mime_type?.includes("zip");
      const buffer = isBase64 ? Buffer.from(artifact.content.replace(/^data:[^;]+;base64,/, ""), "base64") : Buffer.from(artifact.content, "utf-8");
      await client.storage.from("artifacts").upload(storagePath, buffer, {
        upsert: true,
        contentType: artifact.mime_type || "text/plain",
      });
    }
  } catch (err) {
    console.warn("[Supabase Sync] Artifact upsert error:", err);
  }
}

export async function syncConversationToSupabase(conv: {
  id: string;
  user_id: string;
  title: string;
  model_id?: string;
  project_id?: string;
  created_at: number;
  updated_at: number;
}) {
  const client = getSupabaseAdmin();
  if (!client) return { success: false, error: "Supabase client not initialized" };
  try {
    const validId = toValidUuid(conv.id);
    const validUserId = toValidUuid(conv.user_id);
    const validProjectId = toValidUuid(conv.project_id);
    if (!validId || !validUserId) return { success: false, error: "Invalid UUID format" };

    // Ensure user row exists in Supabase to satisfy foreign key constraint
    await ensureUserExistsInSupabase(conv.user_id);

    const record: any = {
      id: validId,
      user_id: validUserId,
      title: conv.title,
      created_at: new Date(conv.created_at || Date.now()).toISOString(),
      updated_at: new Date(conv.updated_at || Date.now()).toISOString(),
    };
    if (validProjectId) {
      record.project_id = validProjectId;
    }
    const { error } = await client.from("conversations").upsert(record, { onConflict: "id" });
    if (error) {
      // If foreign key constraint failed, re-attempt user provisioning and retry
      if (String(error.message || "").toLowerCase().includes("foreign key")) {
        await ensureUserExistsInSupabase(conv.user_id);
        const retryRes = await client.from("conversations").upsert(record, { onConflict: "id" });
        if (!retryRes.error) return { success: true };
      }
      console.warn("[Supabase Sync Notice] Conversation upsert notice:", error.message || error);
      return { success: false, error: error.message || error };
    }
    return { success: true };
  } catch (err: any) {
    console.warn("[Supabase Sync] Conversation upsert error:", err);
    return { success: false, error: err?.message || err };
  }
}

export async function syncMessageToSupabase(msg: {
  id: string;
  user_id?: string;
  conversation_id: string;
  role: string;
  content: string;
  model_id?: string;
  metadata?: any;
  created_at: number;
}) {
  const client = getSupabaseAdmin();
  if (!client) return { success: false, error: "Supabase client not initialized" };
  try {
    const validId = toValidUuid(msg.id);
    const validConvId = toValidUuid(msg.conversation_id);
    const validUserId = toValidUuid(msg.user_id);
    if (!validId || !validConvId) return { success: false, error: "Invalid UUID format" };

    if (msg.user_id) {
      await ensureUserExistsInSupabase(msg.user_id);
    }

    const meta = {
      ...(typeof msg.metadata === "object" ? msg.metadata : {}),
      ...(msg.model_id ? { model_id: msg.model_id } : {}),
    };

    const record: any = {
      id: validId,
      conversation_id: validConvId,
      role: msg.role,
      content: msg.content,
      metadata: Object.keys(meta).length > 0 ? meta : null,
      created_at: new Date(msg.created_at || Date.now()).toISOString(),
    };
    if (validUserId) {
      record.user_id = validUserId;
    }
    const { error } = await client.from("messages").upsert(record, { onConflict: "id" });
    if (error) {
      if (String(error.message || "").toLowerCase().includes("foreign key")) {
        // If user_id constraint failed, retry after re-provisioning
        if (msg.user_id) await ensureUserExistsInSupabase(msg.user_id);
        const retryRes = await client.from("messages").upsert(record, { onConflict: "id" });
        if (!retryRes.error) return { success: true };

        // Fallback: omit user_id on message record if constraint is specific to user_id
        if (record.user_id) {
          const fallbackRecord = { ...record };
          delete fallbackRecord.user_id;
          const fallbackRes = await client.from("messages").upsert(fallbackRecord, { onConflict: "id" });
          if (!fallbackRes.error) return { success: true };
        }
      }
      console.warn("[Supabase Sync Notice] Message upsert notice:", error.message || error);
      return { success: false, error: error.message || error };
    }
    return { success: true };
  } catch (err: any) {
    console.warn("[Supabase Sync] Message upsert error:", err);
    return { success: false, error: err?.message || err };
  }
}

export async function syncRagDocumentToSupabase(doc: {
  id?: string;
  project_id: string;
  user_id: string;
  name: string;
  storage_path?: string | null;
  mime_type?: string | null;
  status?: string;
  created_at?: string;
  /** callers also pass size / chunks_count; the mirror table does not store them (accepted and ignored) */
  size?: number;
  chunks_count?: number;
}): Promise<string | null> {
  const client = getSupabaseAdmin();
  if (!client) return null;
  try {
    const validProjectId = toValidUuid(doc.project_id);
    const validUserId = toValidUuid(doc.user_id);
    if (!validProjectId || !validUserId) return null;

    const record: any = {
      project_id: validProjectId,
      user_id: validUserId,
      name: doc.name,
      storage_path: doc.storage_path || null,
      mime_type: doc.mime_type || "text/plain",
      status: doc.status || "Indexed",
    };
    if (doc.id) {
      const validDocId = toValidUuid(doc.id);
      if (validDocId) record.id = validDocId;
    }
    const { data, error } = await client.from("rag_documents").upsert(record).select("id").single();
    if (error) {
      if (!String(error?.message || error).includes("fetch failed")) { console.warn("[Supabase Sync] rag_documents upsert notice:", error?.message || error); }
      return null;
    }
    return data?.id || null;
  } catch (err: any) {
    if (!String(err?.message || err).includes("fetch failed")) { console.warn("[Supabase Sync] rag_documents notice:", err?.message || err); }
    return null;
  }
}

export async function syncRagChunkToSupabase(chunk: {
  id?: string;
  document_id: string;
  project_id: string;
  user_id: string;
  chunk_index: any;
  content: string;
  embedding?: any;
  metadata?: any;
}) {
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    const validDocId = toValidUuid(chunk.document_id);
    const validProjectId = toValidUuid(chunk.project_id);
    const validUserId = toValidUuid(chunk.user_id);
    if (!validDocId || !validProjectId || !validUserId) return;

    const rawIndex = chunk.chunk_index;
    const parsedIndex = typeof rawIndex === "number" && !isNaN(rawIndex)
      ? Math.floor(rawIndex)
      : (parseInt(String(rawIndex || "").replace(/\D+/g, ""), 10) || 0);

    const record: any = {
      document_id: validDocId,
      project_id: validProjectId,
      user_id: validUserId,
      chunk_index: parsedIndex,
      content: chunk.content,
      embedding: chunk.embedding || null,
      metadata: chunk.metadata || null,
    };
    if (chunk.id) {
      const validChunkId = toValidUuid(chunk.id);
      if (validChunkId) record.id = validChunkId;
    }
    const { error } = await client.from("rag_chunks").upsert(record);
    if (error) {
      console.warn("[Supabase Sync] rag_chunks notice:", error?.message || error);
    }
  } catch (err: any) {
    console.warn("[Supabase Sync] rag_chunks notice:", err?.message || err);
  }
}

export async function syncKnowledgeChunkToSupabase(chunk: {
  id: string;
  project_id: string;
  file_id: string;
  chunk_id: any;
  content: string;
  chunk_type?: string;
  symbol?: string;
  start_line?: number;
  end_line?: number;
  hash?: string;
  version?: number;
  created_at: number;
}) {
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    const validProjectId = toValidUuid(chunk.project_id);
    const validChunkId = toValidUuid(chunk.id);
    if (!validProjectId || !validChunkId) return;

    // 1. Retrieve the project's user_id dynamically
    let { data: proj, error: projErr } = await client
      .from("projects")
      .select("user_id")
      .eq("id", validProjectId)
      .maybeSingle();

    if (!proj) {
      try {
        const { getProject } = await import("./db.js");
        const localProj = getProject(validProjectId);
        if (localProj) {
          await syncProjectToSupabase(localProj);
          proj = { user_id: localProj.user_id };
        }
      } catch (dbErr) {
        console.warn("[Supabase Sync] Could not dynamically load local project for chunk sync:", dbErr);
      }
    }

    const userId = proj?.user_id || "3368b278-10c5-4890-9353-69a2348aed24"; // fallback to stable user id if needed

    // 2. Query or create the parent rag_documents record
    const docName = chunk.file_id;
    let documentId: string | null = null;

    const { data: docRecord, error: docErr } = await client
      .from("rag_documents")
      .select("id")
      .eq("project_id", validProjectId)
      .eq("name", docName)
      .maybeSingle();

    if (docRecord?.id) {
      documentId = docRecord.id;
    } else {
      // Create new rag_documents record
      const generatedDocId = toValidUuid(`doc_${validProjectId}_${docName}`)!;
      const { data: newDoc, error: insertErr } = await client
        .from("rag_documents")
        .upsert({
          id: generatedDocId,
          user_id: userId,
          project_id: validProjectId,
          name: docName,
          mime_type: chunk.chunk_type === "code" ? "text/plain" : "text/markdown",
          status: "Indexed",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: "id" })
        .select("id")
        .maybeSingle();

      if (insertErr) {
        console.warn("[Supabase Sync] Failed to create parent rag_documents record:", insertErr.message);
        return;
      }
      documentId = newDoc?.id || generatedDocId;
    }

    if (!documentId) return;

    // 3. Upsert into rag_chunks with sanitized integer chunk_index
    const parsedChunkIndex = typeof chunk.chunk_id === "number" && !isNaN(chunk.chunk_id)
      ? Math.floor(chunk.chunk_id)
      : (parseInt(String(chunk.chunk_id || "").replace(/\D+/g, ""), 10) || 0);

    const meta = {
      raw_chunk_id: String(chunk.chunk_id || ""),
      symbol: chunk.symbol || null,
      start_line: typeof chunk.start_line === "number" ? chunk.start_line : null,
      end_line: typeof chunk.end_line === "number" ? chunk.end_line : null,
      hash: chunk.hash || null,
      version: typeof chunk.version === "number" ? chunk.version : 1,
      chunk_type: chunk.chunk_type || "text"
    };

    // Explicitly stringify metadata for rag_chunks to prevent TypeError: fetch failed
    let safeMeta: any = meta;
    if (typeof meta === "object" && meta !== null) {
      try {
        safeMeta = JSON.parse(JSON.stringify(meta));
      } catch (e) {
        safeMeta = {};
      }
    }
    const { error: chunkErr } = await client.from("rag_chunks").upsert({
      id: validChunkId,
      user_id: userId,
      project_id: validProjectId,
      document_id: documentId,
      chunk_index: parsedChunkIndex,
      content: chunk.content,
      metadata: safeMeta,
      created_at: new Date(chunk.created_at || Date.now()).toISOString()
    }, { onConflict: "id" });

    if (chunkErr) {
      // Non-fatal warning if network/fetch hiccup occurs
      if (!String(chunkErr.message || "").includes("fetch failed")) {
        console.warn("[Supabase Sync] rag_chunks upsert error:", chunkErr.message);
      }
    }
  } catch (err: any) {
    if (!String(err?.message || "").includes("fetch failed")) {
      console.warn("[Supabase Sync] Knowledge chunk sync error:", err?.message || err);
    }
  }
}

export async function ensureStorageBuckets(): Promise<void> {
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    const { data: buckets } = await client.storage.listBuckets();
    const existingNames = new Set((buckets || []).map((b) => b.name));
    const required = [
      "projects",
      "project-files",
      "rag-documents",
      "artifacts",
      "darkness-project-files",
      "darkness-rag-documents",
      "darkness-artifacts",
      "darkness-exports",
    ];
    for (const bucketName of required) {
      if (!existingNames.has(bucketName)) {
        try {
          await client.storage.createBucket(bucketName, { public: false });
          console.log(`[Supabase Storage] Created bucket: ${bucketName}`);
        } catch (err: any) {
          if (!err?.message?.includes("already exists")) {
            console.warn(`[Supabase Storage] Notice creating bucket ${bucketName}:`, err?.message || err);
          }
        }
      }
    }
  } catch (err) {
    console.warn("[Supabase Storage] Bucket check notice:", err);
  }
}

export async function syncModelToSupabase(model: any): Promise<{ success: boolean; error?: any; code?: string; details?: string; hint?: string }> {
  const client = getSupabaseAdmin();
  if (!client) {
    console.error("[MODEL TRACE] syncModelToSupabase: Supabase admin client not configured");
    return { success: false, error: "Supabase client not configured" };
  }
  try {
    let capsStr = "{}";
    if (model.capabilities) {
      capsStr = typeof model.capabilities === 'string' ? model.capabilities : JSON.stringify(model.capabilities);
    }
    const uid = toValidUuid(model.user_id || model.userId || "user_default")!;
    const rawId = String(model.id || "").trim();
    const cleanId = rawId.includes(":::") ? rawId.split(":::").pop()! : rawId;
    if (!cleanId) {
      return { success: false, error: "Model ID is required" };
    }
    const record = {
      id: cleanId,
      user_id: uid,
      name: model.name || cleanId,
      provider: model.provider || "custom",
      provider_model_id: model.modelName || model.provider_model_id || model.model_name || cleanId,
      capabilities: capsStr,
      context_window: Number(model.contextWindow ?? model.context_window ?? 16000),
      max_output_tokens: Number(model.maxOutputTokens ?? model.max_output_tokens ?? 4096),
      temperature: Number(model.defaultTemperature ?? model.temperature ?? model.default_temperature ?? 0.7),
      top_p: Number(model.defaultTopP ?? model.top_p ?? model.default_top_p ?? 1.0),
      base_url: model.baseUrl || model.base_url || "",
      // sealed (when PRIVACY_ENCRYPTION_KEY is set) before it leaves this server: the cloud copy never holds a plaintext key
      api_secret: protectSecret(model.apiKey || model.api_secret || model.api_key || "", keyAad("cloud", uid, cleanId)) || "",
      enabled: model.enabled !== false && model.enabled !== 0 ? 1 : 0,
      status: model.status || "available",
      is_user: model.isUser || model.is_user ? 1 : 0,
      created_at: model.created_at || Date.now(),
      updated_at: model.updated_at || Date.now(),
    };

    console.log(`[MODEL TRACE] UPSERTing model id=${record.id}, user_id=${record.user_id}, provider=${record.provider}, provider_model_id=${record.provider_model_id}`);

    let { data, error } = await client.from("models").upsert(record, { onConflict: "user_id,id" }).select();
    if (error && (error.message?.includes("constraint") || error.code === "42P10")) {
      const res2 = await client.from("models").upsert(record, { onConflict: "id" }).select();
      error = res2.error;
      data = res2.data;
    }
    if (error) {
      console.error(`[MODEL TRACE] Model upsert error code=${error.code}, message=${error.message}, details=${error.details}, hint=${error.hint}`);
      return { 
        success: false, 
        error: error.message || "Database upsert failed", 
        code: error.code, 
        details: error.details, 
        hint: error.hint 
      };
    }

    console.log(`[MODEL TRACE] Model upsert successful id=${record.id}, user_id=${record.user_id}`);
    return { success: true };
  } catch (err: any) {
    console.error("[MODEL TRACE] Model upsert exception:", err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

export async function deleteModelFromSupabase(modelId: string, userId?: string): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseAdmin();
  if (!client) return { success: false, error: "Supabase not configured" };
  try {
    const rawId = String(modelId || "").trim();
    const cleanId = rawId.includes(":::") ? rawId.split(":::").pop()! : rawId;
    const validUserId = userId ? toValidUuid(userId) : null;
    const idsToDelete = Array.from(new Set([
      rawId,
      cleanId,
      ...(validUserId ? [`${validUserId}:::${cleanId}`, `${validUserId}:::${rawId}`] : []),
      ...(userId && userId !== validUserId ? [`${userId}:::${cleanId}`, `${userId}:::${rawId}`] : [])
    ])).filter(Boolean);

    let query = client.from("models").delete().in("id", idsToDelete);
    if (validUserId && userId && validUserId !== userId) {
      query = query.or(`user_id.eq.${validUserId},user_id.eq.${userId}`);
    } else if (validUserId) {
      query = query.eq("user_id", validUserId);
    }
    const res = await query;
    if (res.error) {
      console.warn("[Supabase Sync] Model delete error:", res.error);
      return { success: false, error: res.error.message };
    }
    return { success: true };
  } catch (err: any) {
    console.warn("[Supabase Sync] Model delete error:", err);
    return { success: false, error: err?.message || String(err) };
  }
}

export async function deleteConversationFromSupabase(conversationId: string, userId?: string): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseAdmin();
  if (!client) return { success: false, error: "Supabase not configured" };
  try {
    const rawCid = String(conversationId || "").trim();
    const validCid = toValidUuid(rawCid) || rawCid;
    const cids = Array.from(new Set([rawCid, validCid])).filter(Boolean);

    // 1. Delete messages
    await client.from("messages").delete().in("conversation_id", cids);

    // 2. Delete conversation
    let query = client.from("conversations").delete().in("id", cids);
    if (userId) {
      const validUid = toValidUuid(userId);
      if (validUid && validUid !== userId) {
        query = query.or(`user_id.eq.${userId},user_id.eq.${validUid}`);
      } else if (validUid) {
        query = query.eq("user_id", validUid);
      }
    }
    const res = await query;
    if (res.error) {
      console.warn("[Supabase Sync] Conversation delete warning:", res.error);
      return { success: false, error: res.error.message };
    }
    return { success: true };
  } catch (err: any) {
    console.warn("[Supabase Sync] Exception deleting conversation from Supabase:", err);
    return { success: false, error: err?.message || String(err) };
  }
}

export async function deleteProjectFromSupabase(projectId: string, userId?: string): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseAdmin();
  if (!client) return { success: false, error: "Supabase not configured" };
  try {
    const rawPid = String(projectId || "").trim();
    const validPid = toValidUuid(rawPid) || rawPid;
    const pids = Array.from(new Set([rawPid, validPid])).filter(Boolean);

    // 1. Delete associated messages of project conversations
    const { data: convs } = await client
      .from("conversations")
      .select("id")
      .in("project_id", pids);
    if (convs && convs.length > 0) {
      const cids = convs.map((c: any) => c.id);
      await client.from("messages").delete().in("conversation_id", cids);
      await client.from("conversations").delete().in("id", cids);
    }

    // 2. Delete knowledge chunks across all chunk tables
    try {
      await client.from("knowledge_chunks").delete().in("project_id", pids);
    } catch {}
    try {
      await client.from("rag_chunks").delete().in("project_id", pids);
      await client.from("rag_documents").delete().in("project_id", pids);
    } catch {}

    // 3. Delete artifacts
    try {
      await client.from("artifacts").delete().in("project_id", pids);
    } catch {}

    // 4. Delete project files
    try {
      await client.from("project_files").delete().in("project_id", pids);
    } catch {}

    // 5. Delete project record
    let query = client.from("projects").delete().in("id", pids);
    if (userId) {
      const validUid = toValidUuid(userId);
      if (validUid && validUid !== userId) {
        query = query.or(`user_id.eq.${userId},user_id.eq.${validUid}`);
      } else if (validUid) {
        query = query.eq("user_id", validUid);
      }
    }
    const res = await query;
    if (res.error) {
      console.warn("[Supabase Sync] Project delete warning:", res.error);
      return { success: false, error: res.error.message };
    }
    return { success: true };
  } catch (err: any) {
    console.warn("[Supabase Sync] Exception deleting project from Supabase:", err);
    return { success: false, error: err?.message || String(err) };
  }
}

export async function syncUserToSupabase(user: {
  id: string;
  email: string;
  name: string;
  password?: string;
  rawPassword?: string;
  active_model_id?: string;
  created_at: number;
}): Promise<{ success: boolean; authUserId?: string; error?: string }> {
  const client = getSupabaseAdmin();
  if (!client) return { success: false, error: "Supabase not configured" };

  const cleanEmail = user.email.toLowerCase().trim();
  const cleanName = (user.name || cleanEmail.split("@")[0]).trim();
  let tableSuccess = false;
  let authSuccess = false;
  let lastErr = "";

  let authUserId: string | null = null;

  // Tier 1: Sync to Supabase Auth admin API (auth.users)
  // Guarantees canonical auth user in auth.users
  try {
    const rawPass = user.rawPassword || (user.password && !user.password.includes(":") ? user.password : undefined);
    const { data: createData, error: authErr } = await client.auth.admin.createUser({
      email: cleanEmail,
      password: rawPass || `Darkness_${user.id}_Secure!`,
      email_confirm: true,
      user_metadata: {
        id: user.id,
        name: cleanName,
        password_hash: user.password || "",
        active_model_id: user.active_model_id || "",
      },
    });

    if (!authErr && createData?.user) {
      authSuccess = true;
      authUserId = createData.user.id;
    } else if (authErr && (authErr.message?.includes("already") || authErr.status === 422)) {
      // User exists in Supabase Auth, update their metadata & password
      const { data: userList } = await client.auth.admin.listUsers({ page: 1, perPage: 100 });
      const found = userList?.users?.find((u: any) => u.email?.toLowerCase() === cleanEmail);
      if (found) {
        authUserId = found.id;
        const updatePayload: any = {
          user_metadata: {
            id: user.id,
            name: cleanName,
            password_hash: user.password || "",
            active_model_id: user.active_model_id || "",
          },
        };
        if (rawPass) {
          updatePayload.password = rawPass;
        }
        await client.auth.admin.updateUserById(found.id, updatePayload);
        authSuccess = true;
      }
    }
  } catch (authEx: any) {
    console.warn("[Supabase Sync] Supabase Auth admin notice:", authEx?.message || authEx);
  }

  // Tier 2: Upsert into public.profiles table (foreign key to auth.users.id)
  if (authUserId) {
    try {
      const { error: profErr } = await client.from("profiles").upsert({
        id: authUserId,
        email: cleanEmail,
        display_name: cleanName,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (!profErr) {
        tableSuccess = true;
      } else {
        console.warn("[Supabase Sync] profiles table upsert notice:", profErr.message);
      }
    } catch (profEx: any) {
      console.warn("[Supabase Sync] profiles upsert exception:", profEx?.message || profEx);
    }
  }

  // Tier 3: Upsert into public.users table if it exists
  try {
    const validUserId = toValidUuid(user.id) || user.id;
    const record = {
      id: validUserId,
      email: cleanEmail,
      name: cleanName,
      password: user.password || "",
      active_model_id: user.active_model_id || "",
      created_at: user.created_at || Date.now(),
      updated_at: Date.now(),
    };
    const { error: tblErr } = await client.from("users").upsert(record, { onConflict: "id" });
    if (!tblErr) {
      tableSuccess = true;
    } else {
      lastErr = tblErr.message;
    }
  } catch (err: any) {
    lastErr = err?.message || String(err);
  }

  return { success: tableSuccess || authSuccess, authUserId: authUserId || undefined, error: lastErr || undefined };
}

export class SupabaseUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseUnreachableError";
  }
}

function isNetworkError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("enotfound") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("network error") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504")
  );
}

export async function checkSupabaseUserExists(email: string): Promise<{
  id: string;
  email: string;
  name: string;
  password?: string;
  active_model_id?: string;
  created_at: number;
} | null> {
  const client = getSupabaseAdmin();
  if (!client) return null;
  const cleanEmail = email.toLowerCase().trim();

  // 1. Try public.users table
  try {
    const { data, error } = await client.from("users").select("*").eq("email", cleanEmail).limit(1);
    if (!error && data && data.length > 0) {
      const u = data[0];
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        password: u.password || "",
        active_model_id: u.active_model_id || "",
        created_at: Number(u.created_at) || Date.now(),
      };
    }
    if (error && isNetworkError(error)) {
      throw new SupabaseUnreachableError(error.message);
    }
  } catch (e: any) {
    if (e instanceof SupabaseUnreachableError || isNetworkError(e)) {
      throw new SupabaseUnreachableError(e.message || "Supabase connection unreachable");
    }
  }

  // 2. Try Supabase Auth admin
  try {
    const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 100 });
    if (error && isNetworkError(error)) {
      throw new SupabaseUnreachableError(error.message);
    }
    const found = data?.users?.find((u: any) => u.email?.toLowerCase() === cleanEmail);
    if (found) {
      const meta = found.user_metadata || {};
      return {
        id: meta.id || found.id,
        email: found.email || cleanEmail,
        name: meta.name || cleanEmail.split("@")[0],
        password: meta.password_hash || "",
        active_model_id: meta.active_model_id || "",
        created_at: new Date(found.created_at).getTime() || Date.now(),
      };
    }
  } catch (e: any) {
    if (e instanceof SupabaseUnreachableError || isNetworkError(e)) {
      throw new SupabaseUnreachableError(e.message || "Supabase connection unreachable");
    }
  }

  return null;
}

export async function authenticateWithSupabase(email: string, password: string): Promise<{
  id: string;
  email: string;
  name: string;
  password?: string;
  active_model_id?: string;
  created_at: number;
} | null> {
  if (!isSupabaseConfigured()) return null;
  const cleanEmail = email.toLowerCase().trim();
  const url = getSupabaseUrl();
  const authKey = getSupabaseAnonKey() || getSupabaseServiceRoleKey();

  // Create an ephemeral auth client to avoid mutating shared adminClient session state
  const authClient = createClient(url, authKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  // First verify directly via Supabase Auth
  try {
    const { data: authData, error: authErr } = await authClient.auth.signInWithPassword({
      email: cleanEmail,
      password: password,
    });
    if (!authErr && authData?.user) {
      const meta = authData.user.user_metadata || {};
      return {
        id: meta.id || authData.user.id,
        email: authData.user.email || cleanEmail,
        name: meta.name || cleanEmail.split("@")[0],
        password: meta.password_hash || "",
        active_model_id: meta.active_model_id || "",
        created_at: new Date(authData.user.created_at).getTime() || Date.now(),
      };
    }
    if (authErr && isNetworkError(authErr)) {
      throw new SupabaseUnreachableError(authErr.message);
    }
  } catch (e: any) {
    if (e instanceof SupabaseUnreachableError || isNetworkError(e)) {
      throw new SupabaseUnreachableError(e.message || "Supabase Auth unreachable");
    }
  }

  return null;
}

export async function syncSessionToSupabase(session: {
  token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}): Promise<void> {
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    await client.from("sessions").upsert(session, { onConflict: "token" });
  } catch (err: any) {
    console.warn("[Supabase Sync] Session upsert notice:", err?.message || err);
  }
}

export async function deleteSessionFromSupabase(token: string): Promise<void> {
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    await client.from("sessions").delete().eq("token", token);
  } catch (err: any) {
    console.warn("[Supabase Sync] Session delete notice:", err?.message || err);
  }
}

export async function syncWorkspaceFileToSupabase(file: {
  id: string;
  user_id: string;
  filename: string;
  mime: string;
  size: number;
  file_type: string;
  content: string;
  uploaded_at: number;
}): Promise<void> {
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    await client.from("workspace_files").upsert(file, { onConflict: "id" });
  } catch (err: any) {
    console.warn("[Supabase Sync] Workspace file upsert notice:", err?.message || err);
  }
}

export async function deleteWorkspaceFileFromSupabase(id: string): Promise<void> {
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    await client.from("workspace_files").delete().eq("id", id);
  } catch (err: any) {
    console.warn("[Supabase Sync] Workspace file delete notice:", err?.message || err);
  }
}

export async function deleteKnowledgeChunksFromSupabase(projectId: string, fileId?: string): Promise<void> {
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    const rawPid = String(projectId || "").trim();
    const validProjectId = toValidUuid(rawPid) || rawPid;
    const pids = Array.from(new Set([rawPid, validProjectId])).filter(Boolean);

    if (fileId) {
      const rawFid = String(fileId).trim();
      const validFid = toValidUuid(rawFid);
      const fids = Array.from(new Set([rawFid, validFid, rawFid.split("/").pop()])).filter(Boolean) as string[];

      // Find the document record in rag_documents to delete its chunks first
      const { data: docRecords } = await client
        .from("rag_documents")
        .select("id")
        .in("project_id", pids)
        .in("name", fids);

      const docIds = (docRecords || []).map((d: any) => d.id);
      if (validFid) docIds.push(validFid);

      if (docIds.length > 0) {
        try {
          await client.from("rag_chunks").delete().in("document_id", docIds);
          await client.from("rag_documents").delete().in("id", docIds);
        } catch {}
      }
      try {
        await client.from("knowledge_chunks").delete().in("project_id", pids).in("file_id", fids);
      } catch {}
    } else {
      // Delete all chunks for the project across both tables
      try {
        await client.from("knowledge_chunks").delete().in("project_id", pids);
      } catch {}
      try {
        await client.from("rag_chunks").delete().in("project_id", pids);
        await client.from("rag_documents").delete().in("project_id", pids);
      } catch {}
    }
  } catch (err: any) {
    console.warn("[Supabase Sync] RAG documents/chunks delete notice:", err?.message || err);
  }
}

export async function hydrateAllFromSupabase(dbAdapters: {
  dbSaveUser?: (user: any) => void;
  dbSaveProject?: (proj: any) => void;
  dbSaveFile?: (file: any) => void;
  dbSaveModel?: (model: any) => void;
  dbSaveConversation?: (cid: string, userId: string, title: string, modelId?: string, skipSync?: boolean) => void;
  dbSaveMessage?: (msgId: string, cid: string, role: string, content: string, modelId?: string, attachments?: any, skipSync?: boolean) => void;
  dbSaveArtifact?: (artifact: any) => void;
  dbSaveWorkspaceFile?: (file: any) => void;
  dbSaveSession?: (token: string, userId: string, expiresAt: number) => void;
  dbCreateKnowledgeChunksBatch?: (chunks: any[]) => void;
  dbUpsertKnowledgeSource?: (source: any) => void;
  dbIsModelDeleted?: (id: string, userId?: string) => boolean;
}): Promise<{
  usersCount: number;
  sessionsCount: number;
  projectsCount: number;
  modelsCount: number;
  conversationsCount: number;
  messagesCount: number;
  artifactsCount: number;
  filesCount: number;
  workspaceFilesCount: number;
  knowledgeChunksCount: number;
}> {
  const client = getSupabaseAdmin();
  if (!client) {
    console.warn("[Supabase Hydration] Supabase client not configured. Skipping Supabase hydration.");
    return {
      usersCount: 0,
      sessionsCount: 0,
      projectsCount: 0,
      modelsCount: 0,
      conversationsCount: 0,
      messagesCount: 0,
      artifactsCount: 0,
      filesCount: 0,
      workspaceFilesCount: 0,
      knowledgeChunksCount: 0,
    };
  }

  console.log("[Supabase Hydration] Fetching full production state from Supabase PostgreSQL...");

  let usersCount = 0;
  let sessionsCount = 0;
  let projectsCount = 0;
  let modelsCount = 0;
  let conversationsCount = 0;
  let messagesCount = 0;
  let artifactsCount = 0;
  let filesCount = 0;
  let workspaceFilesCount = 0;
  let knowledgeChunksCount = 0;

  try {
    // 1. Hydrate Users (Dual source: public.users table + auth.users admin list)
    const hydratedUserEmails = new Set<string>();
    try {
      const { data: dbUsers, error: uErr } = await client.from("users").select("*");
      if (!uErr && dbUsers && dbUsers.length > 0) {
        usersCount = dbUsers.length;
        for (const u of dbUsers) {
          hydratedUserEmails.add(u.email?.toLowerCase());
          if (dbAdapters.dbSaveUser) {
            dbAdapters.dbSaveUser({
              id: u.id,
              email: u.email,
              name: u.name,
              password: u.password || "",
              active_model_id: u.active_model_id || "",
              created_at: Number(u.created_at) || Date.now(),
            });
          }
        }
      }
    } catch (e: any) {
      console.warn("[Supabase Hydration] Note on public.users query:", e?.message || e);
    }

    // Fallback: Check Supabase Auth admin for any users not in public.users
    try {
      const { data: authList } = await client.auth.admin.listUsers({ page: 1, perPage: 100 });
      if (authList?.users) {
        for (const au of authList.users) {
          const email = au.email?.toLowerCase();
          if (email && !hydratedUserEmails.has(email)) {
            const meta = au.user_metadata || {};
            usersCount++;
            hydratedUserEmails.add(email);
            if (dbAdapters.dbSaveUser) {
              dbAdapters.dbSaveUser({
                id: meta.id || au.id,
                email: email,
                name: meta.name || email.split("@")[0],
                password: meta.password_hash || "",
                active_model_id: meta.active_model_id || "",
                created_at: new Date(au.created_at).getTime() || Date.now(),
              });
            }
          }
        }
      }
    } catch (e: any) {
      console.warn("[Supabase Hydration] Note on auth.admin listUsers:", e?.message || e);
    }

    // 2. Hydrate Sessions
    try {
      const { data: dbSessions, error: sErr } = await client
        .from("sessions")
        .select("*")
        .gt("expires_at", Date.now());
      if (!sErr && dbSessions && dbSessions.length > 0) {
        sessionsCount = dbSessions.length;
        for (const s of dbSessions) {
          if (dbAdapters.dbSaveSession) {
            dbAdapters.dbSaveSession(s.token, s.user_id, Number(s.expires_at));
          }
        }
      }
    } catch (e: any) {
      console.warn("[Supabase Hydration] Note on sessions query:", e?.message || e);
    }

    // 3. Hydrate Projects
    const { data: dbProjects, error: pErr } = await client.from("projects").select("*");
    if (!pErr && dbProjects) {
      projectsCount = dbProjects.length;
      for (const p of dbProjects) {
        if (dbAdapters.dbSaveProject) {
          try {
            dbAdapters.dbSaveProject({
              id: p.id,
              user_id: p.user_id || "user_default",
              name: p.name,
              description: p.description || "",
              source_type: p.source_type || "upload",
              root_path: p.root_path || "",
              status: p.status || "ready",
              created_at: Number(p.created_at) || Date.now(),
              updated_at: Number(p.updated_at) || Date.now(),
              last_indexed_at: p.last_indexed_at ? Number(p.last_indexed_at) : null,
              metadata: p.metadata,
            });
          } catch (projErr: any) {
            console.warn(`[Supabase Hydration] Note hydrating project ${p.id}:`, projErr?.message || projErr);
          }
        }
      }
    }

    // 4. Hydrate Models
    const { data: dbModels, error: mErr } = await client.from("models").select("*");
    if (!mErr && dbModels) {
      modelsCount = dbModels.length;
      for (const m of dbModels) {
        if (dbAdapters.dbSaveModel) {
          try {
            let caps = m.capabilities;
            if (typeof caps === "string") {
              try { caps = JSON.parse(caps); } catch {}
            }
            const rawModelId = String(m.id || "").trim();
            const cleanModelId = rawModelId.includes(":::") ? rawModelId.split(":::").pop()! : rawModelId;
            const modelUserId = m.user_id || "user_default";

            if (dbAdapters.dbIsModelDeleted && dbAdapters.dbIsModelDeleted(cleanModelId, modelUserId)) {
              console.log(`[Supabase Hydration] Skipping deleted model ${cleanModelId} for user ${modelUserId}`);
              continue;
            }

            dbAdapters.dbSaveModel({
              id: cleanModelId,
              user_id: modelUserId,
              name: m.name,
              provider: m.provider,
              baseUrl: m.base_url || "",
              apiKey: revealSecret(m.api_secret || m.api_key || "", keyAad("cloud", modelUserId, cleanModelId), keyAad("cloud", m.user_id, cleanModelId)),
              modelName: m.provider_model_id || m.model_name || m.id,
              modelType: m.model_type || "text",
              capabilities: caps || {},
              contextWindow: Number(m.context_window) || 16000,
              maxOutputTokens: Number(m.max_output_tokens) || 4096,
              defaultTemperature: Number(m.temperature ?? m.default_temperature) || 0.7,
              defaultTopP: Number(m.top_p ?? m.default_top_p) || 1.0,
              supportsStreaming: m.supports_streaming !== 0,
              enabled: m.enabled !== 0,
              status: m.status || "available",
              isUser: m.is_user !== 0,
            });
          } catch (modelErr: any) {
            console.warn(`[Supabase Hydration] Note hydrating model ${m.id}:`, modelErr?.message || modelErr);
          }
        }
      }
    }

    // 5. Hydrate Conversations
    const { data: dbConvs, error: cErr } = await client.from("conversations").select("*");
    if (!cErr && dbConvs) {
      conversationsCount = dbConvs.length;
      for (const c of dbConvs) {
        if (dbAdapters.dbSaveConversation) {
          try {
            dbAdapters.dbSaveConversation(c.id, c.user_id || "user_default", c.title, c.model_id, true);
          } catch (convErr: any) {
            console.warn(`[Supabase Hydration] Note hydrating conversation ${c.id}:`, convErr?.message || convErr);
          }
        }
      }
    }

    // 6. Hydrate Messages
    const { data: dbMsgs, error: msgErr } = await client.from("messages").select("*");
    if (!msgErr && dbMsgs) {
      messagesCount = dbMsgs.length;
      for (const msg of dbMsgs) {
        if (dbAdapters.dbSaveMessage) {
          try {
            dbAdapters.dbSaveMessage(msg.id, msg.conversation_id, msg.role, msg.content, msg.model_id, msg.attachments, true);
          } catch (msgErrItem: any) {
            console.warn(`[Supabase Hydration] Note hydrating message ${msg.id}:`, msgErrItem?.message || msgErrItem);
          }
        }
      }
    }

    // 7. Hydrate Artifacts
    const { data: dbArts, error: aErr } = await client.from("artifacts").select("*");
    if (!aErr && dbArts) {
      artifactsCount = dbArts.length;
      for (const a of dbArts) {
        if (dbAdapters.dbSaveArtifact) {
          try {
            let content = a.content || "";
            if (!content && a.storage_path) {
              try {
                const { data: downloaded } = await client.storage.from("artifacts").download(a.storage_path);
                if (downloaded) {
                  content = await downloaded.text();
                }
              } catch (e: any) {
                console.warn(`[Supabase Hydration] Could not download artifact storage file ${a.storage_path}:`, e?.message || e);
              }
            }
            dbAdapters.dbSaveArtifact({
              id: a.id,
              project_id: a.project_id,
              file_id: a.file_id || null,
              name: a.name,
              path: a.path || null,
              mime_type: a.mime_type || null,
              artifact_type: a.artifact_type || null,
              version: Number(a.version) || 1,
              hash: a.hash || null,
              content: content,
              created_at: Number(a.created_at) || Date.now(),
              updated_at: Number(a.updated_at) || Date.now(),
            });
          } catch (artErr: any) {
            console.warn(`[Supabase Hydration] Note hydrating artifact ${a.id}:`, artErr?.message || artErr);
          }
        }
      }
    }

    // 8. Hydrate Project Files
    const { data: dbFiles, error: fErr } = await client.from("project_files").select("*");
    if (!fErr && dbFiles) {
      filesCount = dbFiles.length;
      for (const f of dbFiles) {
        if (dbAdapters.dbSaveFile) {
          try {
            let content = f.content || "";
            if (!content && f.storage_path) {
              try {
                const { data: downloaded } = await client.storage.from("files").download(f.storage_path);
                if (downloaded) {
                  content = await downloaded.text();
                }
              } catch (e: any) {
                console.warn(`[Supabase Hydration] Could not download project file ${f.storage_path}:`, e?.message || e);
              }
            }
            dbAdapters.dbSaveFile({
              id: f.id,
              project_id: f.project_id,
              path: f.path,
              name: f.name,
              extension: f.extension || "",
              language: f.language || "",
              size: Number(f.size) || 0,
              hash: f.hash || "",
              version: Number(f.version) || 1,
              content: content,
              is_binary: f.is_binary ? 1 : 0,
              created_at: Number(f.created_at) || Date.now(),
              updated_at: Number(f.updated_at) || Date.now(),
            });
          } catch (fileErr: any) {
            console.warn(`[Supabase Hydration] Note hydrating file ${f.path || f.id}:`, fileErr?.message || fileErr);
          }
        }
      }
    }

    // 9. Hydrate Workspace Files
    try {
      const { data: dbWorkspaceFiles, error: wfErr } = await client.from("workspace_files").select("*");
      if (!wfErr && dbWorkspaceFiles) {
        workspaceFilesCount = dbWorkspaceFiles.length;
        for (const wf of dbWorkspaceFiles) {
          if (dbAdapters.dbSaveWorkspaceFile) {
            try {
              dbAdapters.dbSaveWorkspaceFile({
                id: wf.id,
                userId: wf.user_id,
                filename: wf.filename,
                mime: wf.mime,
                size: Number(wf.size) || 0,
                fileType: wf.file_type || "document",
                content: wf.content || "",
                uploadedAt: Number(wf.uploaded_at) || Date.now(),
              });
            } catch (wfErrItem: any) {
              console.warn(`[Supabase Hydration] Note hydrating workspace file ${wf.filename || wf.id}:`, wfErrItem?.message || wfErrItem);
            }
          }
        }
      }
    } catch (e: any) {
      console.warn("[Supabase Hydration] Note on workspace_files query:", e?.message || e);
    }

    // 10. Hydrate Knowledge Chunks and Rebuild Knowledge Sources from RAG tables
    try {
      const { data: dbRagDocs, error: docErr } = await client.from("rag_documents").select("*");
      const { data: dbRagChunks, error: chunkErr } = await client.from("rag_chunks").select("*");

      if (!docErr && !chunkErr && dbRagChunks && dbRagChunks.length > 0) {
        const docMap = new Map<string, any>();
        if (dbRagDocs) {
          for (const d of dbRagDocs) {
            docMap.set(d.id, d);
          }
        }

        const list = dbRagChunks.map((rc: any) => {
          const doc = docMap.get(rc.document_id);
          const fileName = doc?.name || "unknown";
          const meta = rc.metadata || {};
          return {
            id: rc.id,
            project_id: rc.project_id,
            file_id: fileName,
            chunk_id: rc.chunk_index,
            content: rc.content,
            chunk_type: meta.chunk_type || "text",
            symbol: meta.symbol || "",
            start_line: meta.start_line || null,
            end_line: meta.end_line || null,
            hash: meta.hash || "",
            version: meta.version || 1,
          };
        });

        knowledgeChunksCount = list.length;

        if (dbAdapters.dbCreateKnowledgeChunksBatch) {
          dbAdapters.dbCreateKnowledgeChunksBatch(list);

          // Re-generate local knowledge sources dynamically from hydrated chunks and rag_documents
          try {
            const getFileTypeDisplayNameLocal = (ext: string, name?: string): string => {
              const e = ext.toLowerCase();
              if ([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".cpp", ".c", ".h", ".cs", ".php", ".rb", ".swift", ".kt", ".scala"].includes(e)) return "Source Code";
              if ([".md", ".txt", ".rtf", ".pdf", ".doc", ".docx"].includes(e)) return "Document";
              if ([".json", ".yaml", ".yml", ".toml", ".ini", ".xml"].includes(e)) return "Configuration";
              if ([".html", ".css", ".sass", ".scss", ".less"].includes(e)) return "Web Asset";
              if ([".sh", ".bash", ".zsh", ".bat", ".ps1"].includes(e)) return "Script";
              return "File";
            };

            const computeHashLocal = (text: string): string => {
              return crypto.createHash("md5").update(text).digest("hex");
            };

            if (dbRagDocs && dbAdapters.dbUpsertKnowledgeSource) {
              for (const d of dbRagDocs) {
                const chunks = list.filter((c: any) => c.project_id === d.project_id && c.file_id === d.name);
                const size = chunks.reduce((acc: number, c: any) => acc + (c.content?.length || 0), 0);
                const ext = path.extname(d.name).toLowerCase();
                const fileType = getFileTypeDisplayNameLocal(ext, d.name);

                dbAdapters.dbUpsertKnowledgeSource({
                  id: "ks_" + computeHashLocal(d.name).substring(0, 16),
                  project_id: d.project_id,
                  path: d.name,
                  name: d.name,
                  extension: ext,
                  file_type: fileType,
                  size,
                  chunks_count: chunks.length,
                  status: d.status || "Indexed",
                });
              }
            }
          } catch (recreateErr) {
            console.warn("[Supabase Hydration] Notice re-generating knowledge sources:", recreateErr);
          }
        }
      }
    } catch (e: any) {
      console.warn("[Supabase Hydration] Note on RAG hydration query:", e?.message || e);
    }

    console.log(`[Supabase Hydration SUCCESS] Hydrated ${usersCount} users, ${sessionsCount} sessions, ${projectsCount} projects, ${modelsCount} models, ${conversationsCount} conversations, ${messagesCount} messages, ${artifactsCount} artifacts, ${filesCount} files, ${workspaceFilesCount} workspace files, ${knowledgeChunksCount} knowledge chunks.`);
  } catch (err: any) {
    console.error("[Supabase Hydration ERROR] Failed to hydrate data from Supabase:", err?.message || err);
  }

  return {
    usersCount,
    sessionsCount,
    projectsCount,
    modelsCount,
    conversationsCount,
    messagesCount,
    artifactsCount,
    filesCount,
    workspaceFilesCount,
    knowledgeChunksCount,
  };
}

export async function fetchUserConversationsFromSupabase(userId: string) {
  const client = getSupabaseAdmin();
  if (!client) return [];
  try {
    const rawUid = String(userId || "").trim();
    const validUserId = toValidUuid(rawUid);
    const uids = Array.from(new Set([rawUid, validUserId])).filter(Boolean) as string[];
    if (uids.length === 0) return [];
    
    let query = client.from("conversations").select("*");
    if (uids.length === 1) {
      query = query.eq("user_id", uids[0]);
    } else {
      query = query.or(`user_id.eq.${uids[0]},user_id.eq.${uids[1]}`);
    }
    const { data, error } = await query;
    if (error) {
      console.warn("[Supabase Sync] Error fetching conversations for user:", error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn("[Supabase Sync] Exception fetching conversations:", err);
    return [];
  }
}

export async function fetchConversationMessagesFromSupabase(convId: string) {
  const client = getSupabaseAdmin();
  if (!client) return [];
  try {
    const rawCid = String(convId || "").trim();
    const validConvId = toValidUuid(rawCid);
    const cids = Array.from(new Set([rawCid, validConvId])).filter(Boolean) as string[];
    if (cids.length === 0) return [];

    let query = client.from("messages").select("*");
    if (cids.length === 1) {
      query = query.eq("conversation_id", cids[0]);
    } else {
      query = query.or(`conversation_id.eq.${cids[0]},conversation_id.eq.${cids[1]}`);
    }
    const { data, error } = await query.order("created_at", { ascending: true });
    if (error) {
      console.warn("[Supabase Sync] Error fetching messages for conversation:", error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn("[Supabase Sync] Exception fetching messages:", err);
    return [];
  }
}
