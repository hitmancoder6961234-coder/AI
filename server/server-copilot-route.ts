app.post("/api/projects/:pid/apply-changes", async (req, res) => {
  const pid = req.params.pid;
  const proj = projects.get(pid);
  if (!proj) return res.status(404).json({ error: "Project not found" });

  const { plan } = req.body || {};
  if (!plan || plan.type !== "code_change" || !plan.files) {
    return res.status(400).json({ error: "Invalid change plan" });
  }

  try {
    for (const f of plan.files) {
      if (!f.path || f.content == null) continue;
      
      const pFiles = Array.from(files.values()).filter(file => file.project_id === pid);
      let targetFile = pFiles.find(file => file.filename === f.path || file.filename.endsWith("/" + f.path));
      
      if (targetFile) {
        // Update existing file
        targetFile.content = f.content;
        targetFile.size = Buffer.byteLength(f.content, "utf-8");
      } else {
        // Create new file
        const newFileId = "file_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
        files.set(newFileId, {
          id: newFileId,
          project_id: pid,
          filename: f.path,
          file_type: "text/plain", // Assume text for code
          size: Buffer.byteLength(f.content, "utf-8"),
          content: f.content,
          created_at: Date.now()
        });
      }
    }

    // Re-index project
    projectAnalyses.delete(pid);
    const pFiles = Array.from(files.values()).filter((f) => f.project_id === pid);
    const extracted: ExtractedFile[] = pFiles.map((f) => ({
      path: f.filename,
      name: path.basename(f.filename),
      extension: path.extname(f.filename).toLowerCase(),
      size: f.size,
      isBinary: f.file_type === "binary",
      content: f.content,
      lineCount: f.content ? f.content.split(/\r?\n/).length : 0,
    }));
    const analysis = analyzeProject(proj.name, pid, extracted);
    projectAnalyses.set(pid, analysis);

    res.json({ ok: true, message: "Changes applied successfully" });
  } catch (err: any) {
    console.error("Apply changes error:", err);
    res.status(500).json({ error: err.message });
  }
});
