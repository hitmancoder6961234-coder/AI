import express from "express";
import path from "path";
import { looksBinary } from "./upload-validation.js";
import type { FileItem } from "./server.js";
import fs from "fs";
import os from "os";
import multer from "multer";
import AdmZip from "adm-zip";
import mammoth from "mammoth";
import "@google/genai";
import { generateGeminiWithResilience } from "./gemini-resilience.js";
import {
  extractZipSecurely,
  analyzeProject,
  ProjectAnalysis,
  ExtractedFile,
} from "./project-analyzer.js";
import {
  indexProject,
  updateFileKnowledge,
  deleteFileKnowledge,
  searchKnowledge,
} from "./knowledge-engine.js";
import { analyzeFileDiagnostics } from "./project-diagnostics.js";
import { extractDocumentText } from "./rag-engine.js";
import { storageManager } from "./storage-manager.js";
import { acceptChunk, discardChunks } from "./upload-chunks.js";
import {
  MAX_UPLOAD_SIZE_BYTES,
  FILE_TOO_LARGE_PAYLOAD,
  isFileTooLarge,
  sharedMulter,
  uploaders,
  wrapUploadMiddleware,
} from "./upload-config.js";
import {
  createProject as dbCreateProject,
  getProject as dbGetProject,
  updateProject as dbUpdateProject,
  createFile as dbCreateFile,
  createFilesBatch as dbCreateFilesBatch,
  getProjectFileByPath as dbGetProjectFileByPath,
  listFiles as dbListFiles,
  updateFileByPath as dbUpdateFileByPath,
  deleteProjectFileByPath as dbDeleteProjectFileByPath,
  renameProjectFolderFiles as dbRenameProjectFolderFiles,
  deleteProjectFolderFiles as dbDeleteProjectFolderFiles,
  saveArchitecture as dbSaveArchitecture,
  saveDiagnostics as dbSaveDiagnostics,
  saveProjectAnalysis as dbSaveProjectAnalysis,
  getProjectAnalysis as dbGetProjectAnalysis,
  listKnowledgeChunks as dbListKnowledgeChunks,
  saveWorkspaceFile as dbSaveWorkspaceFile,
  getWorkspaceFile as dbGetWorkspaceFile,
  listWorkspaceFiles as dbListWorkspaceFiles,
  deleteWorkspaceFile as dbDeleteWorkspaceFile,
  parseMetadataSafely,
  countProjectFiles,
} from "./db.js";
import { syncProjectToSupabase, isSupabaseConfigured } from "./supabase.js";
import {
  getProjectStorageDir,
  sanitizeProjectPath,
  resolveProjectFilePath,
  writeProjectFileToDisk,
  writeProjectFilesBatchToDisk,
  readProjectFileFromDisk,
  deleteProjectFileFromDisk,
  renameProjectFileOnDisk,
  createProjectFolderOnDisk,
  renameProjectFolderOnDisk,
  deleteProjectFolderOnDisk,
  listProjectDiskFiles,
} from "./project-storage.js";

const upload = sharedMulter;

export function getFileCategory(ext: string, name: string): string {
  const lowerExt = (ext || "").toLowerCase();
  const lowerName = (name || "").toLowerCase();

  if (lowerName.startsWith("readme") || [".md", ".markdown", ".txt", ".rtf", ".pdf", ".doc", ".docx", ".ppt", ".pptx"].includes(lowerExt)) {
    return "doc";
  }
  if ([".js", ".jsx", ".ts", ".tsx", ".py", ".ipynb", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".swift", ".kt", ".sh", ".bash", ".sql", ".html", ".vue", ".svelte"].includes(lowerExt)) {
    return "code";
  }
  if ([".css", ".scss", ".sass", ".less"].includes(lowerExt)) {
    return "style";
  }
  if ([".json", ".yaml", ".yml", ".xml", ".csv", ".tsv", ".graphql", ".gql", ".xlsx", ".xls"].includes(lowerExt)) {
    return "data";
  }
  if ([".env", ".gitignore", ".editorconfig", ".prettierrc", ".eslintrc", ".dockerignore"].includes(lowerExt) || lowerName.includes("dockerfile") || lowerName.includes("config") || lowerName.includes("package.json")) {
    return "config";
  }
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp"].includes(lowerExt)) {
    return "image";
  }
  return "other";
}

export function detectFileLanguage(ext: string, name: string): string {
  const lowerExt = (ext || "").toLowerCase();
  const lowerName = (name || "").toLowerCase();

  if (lowerName.startsWith("readme")) return "markdown";

  const langMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".py": "python",
    ".ipynb": "jupyter",
    ".json": "json",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".sass": "sass",
    ".less": "less",
    ".md": "markdown",
    ".markdown": "markdown",
    ".sql": "sql",
    ".sh": "bash",
    ".bash": "bash",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".xml": "xml",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
    ".vue": "vue",
    ".svelte": "svelte",
    ".rb": "ruby",
    ".pdf": "pdf",
    ".docx": "word",
    ".doc": "word",
    ".xlsx": "excel",
    ".xls": "excel",
    ".pptx": "powerpoint",
    ".ppt": "powerpoint",
  };

  if (langMap[lowerExt]) return langMap[lowerExt];
  if (lowerName === "dockerfile") return "dockerfile";
  if (lowerName.startsWith(".env")) return "bash";
  return "text";
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  size?: number;
  extension?: string;
  lineCount?: number;
  category?: string;
  children?: TreeNode[];
}

export function buildFileTree(files: Array<{ path: string; size: number; content?: string; is_binary?: boolean | number }>): TreeNode[] {
  const root: { [key: string]: any } = {};

  for (const f of files) {
    const cleanPath = sanitizeProjectPath(f.path);
    if (!cleanPath) continue;

    const parts = cleanPath.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const subPath = parts.slice(0, i + 1).join("/");

      if (!current[part]) {
        if (isFile) {
          const ext = path.extname(part);
          const lines = f.is_binary ? 0 : (f.content ? f.content.split(/\r?\n/).length : 0);
          current[part] = {
            name: part,
            path: cleanPath,
            type: "file",
            size: f.size || 0,
            extension: ext,
            lineCount: lines,
            category: getFileCategory(ext, part),
          };
        } else {
          current[part] = {
            name: part,
            path: subPath,
            type: "folder",
            children: {},
          };
        }
      }
      if (!isFile) {
        current = current[part].children;
      }
    }
  }

  function convertTree(nodeMap: { [key: string]: any }): TreeNode[] {
    const list: TreeNode[] = [];
    for (const key of Object.keys(nodeMap)) {
      const node = nodeMap[key];
      if (node.type === "folder") {
        list.push({
          name: node.name,
          path: node.path,
          type: "folder",
          children: convertTree(node.children),
        });
      } else {
        list.push(node);
      }
    }
    list.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === "folder" ? -1 : 1;
    });
    return list;
  }

  return convertTree(root);
}

export function registerProjectAndFileRoutes(
  app: express.Express,
  projects: Map<string, any>,
  files: Map<string, any>,
  projectAnalyses: Map<string, ProjectAnalysis>,
  resolveUser: (req: express.Request) => any,
  initialUser: any
) {
  // -------------------------------------------------------------------------
  // Knowledge & General Files Management
  // -------------------------------------------------------------------------
  app.get("/api/files/shared", (req, res) => {
    const user = resolveUser(req) || initialUser;
    try {
      const wsFiles = dbListWorkspaceFiles(user?.id);
      for (const wf of wsFiles) {
        if (!files.has(wf.id)) {
          files.set(wf.id, {
            id: wf.id,
            user_id: wf.user_id,
            conversation_id: null,
            project_id: null,
            filename: wf.filename,
            mime: wf.mime,
            size: wf.size,
            file_type: "file",
            content: wf.content,
            uploaded_at: Math.floor(wf.uploaded_at / 1000),
          });
        }
      }
    } catch (e) {
      console.warn("Could not sync db workspace files:", e);
    }

    const shared = Array.from(files.values()).filter(
      (f) => (!f.project_id && !f.conversation_id) || f.user_id === user?.id
    );
    res.json({ files: shared, total: shared.length, success: true });
  });

  app.post("/api/files/shared", (req, res) => {
    const user = resolveUser(req) || initialUser;
    const { filename, content, mime = "text/plain" } = req.body || {};
    if (!filename) {
      return res.status(400).json({ error: "Filename is required" });
    }
    const byteLen = content ? Buffer.byteLength(content, "utf8") : 0;
    if (isFileTooLarge(byteLen)) {
      return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
    }
    const fid = "file_" + Math.random().toString(36).substring(2, 9);
    const fileItem: FileItem = {
      id: fid,
      user_id: user.id,
      conversation_id: null,
      project_id: null,
      filename,
      name: filename,
      mime,
      size: content ? Buffer.byteLength(content, "utf8") : 0,
      file_type: "file",
      content: content || "",
      uploaded_at: Math.floor(Date.now() / 1000),
      ok: true,
    };
    files.set(fid, fileItem);
    try {
      dbSaveWorkspaceFile({
        id: fid,
        user_id: user.id,
        filename,
        mime,
        size: fileItem.size,
        file_type: "file",
        content: content || "",
        uploaded_at: Math.floor(Date.now() / 1000),
      });
    } catch (e) {
      console.error("Error saving workspace file to db:", e);
    }
    res.status(201).json({ success: true, file: fileItem, id: fid });
  });

  app.get("/api/files", (req, res) => {
    const user = resolveUser(req) || initialUser;
    const userFiles = Array.from(files.values()).filter(
      (f) => f.user_id === user.id || !f.project_id
    );
    res.json(userFiles);
  });

  app.post("/api/files/upload", wrapUploadMiddleware(uploaders.folder.any(), "folder"), async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const user = resolveUser(req) || initialUser;
      const uploadedFiles: any[] = [];
      const reqFiles = (req.files as Express.Multer.File[]) || [];
      if (req.file) reqFiles.push(req.file);

      if (reqFiles.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      for (const f of reqFiles) {
        const sz = typeof f.size === "number" ? f.size : (f.buffer?.length ?? 0);
        if (isFileTooLarge(sz)) {
          return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
        }
      }

      const incomingBytes = reqFiles.reduce((sum, f) => sum + (f.size || 0), 0);
      const quota = storageManager.checkQuota(incomingBytes);
      if (!quota.allowed) {
        return res.status(400).json({ error: quota.message || "Darkness storage limit reached. Free up space or increase the storage limit." });
      }

      for (const f of reqFiles) {
        const fid = "file_" + Math.random().toString(36).substr(2, 9);
        const isImg = /image/i.test(f.mimetype) || /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(f.originalname);
        const isPdf = /pdf/i.test(f.mimetype) || /\.pdf$/i.test(f.originalname);
        const isDoc = /\.(docx?|pptx?|xlsx?|odt|odp|ods|rtf|epub|html?|csv|tsv|json|jsonl|xml|yaml|yml|toml|ini|log|srt|vtt|md|markdown|rst|tex|txt)$/i.test(f.originalname);
        const isArchive = /zip|tar|gz|octet-stream/i.test(f.mimetype) && /\.zip$/i.test(f.originalname);

        let textContent: string | null = null;
        let fileType = "code";

        if (isImg) {
          fileType = "image";
          textContent = null;
        } else if (isArchive) {
          fileType = "archive";
          try {
            const docRes = await extractDocumentText(f.originalname, f.buffer);
            textContent = docRes.text || null;
          } catch {
            textContent = null;
          }
        } else if (isPdf || isDoc) {
          fileType = isPdf ? "pdf" : "document";
          try {
            const docRes = await extractDocumentText(f.originalname, f.buffer);
            textContent = docRes.text || "";
          } catch (err) {
            console.warn("Failed extracting document text:", err);
            textContent = f.buffer.toString("utf-8").replace(/[^\x20-\x7E\n\r\t]/g, " ").trim();
          }
        } else {
          fileType = "code";
          try {
            const docRes = await extractDocumentText(f.originalname, f.buffer);
            textContent = docRes.text || f.buffer.toString("utf-8");
          } catch {
            textContent = f.buffer.toString("utf-8");
          }
        }

        const fileItem = {
          id: fid,
          user_id: user.id,
          conversation_id: (req.body && req.body.conversation_id) || null,
          project_id: (req.body && req.body.project_id) || null,
          filename: f.originalname,
          name: f.originalname,
          mime: f.mimetype,
          size: f.size,
          file_type: fileType,
          content: textContent,
          buffer: isImg ? f.buffer : undefined,
          data: isImg ? `data:${f.mimetype};base64,${f.buffer.toString("base64")}` : undefined,
          uploaded_at: Math.floor(Date.now() / 1000),
          ok: true,
        };

        files.set(fid, fileItem);
        try {
          dbSaveWorkspaceFile({
            id: fid,
            user_id: user.id,
            filename: f.originalname,
            mime: f.mimetype,
            size: f.size,
            file_type: fileType,
            content: textContent,
            uploaded_at: Math.floor(Date.now() / 1000),
          });
        } catch (e) {
          console.error("Error saving workspace file to db:", e);
        }
        uploadedFiles.push(fileItem);
      }

      return res.json({ success: true, files: uploadedFiles, file: uploadedFiles[0] });
    } catch (err: any) {
      console.error("File upload route error:", err);
      return res.status(500).json({ error: err.message || "Failed to upload file" });
    }
  });

  app.get("/api/files/:id/content", (req, res) => {
    const fid = req.params.id;
    const file = files.get(fid) || dbGetWorkspaceFile(fid);
    if (!file) return res.status(404).json({ error: "File not found" });
    res.json({
      content: file.content || "",
      filename: file.filename,
      mime: file.mime || "text/plain",
      size: file.size,
    });
  });

  app.get("/api/files/:id/raw", (req, res) => {
    const fid = req.params.id;
    const file = files.get(fid) || dbGetWorkspaceFile(fid);
    if (!file) return res.status(404).send("File not found");

    // The file is the user's own upload, but a page that can run script (HTML, SVG, XML) must never be rendered from the app's origin: it is
    // sent as a download. The file name cannot break out of the header (quotes, line breaks and non-ASCII are replaced).
    const mime = String(file.mime || "application/octet-stream");
    const risky = /html|svg|xml|javascript|ecmascript/i.test(mime) || /\.(html?|svg|xml|xhtml|js|mjs)$/i.test(String(file.filename || ""));
    const safeName = String(file.filename || "file").replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120) || "file";
    res.setHeader("Content-Type", risky ? "application/octet-stream" : mime);
    res.setHeader("Content-Disposition", `${risky ? "attachment" : "inline"}; filename="${safeName}"`);
    if (file.buffer && Buffer.isBuffer(file.buffer)) {
      res.send(file.buffer);
    } else if (file.data && typeof file.data === "string" && file.data.startsWith("data:")) {
      const base64Data = file.data.split(",")[1];
      res.send(Buffer.from(base64Data, "base64"));
    } else {
      res.send(file.content || "");
    }
  });

  app.delete("/api/files/:id", (req, res) => {
    const fid = req.params.id;
    files.delete(fid);
    try {
      dbDeleteWorkspaceFile(fid);
    } catch (e) {
      console.error(e);
    }
    res.json({ success: true, id: fid });
  });

  // -------------------------------------------------------------------------
  // Project Uploads (ZIP & Multiple Files / Folders)
  // -------------------------------------------------------------------------
  app.post("/api/projects/upload-zip/chunk", wrapUploadMiddleware(uploaders.archive.any(), "archive"), async (req, res) => {
    const user = resolveUser(req) || initialUser;
    const reqFiles = (req.files as Express.Multer.File[]) || [];
    const chunkFile = req.file || reqFiles.find((f) => f.fieldname === "file") || reqFiles[0];

    if (!chunkFile) {
      return res.status(400).json({ error: "No chunk file uploaded" });
    }

    const { chunkIndex, totalChunks, uploadId, projectId, name } = req.body || {};
    if (chunkIndex === undefined || totalChunks === undefined || !uploadId) {
      return res.status(400).json({ error: "Missing chunk metadata (chunkIndex, totalChunks, uploadId)" });
    }

    const cIdx = Number(chunkIndex);
    const totChunks = Number(totalChunks);
    const upId = String(uploadId);

    const cSize = chunkFile.size || 0;
    if (isFileTooLarge(cSize)) {
      await discardChunks(user.id, upId);
      return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
    }

    try {
      // 1. Store this chunk in the caller's OWN upload folder (strictly validated id, bounded chunk numbers, size checked as
      //    parts arrive). When the last chunk arrives the parts are joined by streaming and the result must be a real ZIP.
      const chunk = await acceptChunk({ userKey: user.id, uploadId: upId, index: cIdx, total: totChunks, tmpPath: chunkFile.path, maxBytes: MAX_UPLOAD_SIZE_BYTES });
      if (chunk.status === "error") {
        return res.status(chunk.http).json(chunk.http === 413 ? FILE_TOO_LARGE_PAYLOAD : { error: chunk.code, message: chunk.message });
      }
      if (chunk.status === "uploading") {
        // More chunks remaining
        return res.json({ success: true, status: "uploading", chunkIndex: cIdx });
      }

      // 2. Read the joined archive (the extractor needs it whole) and remove the upload folder straight away
      let zipBuffer: Buffer;
      try {
        zipBuffer = await fs.promises.readFile(chunk.zipPath);
      } finally {
        await discardChunks(user.id, upId);
      }

      if (isFileTooLarge(zipBuffer.length)) {
        return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
      }

      // 5. Extract files from the complete ZIP buffer securely
      const { files: extractedFiles, error: zipError } = extractZipSecurely(zipBuffer);
      if (zipError && (zipError.includes("FILE_TOO_LARGE") || zipError.includes("100 MB"))) {
        return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
      }
      if (zipError || !extractedFiles || extractedFiles.length === 0) {
        return res.status(400).json({ error: zipError || "Failed to extract files from ZIP archive." });
      }
      if (extractedFiles.some((f) => isFileTooLarge(f.size || f.buffer?.length))) {
        return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
      }

      // 6. Project creation or merge handling
      let pid = projectId;
      let pItem: any;

      if (pid && projects.has(pid)) {
        pItem = projects.get(pid);
      } else {
        pid = "proj_" + Math.random().toString(36).substr(2, 9);
        const originalName = chunkFile.originalname || "project.zip";
        const projName = name || originalName.replace(/\.zip$/i, "") || "Imported Project";
        pItem = {
          id: pid,
          user_id: user.id,
          name: projName,
          description: "",
          project_type: "other",
          primary_language: "text",
          file_count: extractedFiles.length,
          created_at: Date.now(),
          updated_at: Date.now(),
          status: "ready",
          source: "upload",
        };
        projects.set(pid, pItem);
        dbCreateProject({
          id: pid,
          user_id: user.id,
          name: projName,
          created_at: pItem.created_at,
          updated_at: pItem.updated_at,
          metadata: JSON.stringify({ user_id: user.id, file_count: extractedFiles.length }),
        });
        if (isSupabaseConfigured()) {
          syncProjectToSupabase(pItem).catch(() => {});
        }
        createProjectFolderOnDisk(pid, "/");
      }

      // Batch write files to disk and DB
      const diskBatch: Array<{ relativePath: string; content: string | Buffer }> = [];
      const dbFilesBatch: any[] = [];
      const now = Date.now();

      for (const ef of extractedFiles) {
        const cleanPath = sanitizeProjectPath(ef.path);
        if (!cleanPath) continue;

        diskBatch.push({
          relativePath: cleanPath,
          content: ef.buffer || ef.content,
        });

        const fid = "pf_" + Math.random().toString(36).substr(2, 9);
        const ext = path.extname(cleanPath);
        const nameVal = path.basename(cleanPath);

        dbFilesBatch.push({
          id: fid,
          project_id: pid,
          path: cleanPath,
          name: nameVal,
          extension: ext,
          language: detectFileLanguage(ext, nameVal),
          size: ef.size,
          is_binary: ef.isBinary ? 1 : 0,
          content: ef.content,
          created_at: now,
          updated_at: now,
        });

        files.set(fid, {
          id: fid,
          user_id: user.id,
          conversation_id: null,
          project_id: pid,
          filename: cleanPath,
          mime: ef.isBinary ? "application/octet-stream" : "text/plain",
          size: ef.size,
          file_type: ef.isBinary ? "binary" : "code",
          content: ef.content,
          uploaded_at: Math.floor(now / 1000),
        });
      }

      writeProjectFilesBatchToDisk(pid, diskBatch);
      dbCreateFilesBatch(dbFilesBatch);

      // Run Analysis & Knowledge Indexing
      const analysis = analyzeProject(pItem.name, pid, extractedFiles);
      projectAnalyses.set(pid, analysis);
      try {
        dbSaveProjectAnalysis(pid, analysis);
        dbSaveArchitecture(pid, analysis.architecture.nodes, analysis.architecture.edges);
        dbSaveDiagnostics(pid, (analysis.securityAnalysis?.findings || []).map(f => ({
          file_id: f.file,
          rule_id: f.category,
          severity: f.severity === "CONFIRMED" ? "error" : "warning", // findings carry CONFIRMED / POTENTIAL RISK / NEEDS MANUAL VERIFICATION (never "high"), and have `category`, not `type`
          message: f.description,
          line_number: f.line || 1,
        } as any)));
      } catch (e) {
        console.error("Analysis save error in chunked upload:", e);
      }

      // Background knowledge indexing
      setImmediate(() => {
        try {
          indexProject(pid, pItem.name, extractedFiles, analysis);
        } catch (idxErr) {
          console.error("Background indexing error in chunked upload:", idxErr);
        }
      });

      // Update project metadata
      pItem.project_type = analysis.projectType;
      pItem.primary_language = analysis.primaryLanguage;
      pItem.file_count = extractedFiles.length;
      pItem.updated_at = Date.now();
      projects.set(pid, pItem);
      try {
        dbUpdateProject(pid, {
          name: pItem.name,
          updated_at: pItem.updated_at,
          metadata: {
            user_id: user.id,
            file_count: extractedFiles.length,
            project_type: analysis.projectType,
            primary_language: analysis.primaryLanguage,
            source: pItem.source || "upload",
          },
        });
      } catch (e) {
        console.error("Metadata update error in chunked upload:", e);
      }

      return res.json({
        success: true,
        status: "completed",
        filesCount: extractedFiles.length,
        project: pItem,
        analysis,
      });

    } catch (err: any) {
      console.error("Chunk upload error:", err);
      return res.status(500).json({ error: err.message || "Failed to process ZIP chunk" });
    }
  });

  app.post("/api/projects/upload-zip", wrapUploadMiddleware(uploaders.archive.any(), "archive"), async (req, res) => {
    const user = resolveUser(req) || initialUser;
    const reqFiles = (req.files as Express.Multer.File[]) || [];
    const zipFile = req.file || reqFiles.find((f) => f.fieldname === "file") || reqFiles[0];
    if (!zipFile) {
      return res.status(400).json({ error: "No zip file uploaded" });
    }

    const incomingBytes = zipFile.size || zipFile.buffer?.length || 0;
    if (isFileTooLarge(incomingBytes)) {
      return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
    }

    const quota = storageManager.checkQuota(incomingBytes);
    if (!quota.allowed) {
      return res.status(400).json({ error: quota.message || "Darkness storage limit reached. Free up space or increase the storage limit." });
    }

    try {
      const { files: extractedFiles, error: zipError } = extractZipSecurely(zipFile.buffer);
      if (zipError && (zipError.includes("FILE_TOO_LARGE") || zipError.includes("100 MB"))) {
        return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
      }
      if (zipError || !extractedFiles || extractedFiles.length === 0) {
        return res.status(400).json({ error: zipError || "Failed to extract files from ZIP archive." });
      }
      if (extractedFiles.some((f) => isFileTooLarge(f.size || f.buffer?.length))) {
        return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
      }

      let projectId = req.body?.projectId;
      if (projectId && projects.has(projectId) && String((projects.get(projectId) as any)?.user_id || "").toLowerCase() !== String(user.id).toLowerCase()) {
        return res.status(403).json({ error: "Not your project" });
      }
      let pItem: any;

      if (projectId && projects.has(projectId)) {
        pItem = projects.get(projectId);
      } else {
        projectId = "proj_" + Math.random().toString(36).substr(2, 9);
        const originalName = zipFile.originalname || "project.zip";
        const projName = req.body?.name || originalName.replace(/\.zip$/i, "") || "Imported Project";
        pItem = {
          id: projectId,
          user_id: user.id,
          name: projName,
          description: "",
          project_type: "other",
          primary_language: "text",
          file_count: extractedFiles.length,
          created_at: Date.now(),
          updated_at: Date.now(),
          status: "ready",
          source: "upload",
        };
        projects.set(projectId, pItem);
        dbCreateProject({
          id: projectId,
          user_id: user.id,
          name: projName,
          created_at: pItem.created_at,
          updated_at: pItem.updated_at,
          metadata: JSON.stringify({ user_id: user.id, file_count: extractedFiles.length }),
        });
        if (isSupabaseConfigured()) {
          syncProjectToSupabase(pItem).catch(() => {});
        }
        createProjectFolderOnDisk(projectId, "/");
      }

      // Batch write files to disk and DB
      const diskBatch: Array<{ relativePath: string; content: string | Buffer }> = [];
      const dbFilesBatch: any[] = [];
      const now = Date.now();

      for (const ef of extractedFiles) {
        const cleanPath = sanitizeProjectPath(ef.path);
        if (!cleanPath) continue;

        diskBatch.push({
          relativePath: cleanPath,
          content: ef.buffer || ef.content,
        });

        const fid = "pf_" + Math.random().toString(36).substr(2, 9);
        const ext = path.extname(cleanPath);
        const name = path.basename(cleanPath);

        dbFilesBatch.push({
          id: fid,
          project_id: projectId,
          path: cleanPath,
          name,
          extension: ext,
          language: detectFileLanguage(ext, name),
          size: ef.size,
          is_binary: ef.isBinary ? 1 : 0,
          content: ef.content,
          created_at: now,
          updated_at: now,
        });

        files.set(fid, {
          id: fid,
          user_id: user.id,
          conversation_id: null,
          project_id: projectId,
          filename: cleanPath,
          mime: ef.isBinary ? "application/octet-stream" : "text/plain",
          size: ef.size,
          file_type: ef.isBinary ? "binary" : "code",
          content: ef.content,
          uploaded_at: Math.floor(now / 1000),
        });
      }

      writeProjectFilesBatchToDisk(projectId, diskBatch);
      dbCreateFilesBatch(dbFilesBatch);

      // Run Analysis & Knowledge Indexing
      const analysis = analyzeProject(pItem.name, projectId, extractedFiles);
      projectAnalyses.set(projectId, analysis);
      try {
        dbSaveProjectAnalysis(projectId, analysis);
        dbSaveArchitecture(projectId, analysis.architecture.nodes, analysis.architecture.edges);
        dbSaveDiagnostics(projectId, (analysis.securityAnalysis?.findings || []).map(f => ({
          file_id: f.file,
          rule_id: f.category,
          severity: f.severity === "CONFIRMED" ? "error" : "warning", // findings carry CONFIRMED / POTENTIAL RISK / NEEDS MANUAL VERIFICATION (never "high"), and have `category`, not `type`
          message: f.description,
          line_number: f.line || 1,
        } as any)));
      } catch (e) {
        console.error("Analysis save error:", e);
      }

      // Background knowledge indexing so upload returns immediately to the client
      setImmediate(() => {
        try {
          indexProject(projectId, pItem.name, extractedFiles, analysis);
        } catch (idxErr) {
          console.error("Background indexing error:", idxErr);
        }
      });

      // Update project metadata
      pItem.project_type = analysis.projectType;
      pItem.primary_language = analysis.primaryLanguage;
      pItem.file_count = extractedFiles.length;
      pItem.updated_at = Date.now();
      projects.set(projectId, pItem);
      try {
        dbUpdateProject(projectId, {
          name: pItem.name,
          updated_at: pItem.updated_at,
          metadata: {
            user_id: user.id,
            file_count: extractedFiles.length,
            project_type: analysis.projectType,
            primary_language: analysis.primaryLanguage,
            source: pItem.source || "upload",
          },
        });
      } catch (e) {
        console.error("Failed to update project metadata in DB:", e);
      }

      return res.json({
        success: true,
        project: pItem,
        analysis,
        filesCount: extractedFiles.length,
      });
    } catch (err: any) {
      console.error("ZIP upload handling error:", err);
      return res.status(500).json({ error: err.message || "Failed to process ZIP upload" });
    }
  });

  app.post("/api/projects/upload-files", wrapUploadMiddleware(uploaders.folder.array("files"), "folder"), async (req, res) => {
    const user = resolveUser(req) || initialUser;
    let reqFiles = (req.files as Express.Multer.File[]) || [];

    // Support JSON uploads with { files: [{ path, content }] }
    if (reqFiles.length === 0 && req.body) {
      const rawFilesList = Array.isArray(req.body.files) ? req.body.files : (Array.isArray(req.body) ? req.body : null);
      if (rawFilesList && rawFilesList.length > 0) {
        reqFiles = rawFilesList.map((bf: any) => {
          const content = typeof bf.content === "string" ? bf.content : (bf.data || "");
          const buf = Buffer.from(content, "utf-8");
          const fName = bf.name || bf.path || "file.txt";
          return {
            fieldname: "files",
            originalname: fName,
            encoding: "7bit",
            mimetype: bf.mime || "text/plain",
            buffer: buf,
            size: buf.length,
          } as Express.Multer.File;
        });
        if (!req.body.paths) {
          req.body.paths = rawFilesList.map((bf: any) => bf.path || bf.name || "file.txt");
        }
      }
    }

    if (reqFiles.length === 0) {
      return res.status(400).json({ error: "No files provided" });
    }

    for (const f of reqFiles) {
      const sz = typeof f.size === "number" ? f.size : (f.buffer?.length ?? 0);
      if (isFileTooLarge(sz)) {
        return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
      }
    }

    const incomingBytes = reqFiles.reduce((sum, f) => sum + (f.size || 0), 0);
    const quota = storageManager.checkQuota(incomingBytes);
    if (!quota.allowed) {
      return res.status(400).json({ error: quota.message || "Darkness storage limit reached. Free up space or increase the storage limit." });
    }

    try {
      let paths: string[] = [];
      if (req.body?.paths) {
        try {
          paths = typeof req.body.paths === "string" ? JSON.parse(req.body.paths) : req.body.paths;
        } catch {
          paths = [];
        }
      }

      let projectId = req.body?.projectId;
      if (projectId && projects.has(projectId) && String((projects.get(projectId) as any)?.user_id || "").toLowerCase() !== String(user.id).toLowerCase()) {
        return res.status(403).json({ error: "Not your project" });
      }
      let pItem: any;

      if (projectId && projects.has(projectId)) {
        pItem = projects.get(projectId);
      } else {
        projectId = "proj_" + Math.random().toString(36).substr(2, 9);
        let projName = req.body?.name;
        if (!projName && paths.length > 0 && paths[0].includes("/")) {
          projName = paths[0].split("/")[0];
        }
        projName = projName || "Uploaded Project";

        pItem = {
          id: projectId,
          user_id: user.id,
          name: projName,
          description: "",
          project_type: "other",
          primary_language: "text",
          file_count: reqFiles.length,
          created_at: Date.now(),
          updated_at: Date.now(),
          status: "ready",
          source: "upload",
        };
        projects.set(projectId, pItem);
        dbCreateProject({
          id: projectId,
          user_id: user.id,
          name: projName,
          created_at: pItem.created_at,
          updated_at: pItem.updated_at,
          metadata: JSON.stringify({ user_id: user.id, file_count: reqFiles.length }),
        });
        if (isSupabaseConfigured()) {
          syncProjectToSupabase(pItem).catch(() => {});
        }
        createProjectFolderOnDisk(projectId, "/");
      }

      const extractedFiles: ExtractedFile[] = [];
      const diskBatch: Array<{ relativePath: string; content: string | Buffer }> = [];
      const dbFilesBatch: any[] = [];
      const now = Date.now();

      for (let i = 0; i < reqFiles.length; i++) {
        const f = reqFiles[i];
        let relPath = (paths[i] || f.originalname).replace(/\\/g, "/");
        if (relPath.startsWith("/")) relPath = relPath.slice(1);

        const cleanPath = sanitizeProjectPath(relPath);
        if (!cleanPath) continue;

        const isKnownText = /\.(json|ipynb|csv|txt|md|js|ts|py|html|css|xml|yml|yaml|tsx|jsx|c|cpp|h|hpp|java|go|rs|rb|php|sh|bat)$/i.test(f.originalname);
        const isBinary = !isKnownText && /image|pdf|zip|octet-stream|video|audio/i.test(f.mimetype);
        const textContent = isBinary ? "" : f.buffer.toString("utf-8");

        const extFile: ExtractedFile = {
          path: cleanPath,
          name: path.basename(cleanPath),
          extension: path.extname(cleanPath),
          size: f.size,
          isBinary,
          content: textContent,
          buffer: isBinary ? f.buffer : undefined,
          lineCount: isBinary ? 0 : (textContent ? textContent.split(/\r?\n/).length : 0),
        };
        extractedFiles.push(extFile);

        diskBatch.push({
          relativePath: cleanPath,
          content: f.buffer || textContent,
        });

        const fid = "pf_" + Math.random().toString(36).substr(2, 9);
        const ext = path.extname(cleanPath);
        const name = path.basename(cleanPath);

        dbFilesBatch.push({
          id: fid,
          project_id: projectId,
          path: cleanPath,
          name,
          extension: ext,
          language: detectFileLanguage(ext, name),
          size: f.size,
          is_binary: isBinary ? 1 : 0,
          content: textContent,
          created_at: now,
          updated_at: now,
        });

        files.set(fid, {
          id: fid,
          user_id: user.id,
          conversation_id: null,
          project_id: projectId,
          filename: cleanPath,
          mime: f.mimetype,
          size: f.size,
          file_type: isBinary ? "binary" : "code",
          content: textContent,
          uploaded_at: Math.floor(now / 1000),
        });
      }

      writeProjectFilesBatchToDisk(projectId, diskBatch);
      dbCreateFilesBatch(dbFilesBatch);

      // Re-run analysis
      const allProjectFiles = dbListFiles(projectId).map((f) => ({
        path: f.path,
        name: path.basename(f.path),
        extension: path.extname(f.path),
        size: f.size,
        isBinary: !!f.is_binary,
        content: f.content || "",
        lineCount: f.is_binary ? 0 : (f.content ? f.content.split(/\r?\n/).length : 0),
      }));

      const analysis = analyzeProject(pItem.name, projectId, allProjectFiles);
      projectAnalyses.set(projectId, analysis);
      try {
        dbSaveProjectAnalysis(projectId, analysis);
        dbSaveArchitecture(projectId, analysis.architecture.nodes, analysis.architecture.edges);
      } catch (e) {
        console.error("Architecture save error:", e);
      }

      // Background knowledge indexing so folder upload returns immediately to the client
      setImmediate(() => {
        try {
          indexProject(projectId, pItem.name, allProjectFiles, analysis);
        } catch (idxErr) {
          console.error("Background indexing error:", idxErr);
        }
      });

      pItem.project_type = analysis.projectType;
      pItem.primary_language = analysis.primaryLanguage;
      pItem.file_count = allProjectFiles.length;
      pItem.updated_at = Date.now();
      projects.set(projectId, pItem);
      try {
        dbUpdateProject(projectId, {
          name: pItem.name,
          updated_at: pItem.updated_at,
          metadata: {
            user_id: user.id,
            file_count: allProjectFiles.length,
            project_type: analysis.projectType,
            primary_language: analysis.primaryLanguage,
            source: pItem.source || "upload",
          },
        });
      } catch (e) {
        console.error("Failed to update project metadata in DB:", e);
      }

      return res.json({
        success: true,
        projectId,
        project: pItem,
        analysis,
        filesCount: extractedFiles.length,
      });
    } catch (err: any) {
      console.error("Batch file upload error:", err);
      return res.status(500).json({ error: err.message || "Failed to process files upload" });
    }
  });

  // -------------------------------------------------------------------------
  // Project Details, Analysis, & Tree
  // -------------------------------------------------------------------------
  app.get("/api/projects/:pid", (req, res) => {
    const pid = String(req.params.pid);
    let proj = projects.get(pid);
    if (!proj) {
      const dbP = dbGetProject(pid);
      if (dbP) {
        const meta: any = parseMetadataSafely(dbP.metadata);
        const pFiles = dbListFiles(pid);
        const effectiveCount = pFiles.length > 0 ? pFiles.length : (meta.file_count || countProjectFiles(pid) || 0);
        proj = {
          id: dbP.id,
          name: dbP.name,
          description: dbP.description || "",
          source: dbP.source_type || "upload",
          user_id: meta.user_id || initialUser.id,
          project_type: meta.project_type || "other",
          primary_language: meta.primary_language || "text",
          file_count: effectiveCount,
          created_at: dbP.created_at,
          updated_at: dbP.updated_at,
          github: meta.github || undefined,
        };
        projects.set(pid, proj);
      }
    }
    if (!proj) return res.status(404).json({ error: "Project not found" });
    const user = resolveUser(req);
    if (user && proj.user_id && proj.user_id !== user.id && user.id !== initialUser.id && proj.user_id !== initialUser.id) {
      return res.status(403).json({ error: "Access denied to this project", code: "FORBIDDEN" });
    }
    if (!proj.file_count || proj.file_count === 0) {
      const liveCount = countProjectFiles(pid);
      if (liveCount > 0) proj.file_count = liveCount;
    }
    return res.json({ project: proj });
  });

  app.get("/api/projects/:pid/analysis", (req, res) => {
    const pid = req.params.pid;
    let analysis = projectAnalyses.get(pid) || dbGetProjectAnalysis(pid);
    if (!analysis) {
      const pFiles = dbListFiles(pid);
      const extracted: ExtractedFile[] = pFiles.map((f) => ({
        path: f.path,
        name: path.basename(f.path),
        extension: path.extname(f.path),
        size: f.size,
        isBinary: !!f.is_binary,
        content: f.content || "",
        lineCount: f.is_binary ? 0 : (f.content ? f.content.split(/\r?\n/).length : 0),
      }));
      const proj = projects.get(pid) || dbGetProject(pid);
      analysis = analyzeProject(proj?.name || "Project", pid, extracted);
      projectAnalyses.set(pid, analysis);
      try {
        dbSaveProjectAnalysis(pid, analysis);
      } catch (e) {}
    }
    return res.json({ analysis });
  });

  app.post("/api/projects/:pid/analyze", (req, res) => {
    const pid = req.params.pid;
    const pFiles = dbListFiles(pid);
    const extracted: ExtractedFile[] = pFiles.map((f) => ({
      path: f.path,
      name: path.basename(f.path),
      extension: path.extname(f.path),
      size: f.size,
      isBinary: !!f.is_binary,
      content: f.content || "",
      lineCount: f.is_binary ? 0 : (f.content ? f.content.split(/\r?\n/).length : 0),
    }));
    const proj = projects.get(pid) || dbGetProject(pid);
    const analysis = analyzeProject(proj?.name || "Project", pid, extracted);
    projectAnalyses.set(pid, analysis);
    try {
      dbSaveProjectAnalysis(pid, analysis);
      dbSaveArchitecture(pid, analysis.architecture.nodes, analysis.architecture.edges);
      indexProject(pid, proj?.name || "Project", extracted, analysis);
    } catch (e) {}
    return res.json({ success: true, analysis });
  });

  app.get("/api/projects/:pid/tree", (req, res) => {
    const pid = String(req.params.pid);
    let pFiles = dbListFiles(pid);

    // Auto-sync if project has files on physical disk that weren't in SQLite yet
    if (pFiles.length === 0) {
      try {
        const diskFiles = listProjectDiskFiles(pid);
        if (diskFiles && diskFiles.length > 0) {
          const now = Date.now();
          const batchToInsert = diskFiles.map(df => {
            // listProjectDiskFiles returns { path, size }. This used to read relativePath / isBinary / hash, which do not exist, so
            // the auto-sync always threw inside the surrounding try and silently imported nothing.
            const raw = readProjectFileFromDisk(pid, df.path, true);
            const buf = Buffer.isBuffer(raw) ? raw : null;
            const isBinary = buf ? looksBinary(buf) : false;
            const contentStr = buf && !isBinary ? buf.toString("utf-8") : null;
            return {
              id: `file_${pid}_${Math.random().toString(36).substring(2, 9)}`,
              project_id: pid,
              path: df.path,
              name: path.basename(df.path),
              extension: path.extname(df.path),
              language: isBinary ? "binary" : "code",
              size: df.size,
              hash: "",
              version: 1,
              content: contentStr,
              is_binary: isBinary ? 1 : 0,
              created_at: now,
              updated_at: now,
            };
          });
          dbCreateFilesBatch(batchToInsert);
          pFiles = dbListFiles(pid);
        }
      } catch (recoveryErr) {
        console.warn("Disk file auto-sync error:", recoveryErr);
      }
    }

    const tree = buildFileTree(pFiles);

    const categories: Record<string, number> = {
      all: pFiles.length,
      code: 0,
      style: 0,
      data: 0,
      doc: 0,
      config: 0,
      asset: 0,
    };

    let totalSize = 0;
    let totalLines = 0;
    const flatFiles: any[] = [];

    for (const f of pFiles) {
      const ext = path.extname(f.path);
      const name = path.basename(f.path);
      const cat = getFileCategory(ext, name);
      if (cat === "image") categories.asset = (categories.asset || 0) + 1;
      else categories[cat] = (categories[cat] || 0) + 1;

      totalSize += f.size || 0;
      const lines = f.is_binary ? 0 : (f.content ? f.content.split(/\r?\n/).length : 0);
      totalLines += lines;

      flatFiles.push({
        path: f.path,
        name,
        extension: ext,
        size: f.size,
        lineCount: lines,
        category: cat,
      });
    }

    // Count folders
    const folderSet = new Set<string>();
    for (const f of pFiles) {
      const parts = f.path.split("/");
      for (let i = 1; i < parts.length; i++) {
        folderSet.add(parts.slice(0, i).join("/"));
      }
    }

    return res.json({
      tree,
      files: flatFiles,
      total: pFiles.length,
      totalFiles: pFiles.length,
      totalFolders: folderSet.size,
      totalSize,
      totalLines,
      categories,
    });
  });

  app.get("/api/projects/:pid/search", (req, res) => {
    const pid = String(req.params.pid);
    const query = String(req.query.q || "").toLowerCase().trim();
    const category = String(req.query.category || "all").toLowerCase();

    if (!query) return res.json({ results: [] });

    const pFiles = dbListFiles(pid);
    const results: any[] = [];

    for (const f of pFiles) {
      const ext = path.extname(f.path);
      const name = path.basename(f.path);
      const cat = getFileCategory(ext, name);

      if (category !== "all" && cat !== category) continue;

      const pathMatch = f.path.toLowerCase().includes(query);
      const matches: Array<{ line: number; text: string }> = [];

      if (!f.is_binary && f.content) {
        const lines = f.content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(query)) {
            matches.push({
              line: i + 1,
              text: lines[i].trim().slice(0, 150),
            });
            if (matches.length >= 5) break;
          }
        }
      }

      if (pathMatch || matches.length > 0) {
        results.push({
          file: f.path,
          extension: ext,
          lineCount: f.is_binary ? 0 : (f.content ? f.content.split(/\r?\n/).length : 0),
          matches,
        });
      }
    }

    return res.json({ results });
  });

  app.get("/api/projects/:pid/file", (req, res) => {
    const pid = String(req.params.pid);
    const filePath = String(req.query.path || "");
    if (!filePath) return res.status(400).json({ error: "path parameter is required" });

    const cleanPath = sanitizeProjectPath(filePath);
    const extRaw = path.extname(cleanPath).toLowerCase();
    const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".svg", ".tiff", ".avif"].includes(extRaw);
    const isBinaryKnown = [".docx", ".doc", ".pdf", ".xlsx", ".xls", ".pptx", ".ppt", ".zip", ".tar", ".gz", ".7z", ".rar", ".mp4", ".mp3", ".wav", ".woff", ".woff2", ".ttf", ".eot", ".exe", ".dll", ".so", ".bin", ".dat", ".db", ".sqlite", ".pkl", ".h5", ".npy", ".npz", ".joblib", ".pth", ".pt", ".onnx", ".pb"].includes(extRaw) || isImage;
    const isTextKnown = [".json", ".ipynb", ".csv", ".txt", ".md", ".js", ".ts", ".py", ".html", ".css"].includes(extRaw);
    
    let dbFile = dbGetProjectFileByPath(pid, cleanPath);
    const isBinary = isTextKnown ? false : (!!dbFile?.is_binary || isBinaryKnown);
    let diskContent = readProjectFileFromDisk(pid, cleanPath, isBinary);

    if (diskContent === null && !dbFile) {
      return res.status(404).json({ error: `File not found: ${filePath}` });
    }

    const ext = path.extname(cleanPath);
    const name = path.basename(cleanPath);

    let textContent = "";
    if (extRaw === ".svg") {
      textContent = diskContent ? (Buffer.isBuffer(diskContent) ? diskContent.toString("utf-8") : diskContent) : (dbFile?.content ? (Buffer.isBuffer(dbFile.content) ? dbFile.content.toString("utf-8") : dbFile.content) : "");
    } else if (!isBinary) {
      textContent = diskContent ? (Buffer.isBuffer(diskContent) ? diskContent.toString("utf-8") : diskContent) : (dbFile?.content ? (Buffer.isBuffer(dbFile.content) ? dbFile.content.toString("utf-8") : dbFile.content) : "");
    }

    const fileSize = dbFile?.size || (diskContent ? (Buffer.isBuffer(diskContent) ? diskContent.length : Buffer.byteLength(diskContent, "utf-8")) : 0);

    return res.json({
      path: cleanPath,
      name,
      extension: ext,
      size: fileSize,
      lineCount: isBinary && extRaw !== ".svg" ? 0 : (textContent ? textContent.split(/\r?\n/).length : 0),
      isBinary,
      language: detectFileLanguage(ext, name),
      category: isImage ? "image" : getFileCategory(ext, name),
      content: textContent,
      rawUrl: `/api/projects/${pid}/file/raw?path=${encodeURIComponent(cleanPath)}`,
    });
  });

  app.get("/api/projects/:pid/file/docx-html", async (req, res) => {
    const pid = String(req.params.pid);
    const filePath = String(req.query.path || "");
    if (!filePath) return res.status(400).json({ error: "path parameter is required" });

    const cleanPath = sanitizeProjectPath(filePath);
    const extRaw = path.extname(cleanPath).toLowerCase();
    if (extRaw !== ".docx" && extRaw !== ".doc") {
      return res.status(400).json({ error: "Only .docx and .doc files are supported by document converter" });
    }

    try {
      let buf: Buffer | null = null;
      const fullDiskPath = resolveProjectFilePath(pid, cleanPath);
      if (fs.existsSync(fullDiskPath) && fs.statSync(fullDiskPath).isFile()) {
        buf = fs.readFileSync(fullDiskPath);
      } else {
        const dbFile = dbGetProjectFileByPath(pid, cleanPath);
        if (dbFile && dbFile.content) {
          buf = Buffer.from(dbFile.content, dbFile.is_binary ? "base64" : "utf-8");
        }
      }

      if (!buf || buf.length === 0) {
        return res.status(404).json({ error: `Document file content empty or not found: ${filePath}` });
      }

      const result = await mammoth.convertToHtml({ buffer: buf });
      let html = result.value || "";

      if (!html.trim()) {
        const rawTextResult = await mammoth.extractRawText({ buffer: buf });
        const text = rawTextResult.value || "";
        html = text
          .split(/\n+/)
          .filter(Boolean)
          .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
          .join("");
      }

      return res.json({
        success: true,
        path: cleanPath,
        name: path.basename(cleanPath),
        html,
        warnings: (result.messages || []).map((m: any) => m.message), // mammoth reports `messages` (there is no `warnings`)
      });
    } catch (err: any) {
      console.error("Error parsing DOCX file:", err);
      return res.status(500).json({
        error: "Failed to parse DOCX document: " + (err?.message || "Invalid or corrupt format"),
      });
    }
  });

  app.post("/api/projects/:pid/files", (req, res) => {
    const pid = String(req.params.pid);
    const { path: rawPath, content = "" } = req.body || {};
    if (!rawPath) return res.status(400).json({ error: "Path is required" });

    const contentLen = Buffer.byteLength(content || "", "utf-8");
    if (isFileTooLarge(contentLen)) {
      return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
    }

    const cleanPath = sanitizeProjectPath(rawPath);
    writeProjectFileToDisk(pid, cleanPath, content);

    const fid = "pf_" + Math.random().toString(36).substr(2, 9);
    const ext = path.extname(cleanPath);
    const name = path.basename(cleanPath);
    try {
      dbCreateFile({
        id: fid,
        project_id: pid,
        path: cleanPath,
        name,
        extension: ext,
        language: detectFileLanguage(ext, name),
        size: Buffer.byteLength(content, "utf-8"),
        is_binary: 0,
        content,
        created_at: Date.now(),
        updated_at: Date.now(),
      } as any);
    } catch {
      dbUpdateFileByPath(pid, cleanPath, { content, size: Buffer.byteLength(content, "utf-8"), is_binary: 0 });
    }

    const extFile: ExtractedFile = {
      path: cleanPath,
      name: path.basename(cleanPath),
      extension: path.extname(cleanPath),
      size: Buffer.byteLength(content, "utf-8"),
      isBinary: false,
      content,
      lineCount: content.split(/\r?\n/).length,
    };
    updateFileKnowledge(pid, extFile);

    return res.json({ success: true, file: { path: cleanPath, size: extFile.size } });
  });

  app.put("/api/projects/:pid/files", (req, res) => {
    const pid = String(req.params.pid);
    const { path: rawPath, content = "" } = req.body || {};
    if (!rawPath) return res.status(400).json({ error: "Path is required" });

    const contentLen = Buffer.byteLength(content || "", "utf-8");
    if (isFileTooLarge(contentLen)) {
      return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
    }

    const cleanPath = sanitizeProjectPath(rawPath);
    writeProjectFileToDisk(pid, cleanPath, content);
    dbUpdateFileByPath(pid, cleanPath, { content, size: Buffer.byteLength(content, "utf-8"), is_binary: 0 });

    const extFile: ExtractedFile = {
      path: cleanPath,
      name: path.basename(cleanPath),
      extension: path.extname(cleanPath),
      size: Buffer.byteLength(content, "utf-8"),
      isBinary: false,
      content,
      lineCount: content.split(/\r?\n/).length,
    };
    updateFileKnowledge(pid, extFile);

    return res.json({ success: true, file: { path: cleanPath, size: extFile.size } });
  });

  app.post("/api/projects/:pid/folders", (req, res) => {
    const pid = String(req.params.pid);
    const rawFolder = req.body?.path || req.body?.folderPath;
    if (!rawFolder) return res.status(400).json({ error: "Folder path required" });

    createProjectFolderOnDisk(pid, rawFolder);
    return res.json({ success: true });
  });

  app.patch("/api/projects/:pid/files/rename", (req, res) => {
    const pid = String(req.params.pid);
    const { oldPath, newPath } = req.body || {};
    if (!oldPath || !newPath) return res.status(400).json({ error: "oldPath and newPath required" });

    renameProjectFileOnDisk(pid, oldPath, newPath);
    const existing = dbGetProjectFileByPath(pid, sanitizeProjectPath(oldPath));
    if (existing) {
      dbDeleteProjectFileByPath(pid, sanitizeProjectPath(oldPath));
      const newClean = sanitizeProjectPath(newPath);
      const ext = path.extname(newClean);
      const name = path.basename(newClean);
      dbCreateFile({
        id: existing.id,
        project_id: pid,
        path: newClean,
        name,
        extension: ext,
        language: detectFileLanguage(ext, name),
        size: existing.size,
        is_binary: existing.is_binary,
        content: existing.content,
        created_at: existing.created_at,
        updated_at: Date.now(),
      } as any);
    }
    deleteFileKnowledge(pid, sanitizeProjectPath(oldPath));
    return res.json({ success: true });
  });

  app.patch("/api/projects/:pid/folders/rename", (req, res) => {
    const pid = String(req.params.pid);
    const { oldPath, newPath } = req.body || {};
    if (!oldPath || !newPath) return res.status(400).json({ error: "oldPath and newPath required" });

    renameProjectFolderOnDisk(pid, oldPath, newPath);
    dbRenameProjectFolderFiles(pid, sanitizeProjectPath(oldPath), sanitizeProjectPath(newPath));
    return res.json({ success: true });
  });

  app.delete("/api/projects/:pid/files", (req, res) => {
    const pid = String(req.params.pid);
    const rawPath = String(req.query.path || req.body?.path || "");
    if (!rawPath) return res.status(400).json({ error: "path required" });

    const cleanPath = sanitizeProjectPath(rawPath);
    deleteProjectFileFromDisk(pid, cleanPath);
    dbDeleteProjectFileByPath(pid, cleanPath);
    deleteFileKnowledge(pid, cleanPath);
    return res.json({ success: true });
  });

  app.delete("/api/projects/:pid/folders", (req, res) => {
    const pid = String(req.params.pid);
    const rawFolder = String(req.query.folderPath || req.query.path || req.body?.folderPath || req.body?.path || "");
    if (!rawFolder) return res.status(400).json({ error: "folderPath required" });

    const cleanFolder = sanitizeProjectPath(rawFolder);
    deleteProjectFolderOnDisk(pid, cleanFolder);
    dbDeleteProjectFolderFiles(pid, cleanFolder);
    return res.json({ success: true });
  });

  
  app.get("/api/projects/:pid/file/raw", (req, res) => {
    const pid = String(req.params.pid);
    const rawPath = String(req.query.path || "");
    if (!rawPath) return res.status(400).send("Path required");

    const cleanPath = sanitizeProjectPath(rawPath);
    const extRaw = path.extname(cleanPath).toLowerCase();
    
    // Check MIME type
    const mimeMap: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".bmp": "image/bmp",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".doc": "application/msword",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".xls": "application/vnd.ms-excel",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".ppt": "application/vnd.ms-powerpoint",
      ".pdf": "application/pdf",
      ".json": "application/json",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".js": "application/javascript",
      ".ts": "text/plain",
      ".html": "text/html",
      ".css": "text/css",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".ogg": "video/ogg",
      ".mov": "video/quicktime",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
    };
    const mimeType = mimeMap[extRaw] || "application/octet-stream";

    try {
      const fullDiskPath = resolveProjectFilePath(pid, cleanPath);
      if (fs.existsSync(fullDiskPath) && fs.statSync(fullDiskPath).isFile()) {
        res.setHeader("Content-Type", mimeType);
        res.setHeader("Cache-Control", "public, max-age=3600");
        return res.sendFile(fullDiskPath);
      }
    } catch (e) {}

    let dbFile = dbGetProjectFileByPath(pid, cleanPath);
    if (!dbFile) {
      return res.status(404).send("File not found");
    }

    res.setHeader("Content-Type", mimeType);
    if (dbFile.is_binary && dbFile.content) {
      const buf = Buffer.from(dbFile.content, "base64");
      return res.send(buf);
    }
    return res.send(dbFile.content || "");
  });

  app.get("/api/projects/:pid/files/download", (req, res) => {
    const pid = String(req.params.pid);
    const rawPath = String(req.query.path || "");
    if (!rawPath) return res.status(400).send("Path required");

    const cleanPath = sanitizeProjectPath(rawPath);
    const extRaw = path.extname(cleanPath).toLowerCase();
    const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".svg", ".tiff", ".avif"].includes(extRaw);
    const isBinaryKnown = [".docx", ".doc", ".pdf", ".xlsx", ".xls", ".pptx", ".ppt", ".zip", ".tar", ".gz", ".7z", ".rar", ".mp4", ".mp3", ".wav", ".woff", ".woff2", ".ttf", ".eot", ".exe", ".dll", ".so", ".bin", ".dat", ".db", ".sqlite", ".pkl", ".h5", ".npy", ".npz", ".joblib", ".pth", ".pt", ".onnx", ".pb"].includes(extRaw) || isImage;
    const isTextKnown = [".json", ".ipynb", ".csv", ".txt", ".md", ".js", ".ts", ".py", ".html", ".css"].includes(extRaw);
    
    let dbFile = dbGetProjectFileByPath(pid, cleanPath);
    const isBinary = isTextKnown ? false : (!!dbFile?.is_binary || isBinaryKnown);
    let content = readProjectFileFromDisk(pid, cleanPath, isBinary);
    
    if (content === null && dbFile) {
        content = dbFile.content;
    }

    const name = path.basename(cleanPath);

    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(content || "");
  });

  app.get("/api/projects/:pid/export-zip", (req, res) => {
    const pid = String(req.params.pid);
    const proj = projects.get(pid) || dbGetProject(pid);
    const projDir = getProjectStorageDir(pid, false);

    const zip = new AdmZip();
    if (fs.existsSync(projDir)) {
      zip.addLocalFolder(projDir);
    } else {
      const pFiles = dbListFiles(pid);
      for (const f of pFiles) {
        zip.addFile(f.path, Buffer.from(f.content || ""));
      }
    }

    const zipBuffer = zip.toBuffer();
    const zipName = `${(proj?.name || "project").replace(/[^a-zA-Z0-9_-]/g, "_")}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
    res.send(zipBuffer);
  });

  // -------------------------------------------------------------------------
  // Knowledge RAG & Search Endpoints
  // -------------------------------------------------------------------------
  app.get("/api/projects/:pid/knowledge", (req, res) => {
    const pid = String(req.params.pid);
    const chunks = dbListKnowledgeChunks(pid);
    res.json({ chunks, total: chunks.length });
  });

  app.post("/api/projects/:pid/knowledge/reindex", (req, res) => {
    const pid = String(req.params.pid);
    const pFiles = dbListFiles(pid);
    const extracted: ExtractedFile[] = pFiles.map((f) => ({
      path: f.path,
      name: path.basename(f.path),
      extension: path.extname(f.path),
      size: f.size,
      isBinary: !!f.is_binary,
      content: f.content || "",
      lineCount: f.is_binary ? 0 : (f.content ? f.content.split(/\r?\n/).length : 0),
    }));
    const proj = projects.get(pid) || dbGetProject(pid);
    const analysis = projectAnalyses.get(pid) || analyzeProject(proj?.name || "Project", pid, extracted);
    indexProject(pid, proj?.name || "Project", extracted, analysis);
    res.json({ ok: true, count: extracted.length });
  });

  app.get("/api/projects/:pid/knowledge/search", (req, res) => {
    const pid = String(req.params.pid);
    const q = String(req.query.q || "");
    const results = searchKnowledge(pid, q);
    res.json({ results });
  });

  // -------------------------------------------------------------------------
  // Diagnostics & Architecture Explanation
  // -------------------------------------------------------------------------
  app.post("/api/projects/:pid/diagnostics", async (req, res) => {
    const { path: filePath, content } = req.body || {};
    try {
      const issues = await analyzeFileDiagnostics(filePath || "file.ts", content || "");
      // The editor's Problems badge reads `{ issues, summary }` (it used to receive a bare array, so every count was zero).
      const summary = { errors: 0, warnings: 0, suggestions: 0 };
      for (const i of issues) {
        if (i.severity === "error") summary.errors++;
        else if (i.severity === "warning") summary.warnings++;
        else summary.suggestions++;
      }
      res.json({ issues, summary });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Diagnostics failed" });
    }
  });

  app.post("/api/projects/:pid/diagnostics/project", async (req, res) => {
    const pid = String(req.params.pid);
    const pFiles = dbListFiles(pid).filter((f) => !f.is_binary);
    let allIssues: any[] = [];
    let summary = { errors: 0, warnings: 0, suggestions: 0 };

    for (const f of pFiles.slice(0, 15)) {
      try {
        // analyzeFileDiagnostics resolves to an ARRAY of issues. This code used to read `.issues` / `.summary` from it, which are
        // undefined on an array, so project-wide diagnostics always came back empty.
        const diag = await analyzeFileDiagnostics(f.path, f.content || "");
        for (const issue of diag) {
          allIssues.push(issue);
          if (issue.severity === "error") summary.errors++;
          else if (issue.severity === "warning") summary.warnings++;
          else summary.suggestions++;
        }
      } catch {}
    }

    res.json({ issues: allIssues, summary });
  });

  app.post("/api/projects/:pid/diagnostics/ai-fix", async (req, res) => {
    const pid = String(req.params.pid);
    const { path: rawPath, issueId, fixAll, issues } = req.body || {};
    if (!rawPath) return res.status(400).json({ error: "File path is required" });

    const cleanPath = sanitizeProjectPath(rawPath);
    const dbFile = dbGetProjectFileByPath(pid, cleanPath);
    let currentContent = readProjectFileFromDisk(pid, cleanPath, false);
    if (currentContent === null && dbFile) {
      currentContent = dbFile.content || "";
    }
    if (currentContent === null || typeof currentContent !== "string") {
      return res.status(404).json({ error: "File not found or is binary" });
    }

    // Determine target issues
    let targetIssues = Array.isArray(issues) && issues.length > 0 ? issues : [];
    if (targetIssues.length === 0) {
      const diag = await analyzeFileDiagnostics(cleanPath, currentContent);
      targetIssues = diag; // an array of issues (it has no `.issues`)
    }

    if (issueId) {
      targetIssues = targetIssues.filter((i: any) => i.id === issueId);
    }

    if (targetIssues.length === 0) {
      return res.json({ success: true, message: "No problems found to fix", fixedCount: 0, content: currentContent });
    }

    let fixedContent = currentContent;
    let fixedCount = 0;

    // 1. Try Gemini AI fix if API key exists
    const canFullyResolveWithRules = targetIssues.length > 0 && targetIssues.every((i) => i.patchedContent || i.suggestedCode);

    // 1. Try Gemini AI fix if API key exists and we CANNOT fully resolve with rules
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (apiKey && !canFullyResolveWithRules) {
      try {
        const issuesSummary = targetIssues.map((i: any) => `- Line ${i.line || '?'}: [${i.type || i.severity}] ${i.message} (Suggested fix: ${i.correction || i.suggestedCode || 'N/A'})`).join("\n");
        const prompt = `You are an expert software developer and automated code fixer.
Fix all identified bugs, syntax errors, missing imports, unhandled exceptions, or problems in the provided file.

File: ${cleanPath}
Identified Issues:
${issuesSummary}

Original File Content:
\`\`\`
${currentContent}
\`\`\`

Strict Requirements:
1. Output ONLY the raw fixed file content.
2. Do NOT wrap in markdown code fence backticks (\`\`\` or \`\`\`typescript).
3. Preserve all functionality, formatting, and valid structure of the file.
4. Correct all syntax errors, import paths, and logic defects.`;

        const result = await generateGeminiWithResilience({
          apiKey,
          modelName: "gemini-1.5-flash",
          contents: [{ parts: [{ text: prompt }] }],
          timeoutMs: 12000,
        });

        let aiText = result.text || "";
        const match = aiText.match(/```(?:[a-zA-Z0-9_\-]+)?\n([\s\S]*?)```/);
        if (match) {
          aiText = match[1].trim();
        } else {
          // If no markdown block, sometimes they just return the code.
          aiText = aiText.trim();
        }

        if (aiText && aiText.trim().length > 0 && aiText.trim() !== currentContent.trim()) {
          fixedContent = aiText;
          fixedCount = targetIssues.length;
        }
      } catch (geminiErr: any) {
        console.warn("Gemini AI fix error, falling back to rule engine:", geminiErr?.message || geminiErr);
      }
    }

    // 2. Rule-based / Diagnostic patch application fallback
    if (fixedCount === 0) {
      const lines = fixedContent.split(/\r?\n/);
      const sortedIssues = [...targetIssues].sort((a: any, b: any) => (b.line || 0) - (a.line || 0));
      for (const issue of sortedIssues) {
        if (issue.patchedContent) {
          fixedContent = issue.patchedContent;
          fixedCount++;
          break;
        } else if (issue.suggestedCode && issue.line && issue.line <= lines.length) {
          lines[issue.line - 1] = issue.suggestedCode;
          fixedCount++;
        }
      }
      if (fixedCount > 0 && fixedContent === currentContent) {
        fixedContent = lines.join("\n");
      }
    }

    // Save changes if fixed
    if (fixedCount > 0 || fixedContent !== currentContent) {
      try {
        writeProjectFileToDisk(pid, cleanPath, fixedContent);
      } catch (e) {}

      dbUpdateFileByPath(pid, cleanPath, {
        content: fixedContent,
        size: Buffer.byteLength(fixedContent, "utf-8"),
        is_binary: 0,
      });

      const extFile: ExtractedFile = {
        path: cleanPath,
        name: path.basename(cleanPath),
        extension: path.extname(cleanPath),
        size: Buffer.byteLength(fixedContent, "utf-8"),
        isBinary: false,
        content: fixedContent,
        lineCount: fixedContent.split(/\r?\n/).length,
      };
      updateFileKnowledge(pid, extFile);
    }

    const freshDiag = await analyzeFileDiagnostics(cleanPath, fixedContent);

    return res.json({
      success: true,
      path: cleanPath,
      fixedCount: fixedCount || 1,
      content: fixedContent,
      fixedContent: fixedContent,
      diagnostics: freshDiag,
    });
  });

  app.post("/api/projects/:pid/explain-architecture", async (req, res) => {
    const pid = String(req.params.pid);
    const analysis = projectAnalyses.get(pid) || dbGetProjectAnalysis(pid);
    if (!analysis) return res.json({ explanation: "Architecture details are not yet generated for this project." });

    const nodes = analysis.architecture?.nodes || [];
    const endpoints = analysis.apiIntelligence?.endpoints || [];
    const models = analysis.databaseIntelligence?.models || [];

    const explanation = `### 🏛️ Architecture & System Blueprint: **${analysis.projectName}**\n\n` +
      `**Project Type:** ${analysis.projectType} (${analysis.primaryLanguage})\n` +
      `**Summary:** ${analysis.summary}\n\n` +
      `#### 🧩 Core Components (${nodes.length} nodes detected):\n` +
      nodes.map((n: any) => `- **${n.label}** (${n.type}): ${n.description || "Component in " + n.file}`).join("\n") +
      `\n\n#### 🔌 API Surface (${endpoints.length} endpoints):\n` +
      (endpoints.length > 0 ? endpoints.map((e: any) => `- \`${e.method} ${e.path}\` → defined in \`${e.file}\``).join("\n") : "_No public HTTP endpoints detected._") +
      `\n\n#### 🗄️ Database & Models (${models.length} schemas):\n` +
      (models.length > 0 ? models.map((m: any) => `- **${m.name}** (${m.fields?.length || 0} fields) in \`${m.file}\``).join("\n") : "_No schema models detected._") +
      `\n\n#### 🛡️ Security Health & Code Quality:\n` +
      `- Security Score: **${100 - (analysis.securityAnalysis?.findings?.length || 0) * 10}/100** (${analysis.securityAnalysis?.findings?.length || 0} potential risks)\n` +
      `- Code Quality Score: **${analysis.codeQuality?.score || 90}/100**`;

    res.json({ explanation });
  });

  app.post("/api/projects/:pid/apply-changes", (req, res) => {
    const pid = String(req.params.pid);
    const { plan } = req.body || {};
    if (!plan || !plan.files) {
      return res.status(400).json({ error: "Invalid plan specification" });
    }

    try {
      for (const item of plan.files) {
        if (item.action === "delete") {
          deleteProjectFileFromDisk(pid, sanitizeProjectPath(item.path));
          dbDeleteProjectFileByPath(pid, sanitizeProjectPath(item.path));
          deleteFileKnowledge(pid, sanitizeProjectPath(item.path));
        } else {
          writeProjectFileToDisk(pid, sanitizeProjectPath(item.path), item.content || "");
          dbUpdateFileByPath(pid, sanitizeProjectPath(item.path), { content: item.content || "", size: Buffer.byteLength(item.content || "", "utf-8"), is_binary: 0 });
          const extFile: ExtractedFile = {
            path: sanitizeProjectPath(item.path),
            name: path.basename(item.path),
            extension: path.extname(item.path),
            size: Buffer.byteLength(item.content || "", "utf-8"),
            isBinary: false,
            content: item.content || "",
            lineCount: (item.content || "").split(/\r?\n/).length,
          };
          updateFileKnowledge(pid, extFile);
        }
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to apply code changes" });
    }
  });

  // -------------------------------------------------------------------------
  // GitHub Integration Endpoints
  // -------------------------------------------------------------------------
  app.post("/api/github/branches", async (req, res) => {
    const { repoUrl, token } = req.body || {};
    if (!repoUrl) return res.status(400).json({ error: "repoUrl is required" });

    try {
      let cleanUrl = repoUrl.trim();
      let match = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/i);
      let owner = "";
      let repo = "";
      if (match) {
        owner = match[1];
        repo = match[2];
      } else {
        const parts = cleanUrl.split("/");
        if (parts.length === 2) {
          owner = parts[0];
          repo = parts[1];
        } else {
          throw new Error("Invalid GitHub repository format. Use 'owner/repo' or GitHub URL.");
        }
      }

      const headers: Record<string, string> = {
        "User-Agent": "Darkness-AI-Assistant",
        Accept: "application/vnd.github.v3+json",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const repoResp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers, signal: AbortSignal.timeout(20_000) });
      if (!repoResp.ok) {
        const errJson = await repoResp.json().catch(() => ({}));
        throw new Error(errJson.message || `GitHub repo returned status ${repoResp.status}`);
      }
      const repoData = await repoResp.json();

      const branchResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`, { headers, signal: AbortSignal.timeout(20_000) });
      const branchData = branchResp.ok ? await branchResp.json() : [];
      const branchNames = Array.isArray(branchData) ? branchData.map((b: any) => b.name) : [repoData.default_branch || "main"];

      res.json({
        fullName: `${owner}/${repo}`,
        owner,
        repo,
        description: repoData.description,
        stars: repoData.stargazers_count,
        isPrivate: repoData.private,
        defaultBranch: repoData.default_branch || "main",
        branches: branchNames,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to fetch GitHub branches" });
    }
  });

  app.post("/api/github/import", async (req, res) => {
    const user = resolveUser(req) || initialUser;
    const { repoUrl, branch = "main", token, name } = req.body || {};
    if (!repoUrl) return res.status(400).json({ error: "repoUrl is required" });

    try {
      let cleanUrl = repoUrl.trim();
      let match = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/i);
      let owner = "";
      let repo = "";
      if (match) {
        owner = match[1];
        repo = match[2];
      } else {
        const parts = cleanUrl.split("/");
        if (parts.length === 2) {
          owner = parts[0];
          repo = parts[1];
        } else {
          throw new Error("Invalid GitHub repository format");
        }
      }

      const headers: Record<string, string> = {
        "User-Agent": "Darkness-AI-Assistant",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      // Download archive
      const zipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(branch)}`;
      const archiveResp = await fetch(zipUrl, { headers, signal: AbortSignal.timeout(120_000) }); // a repository download may be large, but not unbounded
      if (!archiveResp.ok) {
        throw new Error(`Failed to download repository zipball: HTTP ${archiveResp.status}`);
      }

      const arrayBuf = await archiveResp.arrayBuffer();
      const zipBuffer = Buffer.from(arrayBuf);
      const { files: extractedFiles, error: zipError } = extractZipSecurely(zipBuffer);

      if (zipError || !extractedFiles || extractedFiles.length === 0) {
        throw new Error(zipError || "Failed to extract repository files");
      }

      const projectId = "proj_" + Math.random().toString(36).substr(2, 9);
      const projName = name || repo;

      const pItem = {
        id: projectId,
        user_id: user.id,
        name: projName,
        description: `Imported from GitHub ${owner}/${repo} (${branch})`,
        project_type: "other",
        primary_language: "text",
        file_count: extractedFiles.length,
        created_at: Date.now(),
        updated_at: Date.now(),
        status: "ready",
        source: "github",
        github: {
          owner,
          repo,
          branch,
          token: token ? "configured" : undefined,
          status: "synced",
          lastSyncedAt: Date.now(),
        },
      };

      projects.set(projectId, pItem);
      dbCreateProject({
        id: projectId,
        user_id: user.id,
        name: projName,
        created_at: pItem.created_at,
        updated_at: pItem.updated_at,
        metadata: JSON.stringify({
          user_id: user.id,
          github: pItem.github,
          file_count: extractedFiles.length,
        }),
      });
      if (isSupabaseConfigured()) {
        syncProjectToSupabase(pItem).catch(() => {});
      }
      createProjectFolderOnDisk(projectId, "/");

      // Batch write files to disk and DB
      const diskBatch: Array<{ relativePath: string; content: string | Buffer }> = [];
      const dbFilesBatch: any[] = [];
      const now = Date.now();

      for (const ef of extractedFiles) {
        const cleanPath = sanitizeProjectPath(ef.path);
        if (!cleanPath) continue;

        diskBatch.push({
          relativePath: cleanPath,
          content: ef.buffer || ef.content,
        });

        const fid = "pf_" + Math.random().toString(36).substr(2, 9);
        const ext = path.extname(cleanPath);
        const name = path.basename(cleanPath);

        dbFilesBatch.push({
          id: fid,
          project_id: projectId,
          path: cleanPath,
          name,
          extension: ext,
          language: detectFileLanguage(ext, name),
          size: ef.size,
          is_binary: ef.isBinary ? 1 : 0,
          content: ef.content,
          created_at: now,
          updated_at: now,
        });

        files.set(fid, {
          id: fid,
          user_id: user.id,
          conversation_id: null,
          project_id: projectId,
          filename: cleanPath,
          mime: ef.isBinary ? "application/octet-stream" : "text/plain",
          size: ef.size,
          file_type: ef.isBinary ? "binary" : "code",
          content: ef.content,
          uploaded_at: Math.floor(now / 1000),
        });
      }

      writeProjectFilesBatchToDisk(projectId, diskBatch);
      dbCreateFilesBatch(dbFilesBatch);

      const analysis = analyzeProject(pItem.name, projectId, extractedFiles);
      projectAnalyses.set(projectId, analysis);
      try {
        dbSaveProjectAnalysis(projectId, analysis);
        dbSaveArchitecture(projectId, analysis.architecture.nodes, analysis.architecture.edges);
        indexProject(projectId, pItem.name, extractedFiles, analysis);
      } catch (e) {}

      pItem.project_type = analysis.projectType;
      pItem.primary_language = analysis.primaryLanguage;
      pItem.file_count = extractedFiles.length;
      projects.set(projectId, pItem);
      try {
        dbUpdateProject(projectId, {
          name: pItem.name,
          updated_at: pItem.updated_at,
          metadata: {
            user_id: user.id,
            file_count: extractedFiles.length,
            project_type: analysis.projectType,
            primary_language: analysis.primaryLanguage,
            source: "github",
            github: { owner, repo, branch },
          },
        });
      } catch (e) {
        console.error("Failed to update github project metadata in DB:", e);
      }

      return res.json({
        success: true,
        project: pItem,
        analysis,
        filesCount: extractedFiles.length,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to import GitHub repository" });
    }
  });

  app.post("/api/projects/:pid/github/sync", async (req, res) => {
    const pid = String(req.params.pid);
    const proj = projects.get(pid);
    if (!proj || !proj.github) {
      return res.status(400).json({ error: "Project is not linked to a GitHub repository" });
    }

    try {
      const { owner, repo, branch = "main" } = proj.github;
      const headers: Record<string, string> = { "User-Agent": "Darkness-AI-Assistant" };
      const zipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(branch)}`;
      const archiveResp = await fetch(zipUrl, { headers, signal: AbortSignal.timeout(120_000) }); // a repository download may be large, but not unbounded
      if (!archiveResp.ok) throw new Error(`HTTP ${archiveResp.status} while fetching repository`);

      const arrayBuf = await archiveResp.arrayBuffer();
      const zipBuffer = Buffer.from(arrayBuf);
      const { files: extractedFiles } = extractZipSecurely(zipBuffer);

      const diskBatch: Array<{ relativePath: string; content: string | Buffer }> = [];
      const dbFilesBatch: any[] = [];
      const now = Date.now();

      for (const ef of extractedFiles) {
        const cleanPath = sanitizeProjectPath(ef.path);
        if (!cleanPath) continue;

        diskBatch.push({
          relativePath: cleanPath,
          content: ef.buffer || ef.content,
        });

        const fid = "pf_" + Math.random().toString(36).substr(2, 9);
        const ext = path.extname(cleanPath);
        const name = path.basename(cleanPath);

        dbFilesBatch.push({
          id: fid,
          project_id: pid,
          path: cleanPath,
          name,
          extension: ext,
          language: detectFileLanguage(ext, name),
          size: ef.size,
          is_binary: ef.isBinary ? 1 : 0,
          content: ef.content,
          created_at: now,
          updated_at: now,
        });
      }

      writeProjectFilesBatchToDisk(pid, diskBatch);
      dbCreateFilesBatch(dbFilesBatch);

      const allFiles = dbListFiles(pid).map((f) => ({
        path: f.path,
        name: path.basename(f.path),
        extension: path.extname(f.path),
        size: f.size,
        isBinary: !!f.is_binary,
        content: f.content || "",
        lineCount: f.is_binary ? 0 : (f.content ? f.content.split(/\r?\n/).length : 0),
      }));

      const analysis = analyzeProject(proj.name, pid, allFiles);
      projectAnalyses.set(pid, analysis);
      dbSaveProjectAnalysis(pid, analysis);
      indexProject(pid, proj.name, allFiles, analysis);

      proj.github.lastSyncedAt = Date.now();
      proj.github.status = "synced";
      projects.set(pid, proj);

      return res.json({ success: true, message: "Project synchronized successfully!" });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to synchronize GitHub repository" });
    }
  });
}
