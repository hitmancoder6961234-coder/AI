import React, { useState, useEffect } from "react";

export default function ProjectWorkspace({ route }) {
  const [projectId, setProjectId] = useState(null);
  const [project, setProject] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [health, setHealth] = useState(null);

  // Extract projectId from route
  useEffect(() => {
    const match = route ? route.match(/#\/project(?:\/([^\/]+))?/) : null;
    setProjectId(match && match[1] ? match[1] : null);
  }, [route]);

  // Load data
  useEffect(() => {
    if (!route) return;
    setLoading(true);
    if (projectId) {
      fetch(`/api/projects/${projectId}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => {
          setProject(d);
          return fetch(`/api/projects/${projectId}/intelligence`, { credentials: "include" });
        })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) setHealth(d.project_health || d.health || null); })
        .catch(() => setError("Failed to load project."))
        .finally(() => setLoading(false));
    } else {
      fetch(`/api/projects`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => setProjects(d.projects || []))
        .catch(() => setError("Failed to load projects."))
        .finally(() => setLoading(false));
    }
  }, [route, projectId]);

  // Loading state
  if (loading) {
    return React.createElement(
      "div", { className: "project-workspace" },
      React.createElement("div", { className: "p-8 text-center text-muted" }, "Loading project workspace...")
    );
  }

  // Error state
  if (error) {
    return React.createElement(
      "div", { className: "project-workspace" },
      React.createElement("div", { className: "p-8 text-center text-danger" }, error)
    );
  }

  // List view
  if (!projectId) {
    const listHeader = React.createElement("h1", { style: { fontSize: 28, fontWeight: 700, marginBottom: 4 } }, "Project Workspace");
    const listSubtitle = React.createElement("p", { style: { color: "var(--ink-faint)", marginBottom: 24 } }, "Select a project to analyze, understand, and improve.");
    const listContent = projects.length === 0
      ? React.createElement("div", { className: "empty-state", style: { padding: 40, textAlign: "center", color: "var(--ink-faint)" } },
          React.createElement("h3", { style: { fontSize: 18, fontWeight: 600, marginBottom: 8 } }, "No projects yet."),
          React.createElement("p", {}, "Upload a ZIP or create a new project to begin."),
          React.createElement("div", { style: { marginTop: 24, display: "flex", gap: 12, justifyContent: "center" } },
            React.createElement("button", { className: "btn btn--primary", onClick: () => { const name = prompt("Project name:", "My Project"); if (name) fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name }) }).then(r => r.json()).then(d => window.location.hash = "#/project/" + d.id); } }, "New Project"),
            React.createElement("label", { className: "btn btn--outline", style: { cursor: "pointer" } }, "Upload ZIP",
              React.createElement("input", { type: "file", hidden: true, accept: ".zip", onChange: async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const fd = new FormData();
                  fd.append("file", f, f.name);
                  fd.append("name", f.name.replace(/\.zip$/i, ""));
                  try {
                    let resData;
                    if (window.Clarity?.api?.upload) {
                      resData = await window.Clarity.api.upload("/api/projects/upload-zip", fd);
                    } else {
                      const res = await fetch("/api/projects/upload-zip", { method: "POST", body: fd, credentials: "include" });
                      const text = await res.text();
                      try { resData = JSON.parse(text); } catch { resData = { error: text }; }
                      if (!res.ok) throw new Error((resData && resData.error) || "ZIP upload failed");
                    }
                    if (resData && resData.project && resData.project.id) {
                      window.location.hash = "#/project/" + resData.project.id;
                    }
                  } catch (err) {
                    console.error("ZIP upload error:", err);
                    if (window.Clarity?.toast?.show) {
                      window.Clarity.toast.show("ZIP upload failed: " + (err.message || "Unknown error"), "danger");
                    } else {
                      alert("ZIP upload failed: " + (err.message || "Unknown error"));
                    }
                  }
                }
              } })
            )
          )
        )
      : React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 12 } },
          projects.map((p) => React.createElement("a", { key: p.id, href: "#/project/" + p.id, className: "project-card", style: { textDecoration: "none", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, minWidth: 240, flex: "1 1 0", display: "block" } },
            React.createElement("h3", { style: { fontSize: 16, fontWeight: 700, color: "var(--ink)", marginBottom: 4, display: "flex", justifyContent: "space-between", alignItems: "center" } }, 
              React.createElement("span", {}, p.name || p.id),
              p.github ? React.createElement("span", { style: { fontSize: 11, background: "#24292e", color: "#fff", padding: "2px 6px", borderRadius: 4, fontWeight: 600 } }, `${p.github.owner}/${p.github.repo}`) : null
            ),
            React.createElement("div", { style: { fontSize: 12, color: "var(--ink-faint)", marginBottom: 8 } }, p.github ? `GitHub: ${p.github.branch}` : `Project: ${p.id}`),
            React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" } },
              React.createElement("div", { style: { display: "flex", gap: 8, fontSize: 12, color: "var(--primary)", fontWeight: 600 } },
                React.createElement("span", {}, "Open"),
                React.createElement("span", {}, health ? `Health: ${health?.technical_health_score || 0}` : "Not analyzed")
              ),
              React.createElement("button", { 
                className: "btn btn--sm", 
                style: { background: "var(--danger, #dc2626)", color: "white", border: "none", padding: "4px 8px", fontSize: 11, cursor: "pointer", borderRadius: 4 },
                onClick: (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (confirm(`Are you sure you want to permanently delete project "${p.name || p.id}"?`)) {
                    fetch("/api/projects/" + p.id, { method: "DELETE", credentials: "include" })
                      .then(r => {
                        if (!r.ok) throw new Error("Delete failed with status " + r.status);
                        return r.json();
                      })
                      .then(() => {
                        setProjects(prev => prev.filter(proj => proj.id !== p.id));
                      })
                      .catch(err => {
                        console.error("Failed to delete project", err);
                        alert("Could not delete project: " + (err.message || "Unknown error"));
                      });
                  }
                }
              }, "Delete")
            )
          ))
        );

    return React.createElement("div", { className: "project-workspace", style: { maxWidth: 1200, margin: "0 auto", padding: 24, color: "var(--ink)", fontFamily: "var(--font-body)", minHeight: "100vh" } },
      listHeader,
      listSubtitle,
      listContent
    );
  }

  const projectName = (project && project.name) ? project.name : (projectId || "Unknown");
  const healthScore = (health && health.technical_health_score != null) ? health.technical_health_score : 0;
  const healthStatus = healthScore >= 80 ? "Healthy" : healthScore >= 50 ? "Needs Work" : healthScore > 0 ? "Critical" : "Not analyzed";
  const fileCount = (project && project.file_count != null) ? project.file_count : 0;

  // Get real metrics from health/intelligence data if available
  const metricsFiles = (health && health.metrics && health.metrics.files_analyzed != null) ? health.metrics.files_analyzed : fileCount;
  const metricsSymbols = (health && health.metrics && health.metrics.symbols != null) ? health.metrics.symbols : 0;
  const metricsApis = (health && health.metrics && health.metrics.apis != null) ? health.metrics.apis : 0;

  const sections = [
    { label: "Overview", href: `#/project/${projectId}` },
    { label: "Collection", href: `#/project/${projectId}/collection` },
    { label: "Analysis", href: `#/project/${projectId}/analysis` },
    { label: "Architecture", href: `#/project/${projectId}/architecture` },
    { label: "Intelligence", href: `#/project/${projectId}/intelligence` },
    { label: "Copilot", href: `#/project/${projectId}/chat` },
    { label: "Debug", href: `#/project/${projectId}/debug` },
    { label: "Patches", href: `#/project/${projectId}/patch` },
    { label: "Versions", href: `#/project/${projectId}/versions` },
  ];

  return React.createElement("div", { className: "project-workspace", style: { maxWidth: 1200, margin: "0 auto", padding: 24, color: "var(--ink)", fontFamily: "var(--font-body)", minHeight: "100vh" } },
    React.createElement("header", { style: { marginBottom: 24, borderBottom: "1px solid var(--line)", paddingBottom: 16 } },
      React.createElement("h1", { style: { fontSize: 28, fontWeight: 700, marginBottom: 4, color: "var(--ink)" } }, `Project: ${projectName}`),
      React.createElement("p", { style: { color: "var(--ink-faint)", fontSize: 13, marginBottom: 12 } }, `ID: ${projectId}`),
      React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } },
        React.createElement("span", { style: { fontSize: 12, color: "var(--ink-faint)", padding: "2px 8px", borderRadius: 4, border: "1px solid var(--line)", background: "var(--surface)" } }, `Health: ${healthScore}`),
        React.createElement("span", { style: { fontSize: 12, fontWeight: 600, color: healthScore >= 80 ? "#10b981" : healthScore >= 50 ? "#f59e0b" : healthScore > 0 ? "#ef4444" : "#64748b" } }, healthStatus)
      ),
      React.createElement("nav", { style: { marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" } },
        sections.map((s) => React.createElement("a", { key: s.label, href: s.href, className: "btn btn--outline btn--sm", style: { textDecoration: "none", fontSize: 12, fontWeight: 600 } }, s.label))
      )
    ),
    React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 } },
      [
        { label: "Project Status", value: healthStatus, color: healthScore >= 80 ? "#10b981" : healthScore >= 50 ? "#f59e0b" : healthScore > 0 ? "#ef4444" : "#64748b" },
        { label: "Analysis", value: healthScore > 0 ? "Analyzed" : "Not analyzed", color: healthScore > 0 ? "#10b981" : "#64748b" },
        { label: "Files", value: fileCount, color: "var(--ink)" },
        { label: "Symbols", value: metricsSymbols, color: "var(--ink)" },
        { label: "APIs", value: metricsApis, color: "var(--ink)" },
      ].map((m) => React.createElement("div", { key: m.label, style: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, minWidth: 140, flex: "1 1 0" } },
        React.createElement("div", { style: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-faint)", marginBottom: 4 } }, m.label),
        React.createElement("div", { style: { fontSize: 18, fontWeight: 600, color: m.color } }, String(m.value))
      ))
    ),
    React.createElement("section", { style: { background: "var(--surface)", borderRadius: 12, padding: 24, border: "1px solid var(--line)" } },
      React.createElement("h2", { style: { fontSize: 18, fontWeight: 700, marginBottom: 12 } }, "Project Workflow"),
      React.createElement("p", { style: { fontSize: 13, color: "var(--ink)", lineHeight: 1.6 } }, "Overview → Collection → Analysis → Architecture → Intelligence → Copilot → Debug → Patch Agent → Versions")
    )
  );
}
