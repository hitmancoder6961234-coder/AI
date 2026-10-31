import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import AdmZip from "adm-zip";
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
  deleteProjectKnowledge,
} from "./knowledge-engine.js";
import { analyzeFileDiagnostics } from "./project-diagnostics.js";
import {
  createProject as dbCreateProject,
  getProject as dbGetProject,
  listProjects as dbListProjects,
  updateProject as dbUpdateProject,
  deleteProject as dbDeleteProject,
  createFile as dbCreateFile,
  getFile as dbGetFile,
  getProjectFileByPath as dbGetProjectFileByPath,
  listFiles as dbListFiles,
  updateFile as dbUpdateFile,
  updateFileByPath as dbUpdateFileByPath,
  deleteFile as dbDeleteFile,
  deleteProjectFileByPath as dbDeleteProjectFileByPath,
  renameProjectFolderFiles as dbRenameProjectFolderFiles,
  deleteProjectFolderFiles as dbDeleteProjectFolderFiles,
  saveArchitecture as dbSaveArchitecture,
  saveDiagnostics as dbSaveDiagnostics,
  saveProjectAnalysis as dbSaveProjectAnalysis,
  getProjectAnalysis as dbGetProjectAnalysis,
  deleteProjectAnalysis as dbDeleteProjectAnalysis,
  saveGithubConnection as dbSaveGithubConnection,
  getGithubConnection as dbGetGithubConnection,
  listKnowledgeChunks as dbListKnowledgeChunks,
  saveWorkspaceFile as dbSaveWorkspaceFile,
  getWorkspaceFile as dbGetWorkspaceFile,
  listWorkspaceFiles as dbListWorkspaceFiles,
  deleteWorkspaceFile as dbDeleteWorkspaceFile,
} from "./db.js";
import {
  validateProjectId,
  getProjectStorageDir,
  sanitizeProjectPath,
  resolveProjectFilePath,
  writeProjectFileToDisk,
  readProjectFileFromDisk,
  deleteProjectFileFromDisk,
  renameProjectFileOnDisk,
  createProjectFolderOnDisk,
  renameProjectFolderOnDisk,
  deleteProjectFolderOnDisk,
  deleteProjectStorage,
  listProjectDiskFiles,
  syncDiskFromDatabase,
} from "./project-storage.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

export function getFileCategory(ext: string, name: string): string {
  const lowerExt = (ext || "").toLowerCase();
  const lowerName = (name || "").toLowerCase();

  if ([".js", ".jsx", ".ts", ".tsx", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".swift", ".kt", ".sh", ".bash", ".sql", ".html", ".vue", ".svelte"].includes(lowerExt)) {
    return "code";
  }
  if ([".css", ".scss", ".sass", ".less"].includes(lowerExt)) {
    return "style";
  }
  if ([".json", ".yaml", ".yml", ".xml", ".csv", ".tsv", ".graphql", ".gql"].includes(lowerExt)) {
    return "data";
  }
  if ([".md", ".markdown", ".txt", ".rtf", ".pdf", ".doc", ".docx"].includes(lowerExt)) {
    return "doc";
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

  const langMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".py": "python",
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
    const shared = Array.from(files.values()).filter(
      (f) => (!f.project_id && !f.conversation_id) || f.user_id === user.id
    );
    res.json(shared);
  });

  app.get("/api/files", (req, res) => {
    const user = resolveUser(req) || initialUser;
    const userFiles = Array.from(files.values()).filter(
      (f) => f.user_id === user.id || !f.project_id
    );
    res.json(userFiles);
  });

  app.post("/api/files/upload", upload.any(), async (req, res) => {
    const user = resolveUser(req) || initialUser;
    const uploadedFiles: any[] = [];
    const reqFiles = (req.files as Express.Multer.File[]) || [];
    if (req.file) reqFiles.push(req.file);

    if (reqFiles.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    for (const f of reqFiles) {
      const fid = "file_" + Math.random().toString(36).substr(2, 9);
      const isBinary = /image|pdf|zip|octet-stream|video|audio/i.test(f.mimetype);
      const textContent = isBinary ? null : f.buffer.toString("utf-8");

      const fileItem = {
        id: fid,
        user_id: user.id,
        conversation_id: (req.body && req.body.conversation_id) || null,
        project_id: (req.body && req.body.project_id) || null,
        filename: f.originalname,
        mime: f.mimetype,
        size: f.size,
        file_type: isBinary ? "binary" : "code",
        content: textContent,
        uploaded_at: Math.floor(Date.now() / 1000),
      };

      files.set(fid, fileItem);
      try {
        dbSaveWorkspaceFile({
          id: fid,
          user_id: user.id,
          filename: f.originalname,
          mime: f.mimetype,
          size: f.size,
          content: textContent,
          created_at: Date.now(),
        });
      } catch (e) {
        console.error("Error saving workspace file to db:", e);
      }
      uploadedFiles.push(fileItem);
    }

    res.json({ success: true, files: uploadedFiles, file: uploadedFiles[0] });
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

    res.setHeader("Content-Type", file.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${file.filename}"`);
    res.send(file.content || "");
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
  app.post("/api/projects/upload-zip", upload.single("file"), async (req, res) => {
    const user = resolveUser(req) || initialUser;
    if (!req.file) {
      return res.status(400).json({ error: "No zip file uploaded" });
    }

    try {
      const { files: extractedFiles, error: zipError } = extractZipSecurely(req.file.buffer);
      if (zipError || !extractedFiles || extractedFiles.length === 0) {
        return res.status(400).json({ error: zipError || "Failed to extract files from ZIP archive." });
      }

      let projectId = req.body?.projectId;
      let pItem: any;

      if (projectId && projects.has(projectId)) {
        pItem = projects.get(projectId);
      } else {
        projectId = "proj_" + Math.random().toString(36).substr(2, 9);
        const projName = req.body?.name || req.file.originalname.replace(/\.zip$/i, "") || "Imported Project";
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
          name: projName,
          created_at: pItem.created_at,
          updated_at: pItem.updated_at,
          metadata: JSON.stringify({ user_id: user.id, file_count: extractedFiles.length }),
        });
        createProjectFolderOnDisk(projectId, "/");
      }

      // Write files to disk and DB
      for (const ef of extractedFiles) {
        const cleanPath = sanitizeProjectPath(ef.path);
        if (!cleanPath) continue;

        writeProjectFileToDisk(projectId, cleanPath, ef.content, ef.isBinary ? ef.buffer : undefined);
        const fid = "pf_" + Math.random().toString(36).substr(2, 9);
        const fRec = {
          id: fid,
          project_id: projectId,
          path: cleanPath,
          size: ef.size,
          is_binary: ef.isBinary ? 1 : 0,
          content: ef.content,
          created_at: Date.now(),
          updated_at: Date.now(),
        };
        try {
          dbCreateFile(fRec as any);
        } catch (e) {
          dbUpdateFileByPath(projectId, cleanPath, ef.content, ef.size);
        }

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
          uploaded_at: Math.floor(Date.now() / 1000),
        });
      }

      // Run Analysis & Knowledge Indexing
      const analysis = analyzeProject(pItem.name, projectId, extractedFiles);
      projectAnalyses.set(projectId, analysis);
      try {
        dbSaveProjectAnalysis(projectId, analysis);
        dbSaveArchitecture(projectId, analysis.architecture.nodes, analysis.architecture.edges);
        dbSaveDiagnostics(projectId, (analysis.securityAnalysis?.findings || []).map(f => ({
          file_id: f.file,
          rule_id: f.type,
          severity: f.severity === "high" ? "error" : "warning",
          message: f.description,
          line_number: f.line || 1,
        } as any)));
        indexProject(projectId, pItem.name, extractedFiles, analysis);
      } catch (e) {
        console.error("Analysis/index error:", e);
      }

      // Update project metadata
      pItem.project_type = analysis.projectType;
      pItem.primary_language = analysis.primaryLanguage;
      pItem.file_count = extractedFiles.length;
      pItem.updated_at = Date.now();
      projects.set(projectId, pItem);

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

  app.post("/api/projects/upload-files", upload.array("files"), async (req, res) => {
    const user = resolveUser(req) || initialUser;
    const reqFiles = (req.files as Express.Multer.File[]) || [];
    if (reqFiles.length === 0) {
      return res.status(400).json({ error: "No files provided" });
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
          name: projName,
          created_at: pItem.created_at,
          updated_at: pItem.updated_at,
          metadata: JSON.stringify({ user_id: user.id, file_count: reqFiles.length }),
        });
        createProjectFolderOnDisk(projectId, "/");
      }

      const extractedFiles: ExtractedFile[] = [];

      for (let i = 0; i < reqFiles.length; i++) {
        const f = reqFiles[i];
        let relPath = (paths[i] || f.originalname).replace(/\\/g, "/");
        if (relPath.startsWith("/")) relPath = relPath.slice(1);

        const cleanPath = sanitizeProjectPath(relPath);
        if (!cleanPath) continue;

        const isBinary = /image|pdf|zip|octet-stream|video|audio/i.test(f.mimetype);
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

        writeProjectFileToDisk(projectId, cleanPath, textContent, isBinary ? f.buffer : undefined);
        const fid = "pf_" + Math.random().toString(36).substr(2, 9);
        try {
          dbCreateFile({
            id: fid,
            project_id: projectId,
            path: cleanPath,
            size: f.size,
            is_binary: isBinary ? 1 : 0,
            content: textContent,
            created_at: Date.now(),
            updated_at: Date.now(),
          } as any);
        } catch {
          dbUpdateFileByPath(projectId, cleanPath, textContent, f.size);
        }

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
          uploaded_at: Math.floor(Date.now() / 1000),
        });
      }

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
        indexProject(projectId, pItem.name, allProjectFiles, analysis);
      } catch (e) {
        console.error(e);
      }

      pItem.project_type = analysis.projectType;
      pItem.primary_language = analysis.primaryLanguage;
      pItem.file_count = allProjectFiles.length;
      pItem.updated_at = Date.now();
      projects.set(projectId, pItem);

      return res.json({
        success: true,
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
    const pid = req.params.pid;
    let proj = projects.get(pid);
    if (!proj) {
      const dbP = dbGetProject(pid);
      if (dbP) {
        let meta: any = {};
        try { if (dbP.metadata) meta = JSON.parse(dbP.metadata); } catch {}
        proj = {
          id: dbP.id,
          name: dbP.name,
          description: dbP.description || "",
          source: dbP.source_type || "upload",
          user_id: meta.user_id || initialUser.id,
          project_type: meta.project_type || "other",
          primary_language: meta.primary_language || "text",
          file_count: meta.file_count || 0,
          created_at: dbP.created_at,
          updated_at: dbP.updated_at,
          github: meta.github || undefined,
        };
        projects.set(pid, proj);
      }
    }
    if (!proj) return res.status(404).json({ error: "Project not found" });
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
    const pid = req.params.pid;
    const pFiles = dbListFiles(pid);
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
    const pid = req.params.pid;
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
    const pid = req.params.pid;
    const filePath = String(req.query.path || "");
    if (!filePath) return res.status(400).json({ error: "path parameter is required" });

    const cleanPath = sanitizeProjectPath(filePath);
    let diskContent = readProjectFileFromDisk(pid, cleanPath);
    let dbFile = dbGetProjectFileByPath(pid, cleanPath);

    if (!diskContent && !dbFile) {
      return res.status(404).json({ error: `File not found: ${filePath}` });
    }

    const content = diskContent !== null ? diskContent : (dbFile?.content || "");
    const ext = path.extname(cleanPath);
    const name = path.basename(cleanPath);
    const isBinary = !!dbFile?.is_binary;

    return res.json({
      path: cleanPath,
      name,
      extension: ext,
      size: dbFile?.size || Buffer.byteLength(content, "utf-8"),
      lineCount: isBinary ? 0 : (content ? content.split(/\r?\n/).length : 0),
      isBinary,
      language: detectFileLanguage(ext, name),
      category: getFileCategory(ext, name),
      content,
    });
  });

  app.post("/api/projects/:pid/files", (req, res) => {
    const pid = req.params.pid;
    const { path: rawPath, content = "" } = req.body || {};
    if (!rawPath) return res.status(400).json({ error: "Path is required" });

    const cleanPath = sanitizeProjectPath(rawPath);
    writeProjectFileToDisk(pid, cleanPath, content);

    const fid = "pf_" + Math.random().toString(36).substr(2, 9);
    try {
      dbCreateFile({
        id: fid,
        project_id: pid,
        path: cleanPath,
        size: Buffer.byteLength(content, "utf-8"),
        is_binary: 0,
        content,
        created_at: Date.now(),
        updated_at: Date.now(),
      } as any);
    } catch {
      dbUpdateFileByPath(pid, cleanPath, content, Buffer.byteLength(content, "utf-8"));
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
    const pid = req.params.pid;
    const { path: rawPath, content = "" } = req.body || {};
    if (!rawPath) return res.status(400).json({ error: "Path is required" });

    const cleanPath = sanitizeProjectPath(rawPath);
    writeProjectFileToDisk(pid, cleanPath, content);
    dbUpdateFileByPath(pid, cleanPath, content, Buffer.byteLength(content, "utf-8"));

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

    return res.json({ success: true });
  });

  app.post("/api/projects/:pid/folders", (req, res) => {
    const pid = req.params.pid;
    const rawFolder = req.body?.path || req.body?.folderPath;
    if (!rawFolder) return res.status(400).json({ error: "Folder path required" });

    createProjectFolderOnDisk(pid, rawFolder);
    return res.json({ success: true });
  });

  app.patch("/api/projects/:pid/files/rename", (req, res) => {
    const pid = req.params.pid;
    const { oldPath, newPath } = req.body || {};
    if (!oldPath || !newPath) return res.status(400).json({ error: "oldPath and newPath required" });

    renameProjectFileOnDisk(pid, oldPath, newPath);
    const existing = dbGetProjectFileByPath(pid, sanitizeProjectPath(oldPath));
    if (existing) {
      dbDeleteProjectFileByPath(pid, sanitizeProjectPath(oldPath));
      dbCreateFile({
        id: existing.id,
        project_id: pid,
        path: sanitizeProjectPath(newPath),
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
    const pid = req.params.pid;
    const { oldPath, newPath } = req.body || {};
    if (!oldPath || !newPath) return res.status(400).json({ error: "oldPath and newPath required" });

    renameProjectFolderOnDisk(pid, oldPath, newPath);
    dbRenameProjectFolderFiles(pid, sanitizeProjectPath(oldPath), sanitizeProjectPath(newPath));
    return res.json({ success: true });
  });

  app.delete("/api/projects/:pid/files", (req, res) => {
    const pid = req.params.pid;
    const rawPath = String(req.query.path || req.body?.path || "");
    if (!rawPath) return res.status(400).json({ error: "path required" });

    const cleanPath = sanitizeProjectPath(rawPath);
    deleteProjectFileFromDisk(pid, cleanPath);
    dbDeleteProjectFileByPath(pid, cleanPath);
    deleteFileKnowledge(pid, cleanPath);
    return res.json({ success: true });
  });

  app.delete("/api/projects/:pid/folders", (req, res) => {
    const pid = req.params.pid;
    const rawFolder = String(req.query.folderPath || req.query.path || req.body?.folderPath || req.body?.path || "");
    if (!rawFolder) return res.status(400).json({ error: "folderPath required" });

    const cleanFolder = sanitizeProjectPath(rawFolder);
    deleteProjectFolderOnDisk(pid, cleanFolder);
    dbDeleteProjectFolderFiles(pid, cleanFolder);
    return res.json({ success: true });
  });

  app.get("/api/projects/:pid/files/download", (req, res) => {
    const pid = req.params.pid;
    const rawPath = String(req.query.path || "");
    if (!rawPath) return res.status(400).send("Path required");

    const cleanPath = sanitizeProjectPath(rawPath);
    const content = readProjectFileFromDisk(pid, cleanPath);
    const name = path.basename(cleanPath);

    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(content || "");
  });

  app.get("/api/projects/:pid/export-zip", (req, res) => {
    const pid = req.params.pid;
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
    const pid = req.params.pid;
    const chunks = dbListKnowledgeChunks(pid);
    res.json({ chunks, total: chunks.length });
  });

  app.post("/api/projects/:pid/knowledge/reindex", (req, res) => {
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
    const analysis = projectAnalyses.get(pid) || analyzeProject(proj?.name || "Project", pid, extracted);
    indexProject(pid, proj?.name || "Project", extracted, analysis);
    res.json({ ok: true, count: extracted.length });
  });

  app.get("/api/projects/:pid/knowledge/search", (req, res) => {
    const pid = req.params.pid;
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
      const result = await analyzeFileDiagnostics(filePath || "file.ts", content || "");
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Diagnostics failed" });
    }
  });

  app.post("/api/projects/:pid/diagnostics/project", async (req, res) => {
    const pid = req.params.pid;
    const pFiles = dbListFiles(pid).filter((f) => !f.is_binary);
    let allIssues: any[] = [];
    let summary = { errors: 0, warnings: 0, suggestions: 0 };

    for (const f of pFiles.slice(0, 15)) {
      try {
        const diag = await analyzeFileDiagnostics(f.path, f.content || "");
        if (diag.issues && diag.issues.length > 0) {
          allIssues.push(...diag.issues);
        }
        if (diag.summary) {
          summary.errors += diag.summary.errors || 0;
          summary.warnings += diag.summary.warnings || 0;
          summary.suggestions += diag.summary.suggestions || 0;
        }
      } catch {}
    }

    res.json({ issues: allIssues, summary });
  });

  app.post("/api/projects/:pid/explain-architecture", async (req, res) => {
    const pid = req.params.pid;
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
    const pid = req.params.pid;
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
          dbUpdateFileByPath(pid, sanitizeProjectPath(item.path), item.content || "", Buffer.byteLength(item.content || "", "utf-8"));
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
        "User-Agent": "Clarity-AI-Assistant",
        Accept: "application/vnd.github.v3+json",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const repoResp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
      if (!repoResp.ok) {
        const errJson = await repoResp.json().catch(() => ({}));
        throw new Error(errJson.message || `GitHub repo returned status ${repoResp.status}`);
      }
      const repoData = await repoResp.json();

      const branchResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`, { headers });
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
        "User-Agent": "Clarity-AI-Assistant",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      // Download archive
      const zipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(branch)}`;
      const archiveResp = await fetch(zipUrl, { headers });
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
        name: projName,
        created_at: pItem.created_at,
        updated_at: pItem.updated_at,
        metadata: JSON.stringify({
          user_id: user.id,
          github: pItem.github,
          file_count: extractedFiles.length,
        }),
      });
      createProjectFolderOnDisk(projectId, "/");

      for (const ef of extractedFiles) {
        const cleanPath = sanitizeProjectPath(ef.path);
        if (!cleanPath) continue;

        writeProjectFileToDisk(projectId, cleanPath, ef.content, ef.isBinary ? ef.buffer : undefined);
        const fid = "pf_" + Math.random().toString(36).substr(2, 9);
        try {
          dbCreateFile({
            id: fid,
            project_id: projectId,
            path: cleanPath,
            size: ef.size,
            is_binary: ef.isBinary ? 1 : 0,
            content: ef.content,
            created_at: Date.now(),
            updated_at: Date.now(),
          } as any);
        } catch {
          dbUpdateFileByPath(projectId, cleanPath, ef.content, ef.size);
        }

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
          uploaded_at: Math.floor(Date.now() / 1000),
        });
      }

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
    const pid = req.params.pid;
    const proj = projects.get(pid);
    if (!proj || !proj.github) {
      return res.status(400).json({ error: "Project is not linked to a GitHub repository" });
    }

    try {
      const { owner, repo, branch = "main" } = proj.github;
      const headers: Record<string, string> = { "User-Agent": "Clarity-AI-Assistant" };
      const zipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(branch)}`;
      const archiveResp = await fetch(zipUrl, { headers });
      if (!archiveResp.ok) throw new Error(`HTTP ${archiveResp.status} while fetching repository`);

      const arrayBuf = await archiveResp.arrayBuffer();
      const zipBuffer = Buffer.from(arrayBuf);
      const { files: extractedFiles } = extractZipSecurely(zipBuffer);

      for (const ef of extractedFiles) {
        const cleanPath = sanitizeProjectPath(ef.path);
        if (!cleanPath) continue;

        writeProjectFileToDisk(pid, cleanPath, ef.content, ef.isBinary ? ef.buffer : undefined);
        dbUpdateFileByPath(pid, cleanPath, ef.content, ef.size);
      }

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
