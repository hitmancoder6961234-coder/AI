// rag-routes.ts
// Express API Routes for Project Knowledge RAG

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  getProjectRagStatus,
  getProjectRagSettings,
  saveProjectRagSettings,
  extractDocumentText,
  chunkDocument,
  indexProjectKnowledge,
  searchProjectRag,
  deleteProjectDocument,
  getDocumentChunks,
  getFileTypeDisplayName,
  searchUserMultiDocumentRag,
} from "./rag-engine.js";
import {
  getProject,
  createProject,
  createFile,
  createKnowledgeChunksBatch,
  listKnowledgeChunks,
  upsertKnowledgeSource,
  getProjectFileByPath,
  deleteKnowledgeForProject,
  saveMessage,
} from "./db.js";
import { generateGeminiWithResilience, streamGeminiWithResilience } from "./gemini-resilience.js";
import { isSupabaseConfigured, syncRagDocumentToSupabase, syncRagChunkToSupabase, syncConversationToSupabase, syncMessageToSupabase } from "./supabase.js";
import { writeProjectFileToDisk, resolveProjectFilePath } from "./project-storage.js";
import { AgentRuntime } from "./agent-runtime.js";
import {
  FILE_TOO_LARGE_PAYLOAD,
  isFileTooLarge,
  sharedMulter,
  uploaders,
  wrapUploadMiddleware,
} from "./upload-config.js";

const upload = sharedMulter;

/** A caller may only address their own knowledge space or a project they own. */
function pidAllowed(pid: string, userId: string): boolean {
  if (pid === `knowledge_${userId}`) return true;
  const proj: any = getProject(pid);
  return Boolean(proj && String(proj.user_id || "").toLowerCase() === String(userId).toLowerCase());
}

export function registerRagRoutes(
  app: express.Application,
  resolveUser?: (req: express.Request) => any,
  resolveUserAsync?: (req: express.Request) => Promise<any>,
  resolveModel?: (modelId?: string | null, userId?: string | null) => any,
  conversations?: Map<string, any>,
  messages?: Map<string, any>,
  projects?: Map<string, any>,
  files?: Map<string, any>,
  projectAnalyses?: Map<string, any>
) {
  const getUser = async (req: express.Request) => {
    if (resolveUserAsync) {
      const u = await resolveUserAsync(req);
      if (u) return u;
    }
    if (resolveUser) {
      const u = resolveUser(req);
      if (u) return u;
    }
    return { id: "global", name: "Guest User", email: "guest@darkness.ai" };
  };

  // 1. Get Project RAG Status & Metadata
  app.get("/api/projects/:pid/rag", async (req, res) => {
    const pid = String(req.params.pid);
    try {
      const status = getProjectRagStatus(pid);
      res.json(status);
    } catch (err: any) {
      console.error(`Error fetching RAG status for ${pid}:`, err);
      res.status(err.message === "Project not found" ? 404 : 500).json({
        error: err.message || "Failed to fetch RAG status",
      });
    }
  });

  // 2. Upload Document(s) to Knowledge Base
  app.post("/api/projects/:pid/rag/upload", wrapUploadMiddleware(uploaders.documents.array("files", 20), "documents"), async (req, res) => {
    const pid = String(req.params.pid);
    const user = await getUser(req);
    let proj = getProject(pid);
    if (!proj) {
      try {
        createProject({
          id: pid,
          user_id: user.id,
          name: pid === "global" ? "Global Knowledge Base" : `Project ${pid}`,
          description: "Knowledge Base",
        });
        proj = getProject(pid);
      } catch {}
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    for (const f of files) {
      const sz = typeof f.size === "number" ? f.size : (f.buffer?.length ?? 0);
      if (isFileTooLarge(sz)) {
        return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
      }
    }

    try {
      const settings = getProjectRagSettings(pid);
      const processedDocs: any[] = [];
      const allNewChunks: any[] = [];

      for (const f of files) {
        const originalName = f.originalname;
        const ext = path.extname(originalName).toLowerCase();
        const safeName = path.basename(originalName);
        const targetPath = originalName.startsWith("docs/") || originalName.startsWith("knowledge/") 
          ? originalName 
          : `docs/${safeName}`;

        // 1. Parse content
        const parseResult = await extractDocumentText(originalName, f.buffer);
        const textContent = typeof parseResult.text === "string" 
          ? parseResult.text 
          : (parseResult.text ? String(parseResult.text) : "");

        // 2. Save in project_files
        const isBinary = [".pdf", ".docx", ".zip"].includes(ext);
        if (isBinary) {
          writeProjectFileToDisk(pid, targetPath, f.buffer);
        }
        const createdFile = createFile({
          id: "file_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9),
          project_id: pid,
          path: targetPath, // was `storage_path`, which createFile ignores: path was undefined and the insert failed (NOT NULL project_files.path), so this upload route always answered 500
          name: safeName,
          extension: ext,
          language: ext.replace(".", "") || "text",
          size: f.size,
          content: textContent,
          is_binary: isBinary,
        });

        // 3. Chunk content
        const chunks = chunkDocument(pid, targetPath, textContent, settings);
        allNewChunks.push(...chunks);

        // 4. Save knowledge source record
        const sourceId = "ks_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
        const fileType = getFileTypeDisplayName(ext, safeName);
        upsertKnowledgeSource({
          id: sourceId,
          project_id: pid,
          path: targetPath,
          name: safeName,
          extension: ext,
          file_type: fileType, // the column is file_type; `mime_type` was ignored, so the stored type was always the default "Document"
          size: f.size,
          chunks_count: chunks.length,
          status: chunks.length > 0 ? "Indexed" : "Queued",
        });

        processedDocs.push({
          id: sourceId,
          path: targetPath,
          storage_path: targetPath, // kept: older clients read this name
          name: safeName,
          extension: ext,
          fileType,
          size: f.size,
          chunksCount: chunks.length,
        });

        // 5. Cloud Sync to Supabase
        if (isSupabaseConfigured()) {
          syncRagDocumentToSupabase({
            id: sourceId,
            user_id: user.id,
            project_id: pid,
            name: safeName,
            storage_path: targetPath,
            mime_type: fileType,
            size: f.size,
            chunks_count: chunks.length,
            status: "Indexed",
          }).catch(e => console.warn("[Supabase] RAG Doc Sync:", e.message));
        }
      }

      if (allNewChunks.length > 0) {
        createKnowledgeChunksBatch(allNewChunks.map(c => ({
          id: c.id,
          project_id: c.projectId,
          file_id: c.fileId,
          chunk_id: c.chunkId,
          content: c.content,
          chunk_type: c.chunkType,
          symbol: c.symbol,
          start_line: c.startLine,
          end_line: c.endLine,
          hash: c.hash,
          version: c.version,
        })));

        if (isSupabaseConfigured()) {
          for (const c of allNewChunks) {
            // NOTE: this passes a knowledge-chunk shaped object (file_id / chunk_id / start_line ...) to the RAG-chunk mirror, which expects
            // document_id / chunk_index. Not changed because it cannot be verified without a live Supabase; see docs/IMPROVEMENT-LOG.md.
            syncRagChunkToSupabase({
              id: c.id,
              user_id: user.id,
              project_id: c.projectId,
              file_id: c.fileId,
              chunk_id: c.chunkId,
              content: c.content,
              start_line: c.startLine,
              end_line: c.endLine,
              symbol: c.symbol,
            } as any).catch(e => console.warn("[Supabase] RAG Chunk Sync:", e.message));
          }
        }
      }

      res.json({
        success: true,
        message: `Indexed ${processedDocs.length} document(s) with ${allNewChunks.length} chunks.`,
        files: processedDocs,
        totalChunks: allNewChunks.length,
      });
    } catch (err: any) {
      console.error(`Upload error for ${pid}:`, err);
      res.status(500).json({ error: err.message || "Upload processing failed" });
    }
  });

  // 3. Index All Project Files into Knowledge Base
  app.post("/api/projects/:pid/rag/index-project-files", async (req, res) => {
    const pid = String(req.params.pid);
    try {
      const result = await indexProjectKnowledge(pid);
      const updatedStatus = getProjectRagStatus(pid);
      res.json({
        success: true,
        filesIndexed: result.filesIndexed,
        chunksIndexed: result.chunksIndexed,
        status: updatedStatus,
      });
    } catch (err: any) {
      console.error(`Error indexing project files for ${pid}:`, err);
      res.status(500).json({ error: err.message || "Indexing failed" });
    }
  });

  // 4. Reindex Knowledge Base
  app.post("/api/projects/:pid/rag/reindex", async (req, res) => {
    const pid = String(req.params.pid);
    const { filePath } = req.body || {};

    try {
      if (filePath) {
        // Reindex single file
        const file = getDocumentChunks(pid, filePath);
        // Load content and rechunk
        const status = getProjectRagStatus(pid);
        return res.json({ success: true, message: `Reindexed ${filePath}`, status });
      } else {
        // Reindex entire knowledge base
        const result = await indexProjectKnowledge(pid);
        const updatedStatus = getProjectRagStatus(pid);
        return res.json({
          success: true,
          filesIndexed: result.filesIndexed,
          chunksIndexed: result.chunksIndexed,
          status: updatedStatus,
        });
      }
    } catch (err: any) {
      console.error(`Error reindexing ${pid}:`, err);
      res.status(500).json({ error: err.message || "Reindexing failed" });
    }
  });

  // 5. Delete Document from RAG
  const handleDocDelete = (req: express.Request, res: express.Response) => {
    const pid = String(req.params.pid);
    const docId = String(req.params.docId || req.query.id || req.body?.id || "").trim();
    const docPath = String(req.query.path || req.body?.path || "").trim();
    const target = docId || docPath;

    if (!target) {
      return res.status(400).json({ error: "Document ID or file path is required" });
    }

    try {
      if (docId) deleteProjectDocument(pid, docId);
      if (docPath && docPath !== docId) deleteProjectDocument(pid, docPath);
      const updatedStatus = getProjectRagStatus(pid);
      res.json({
        success: true,
        message: `Document removed from knowledge base`,
        status: updatedStatus,
      });
    } catch (err: any) {
      console.error(`Error deleting RAG doc ${target} in ${pid}:`, err);
      res.status(500).json({ error: err.message || "Delete failed" });
    }
  };

  app.delete("/api/projects/:pid/rag/documents", handleDocDelete);
  app.delete("/api/projects/:pid/rag/documents/:docId", handleDocDelete);

  // 6. Get Chunks for a specific Document
  app.get("/api/projects/:pid/rag/documents/chunks", (req, res) => {
    const pid = String(req.params.pid);
    const filePath = String(req.query.path || "").trim();
    if (!filePath) return res.status(400).json({ error: "path parameter is required" });

    try {
      const chunks = getDocumentChunks(pid, filePath);
      res.json({ file: filePath, chunks, count: chunks.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch document chunks" });
    }
  });

  // 7. Test Retrieval Search Endpoint
  app.get("/api/projects/:pid/rag/search", (req, res) => {
    const pid = String(req.params.pid);
    const q = String(req.query.q || "").trim();
    const topK = Number(req.query.topK) || undefined;
    const threshold = req.query.threshold !== undefined ? Number(req.query.threshold) : undefined;
    const strategy = String(req.query.strategy || "") || undefined;

    try {
      const results = searchProjectRag(pid, q, { topK, threshold, strategy });
      res.json(results);
    } catch (err: any) {
      console.error(`Search error for ${pid}:`, err);
      res.status(500).json({ error: err.message || "Search failed" });
    }
  });

  app.post("/api/projects/:pid/rag/search", (req, res) => {
    const pid = String(req.params.pid);
    const { query, topK, threshold, strategy } = req.body || {};
    try {
      const results = searchProjectRag(pid, String(query || ""), {
        topK: Number(topK) || undefined,
        threshold: threshold !== undefined ? Number(threshold) : undefined,
        strategy: strategy ? String(strategy) : undefined,
      });
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Search failed" });
    }
  });

  // 8. RAG Settings: Get & Save
  app.get("/api/projects/:pid/rag/settings", (req, res) => {
    const pid = String(req.params.pid);
    try {
      const settings = getProjectRagSettings(pid);
      res.json({ settings });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load RAG settings" });
    }
  });

  app.post("/api/projects/:pid/rag/settings", (req, res) => {
    const pid = String(req.params.pid);
    const { settings } = req.body || {};
    if (!settings || typeof settings !== "object") {
      return res.status(400).json({ error: "Valid settings object is required" });
    }

    try {
      const updated = saveProjectRagSettings(pid, settings);
      res.json({
        success: true,
        settings: updated,
        message: "RAG settings saved successfully. Changing chunking parameters requires reindexing the knowledge base.",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to save settings" });
    }
  });

  // 9. Test Vector Store Connection & Integrity
  app.post("/api/projects/:pid/rag/test-vector-store", (req, res) => {
    const pid = String(req.params.pid);
    const start = Date.now();
    try {
      const chunks = listKnowledgeChunks(pid);
      const latencyMs = Date.now() - start;
      const connected = chunks.length > 0;

      res.json({
        connected,
        status: connected ? "Connected" : "Not configured",
        vectorsCount: chunks.length,
        index: `project_${pid}_vectors`,
        latencyMs: Math.max(1, latencyMs),
        message: connected 
          ? `Vector index online with ${chunks.length} vectors (${latencyMs}ms)`
          : "Vector store has not yet been populated with documents.",
      });
    } catch (err: any) {
      res.status(500).json({
        connected: false,
        error: err.message || "Vector store connection test failed",
      });
    }
  });

  // 10. Workspace / Global Knowledge RAG Endpoints
  app.get("/api/knowledge/rag", async (req, res) => {
    try {
      const user = await getUser(req);
      const userKnowledgePid = `knowledge_${user.id}`;
      
      // Ensure user knowledge container exists
      if (!getProject(userKnowledgePid)) {
        try {
          createProject({
            id: userKnowledgePid,
            user_id: user.id,
            name: "My Knowledge Base",
            description: "User uploaded documents & global knowledge",
          });
        } catch {}
      }

      // Also ensure global container exists
      if (!getProject("global")) {
        try {
          createProject({
            id: "global",
            name: "Global Knowledge Base",
            description: "Workspace-wide documents & knowledge base",
          });
        } catch {}
      }

      const reqPid = String(req.query.projectId || userKnowledgePid);
      if (!pidAllowed(reqPid, user.id)) return res.status(403).json({ error: "Not your project" });
      const status = getProjectRagStatus(reqPid);
      
      // Aggregate documents from user knowledge + global
      const userStatus = getProjectRagStatus(userKnowledgePid);
      const globalStatus = getProjectRagStatus("global");
      
      const docMap = new Map<string, any>();
      for (const d of [...(userStatus.documents || []), ...(globalStatus.documents || [])]) {
        docMap.set(d.id || d.name, d);
      }

      res.json({
        ...status,
        projectId: reqPid,
        documents: Array.from(docMap.values()),
        totalDocuments: docMap.size,
        totalChunks: (userStatus.stats?.chunks || 0) + (globalStatus.stats?.chunks || 0), // the count lives in stats.chunks
        status: docMap.size > 0 ? "Ready" : "Empty",
      });
    } catch (err: any) {
      console.error("[RAG] Failed to load knowledge RAG:", err);
      res.status(500).json({ error: err.message || "Failed to load knowledge RAG" });
    }
  });

  app.post("/api/knowledge/rag/upload", wrapUploadMiddleware(uploaders.documents.array("files", 20), "documents"), async (req, res) => {
    try {
      const user = await getUser(req);
      let pid = String(req.body?.projectId || `knowledge_${user.id}`);
      if (!pidAllowed(pid, user.id)) return res.status(403).json({ error: "Not your project" });
      
      let proj = getProject(pid);
      if (!proj) {
        createProject({ 
          id: pid, 
          user_id: user.id, 
          name: pid.startsWith("knowledge_") ? "My Knowledge Base" : "Global Knowledge Base", 
          description: "Workspace Knowledge" 
        });
      }

      const reqFiles = (req.files as Express.Multer.File[]) || [];
      if (!reqFiles || reqFiles.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      for (const file of reqFiles) {
        const sz = typeof file.size === "number" ? file.size : (file.buffer?.length ?? 0);
        if (isFileTooLarge(sz)) {
          return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
        }
      }

      const settings = getProjectRagSettings(pid);
      const results: any[] = [];
      const allNewChunks: any[] = [];

      for (const file of reqFiles) {
        const cleanName = path.basename(file.originalname);
        const relativePath = `docs/${cleanName}`;
        const ext = path.extname(cleanName).toLowerCase();
        const extracted = await extractDocumentText(cleanName, file.buffer);
        const textContent = typeof extracted.text === "string" 
          ? extracted.text 
          : (extracted.text ? String(extracted.text) : "");

        const isBinary = [".pdf", ".docx", ".zip"].includes(ext);
        const fileId = "file_" + Date.now() + "_" + Math.random().toString(36).substring(2, 11);

        createFile({
          id: fileId,
          project_id: pid,
          path: relativePath,
          name: cleanName,
          extension: ext,
          language: ext.replace(".", "") || "text",
          size: file.size,
          content: textContent,
          is_binary: isBinary,
        });

        const chunks = chunkDocument(pid, relativePath, textContent, settings);
        allNewChunks.push(...chunks);

        const sourceId = "ks_" + Math.random().toString(36).substring(2, 11);
        const fileType = getFileTypeDisplayName(ext, cleanName);

        upsertKnowledgeSource({
          id: sourceId,
          project_id: pid,
          path: relativePath,
          name: cleanName,
          extension: ext,
          file_type: fileType,
          size: file.size,
          chunks_count: chunks.length,
          status: "Indexed",
        });

        results.push({
          id: sourceId,
          filename: cleanName,
          name: cleanName,
          path: relativePath,
          size: file.size,
          chunksCount: chunks.length,
          fileType,
          status: "Indexed",
        });

        // Supabase Cloud Sync
        if (isSupabaseConfigured()) {
          syncRagDocumentToSupabase({
            id: sourceId,
            user_id: user.id,
            project_id: pid,
            name: cleanName,
            mime_type: fileType,
            size: file.size,
            chunks_count: chunks.length,
            status: "Indexed",
          }).catch(e => console.warn("[Supabase] Knowledge RAG Doc Sync:", e.message));
        }
      }

      if (allNewChunks.length > 0) {
        createKnowledgeChunksBatch(allNewChunks.map(c => ({
          id: c.id,
          project_id: c.projectId,
          file_id: c.fileId,
          chunk_id: c.chunkId,
          content: c.content,
          chunk_type: c.chunkType,
          symbol: c.symbol,
          start_line: c.startLine,
          end_line: c.endLine,
          hash: c.hash,
          version: c.version,
        })));

        if (isSupabaseConfigured()) {
          for (const c of allNewChunks) {
            // NOTE: this passes a knowledge-chunk shaped object (file_id / chunk_id / start_line ...) to the RAG-chunk mirror, which expects
            // document_id / chunk_index. Not changed because it cannot be verified without a live Supabase; see docs/IMPROVEMENT-LOG.md.
            syncRagChunkToSupabase({
              id: c.id,
              user_id: user.id,
              project_id: c.projectId,
              file_id: c.fileId,
              chunk_id: c.chunkId,
              content: c.content,
              start_line: c.startLine,
              end_line: c.endLine,
              symbol: c.symbol,
            } as any).catch(e => console.warn("[Supabase] Knowledge RAG Chunk Sync:", e.message));
          }
        }
      }

      res.json({
        success: true,
        message: `Successfully indexed ${results.length} document(s) with ${allNewChunks.length} chunks.`,
        files: results,
        totalChunks: allNewChunks.length,
      });
    } catch (err: any) {
      console.error("Workspace RAG upload failed:", err);
      res.status(500).json({ error: err.message || "Failed to process documents" });
    }
  });

  app.post("/api/knowledge/rag/search", async (req, res) => {
    const { query, topK, threshold } = req.body || {};
    const user = await getUser(req);
    try {
      const results = searchUserMultiDocumentRag(user.id, String(query || ""), {
        maxTotalChunks: Math.min(Math.max(Number(topK) || 8, 1), 50), // the option is maxTotalChunks; `topK` was ignored
        threshold: threshold !== undefined ? Number(threshold) : 0.38,
      });
      res.json(results);
    } catch (err: any) {
      console.error("[RAG Search] error:", err);
      res.status(500).json({ error: err.message || "Search failed" });
    }
  });

  app.delete("/api/knowledge/rag/documents", async (req, res) => {
    const { id, path: docPath, projectId } = req.body || {};
    const user = await getUser(req);
    const pid = String(projectId || `knowledge_${user.id}`);
    try {
      deleteProjectDocument(pid, id || docPath);
      res.json({ success: true, message: "Document deleted" });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete document" });
    }
  });

  app.delete("/api/knowledge/rag/documents/clear-all", async (req, res) => {
    const user = await getUser(req);
    const pid = String(req.body?.projectId || `knowledge_${user.id}`);
    if (!pidAllowed(pid, user.id)) return res.status(403).json({ error: "Not your project" });
    try {
      // ONLY this knowledge space / project. This handler used to run `DELETE FROM knowledge_chunks` and `DELETE FROM knowledge_sources` with no
      // WHERE clause (and a delete-everything on the Supabase mirror), so any signed-in user could erase every user's knowledge base.
      // deleteKnowledgeForProject is scoped by project id (and removes the matching mirror rows).
      deleteKnowledgeForProject(pid);
      res.json({ success: true, message: "All documents deleted successfully" });
    } catch (err: any) {
      console.error("[RAG Delete All] error:", err);
      res.status(500).json({ error: err.message || "Failed to delete all documents" });
    }
  });

  app.post("/api/knowledge/rag/reindex", async (req, res) => {
    const user = await getUser(req);
    const pid = String(req.body?.projectId || `knowledge_${user.id}`);
    if (!pidAllowed(pid, user.id)) return res.status(403).json({ error: "Not your project" });
    const docPath = req.body?.docPath || req.body?.path;
    try {
      let filesToProcess;
      if (docPath) {
        // Find the file to reindex
        // getWorkspaceFile(id) takes ONE argument (a workspace file id), so passing (projectId, path) never found anything and every
        // single-document reindex answered 404. The project's file is looked up by path.
        const file = getProjectFileByPath(pid, String(docPath));
        if (file) {
          let content = file.content;
          if (file.is_binary) {
             const fullPath = resolveProjectFilePath(pid, file.path);
             if (fs.existsSync(fullPath)) {
                content = "BINARY_ON_DISK:" + fullPath;
             }
          }
          filesToProcess = [{ path: file.path, content }];
        } else {
          return res.status(404).json({ error: "Document not found" });
        }
      }
      const result = await indexProjectKnowledge(pid, filesToProcess);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Reindexing failed" });
    }
  });

  // 11. Multi-Document Intelligent Knowledge Q&A (Natural routing, auto document synthesis, dynamic model support)
  app.post("/api/knowledge/rag/ask", async (req, res) => {
    const { query, conversationHistory, model_id } = req.body || {};
    const q = String(query || "").trim();
    if (!q) return res.status(400).json({ error: "Query is required" });

    try {
      const user = await getUser(req);

      // Setup SSE Stream
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const sendSSE = (data: any) => {
        try { res.write("data: " + JSON.stringify(data) + "\n\n"); } catch {}
      };

      const cid = req.body?.conversation_id || req.body?.cid || ("knowledge_rag_chat_" + user.id);

      // Save user message to knowledge RAG conversation history
      if (q) {
        const userMsgId = crypto.randomUUID();
        const newUserMsg = {
          id: userMsgId,
          conversation_id: cid,
          role: "user" as const,
          content: q,
          model_id: model_id || user.active_model_id || "",
          created_at: Date.now(),
        };
        if (messages) {
          messages.set(userMsgId, newUserMsg);
        }
        try {
          saveMessage(newUserMsg, undefined, undefined, undefined, undefined, true);
        } catch {}
      }

      await AgentRuntime.execute({
        userId: user.id,
        conversationId: cid,
        projectId: null,
        knowledgeContextId: `knowledge_${user.id}`,
        message: q,
        history: conversationHistory,
        attachments: req.body?.attachments,
        fileIds: req.body?.file_ids,
        modelId: model_id || undefined,
        user,
        sendSSE,
        conversations,
        messages,
        projects,
        files,
        projectAnalyses,
        resolveModelConfig: resolveModel,
      });

    } catch (err: any) {
      console.error("[RAG Ask] Error:", err);
      try { res.write(`data: ${JSON.stringify({ error: { message: err.message || "Failed to generate answer" } })}\n\n`); } catch {}
    } finally {
      res.end();
    }
  });
}
