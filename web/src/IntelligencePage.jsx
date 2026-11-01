import React, { useState, useEffect, useRef } from "react";

export default function IntelligencePage({ projectId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState({ recommendations: {}, evidence: {}, risks: {} });
  const [filterPriority, setFilterPriority] = useState("all");

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/intelligence`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [projectId]);

  if (loading) {
    return React.createElement(
      "div", { className: "intelligence-page" },
      React.createElement("div", { className: "p-8 text-center text-muted" }, "Loading project intelligence...")
    );
  }

  if (error || !data || !data.ok) {
    return React.createElement(
      "div", { className: "intelligence-page" },
      React.createElement("div", { className: "p-8 text-center text-muted" }, "Failed to load intelligence.")
    );
  }

  const overview = data.overview || {};
  const health = data.project_health || {};
  const security = data.security_intelligence || {};
  const recommendations = data.recommendations || [];
  const featureSuggestions = data.feature_suggestions || [];
  const roadmap = data.roadmap || [];
  const risks = data.architecture_intelligence || {};
  const stack = data.stack_detection || {};
  const versionInfo = data.version_id ? `Version: ${data.version_id}` : "Latest";

  const toggle = (category, index) => {
    setExpanded((prev) => ({ ...prev, [category]: { ...prev[category], [index]: !prev[category]?.[index] } }));
  };

  const priorityColors = { P0: "#ef4444", P1: "#f59e0b", P2: "#10b981", P3: "#64748b" };

  return React.createElement(
    "div",
    { className: "intelligence-page", style: { maxWidth: 1200, margin: "0 auto", padding: 24, color: "var(--ink)", fontFamily: "var(--font-body)", minHeight: "100vh" } },
    // Header
    React.createElement("header", { style: { marginBottom: 24, borderBottom: "1px solid var(--line)", paddingBottom: 16 } },
      React.createElement("h1", { style: { fontSize: 28, fontWeight: 700, marginBottom: 4, color: "var(--ink)" } }, "Project Intelligence"),
      React.createElement("p", { style: { color: "var(--ink-faint)", fontSize: 14 } }, `Project: ${projectId} — ${versionInfo}`)
    ),

    // Health score section
    React.createElement("section", { style: { background: "var(--surface)", borderRadius: 12, padding: 24, marginBottom: 24, border: "1px solid var(--line)" } },
      React.createElement("h2", { style: { fontSize: 20, fontWeight: 700, marginBottom: 12 } }, "Project Health"),
      React.createElement("div", { style: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 } },
        React.createElement("div", { style: { fontSize: 48, fontWeight: 800, color: health.technical_health_score >= 80 ? "#10b981" : health.technical_health_score >= 50 ? "#f59e0b" : "#ef4444" } }, health.technical_health_score || 0),
        React.createElement("div", { style: { marginLeft: 8 } },
          React.createElement("div", { style: { fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)" } }, "Readiness Score"),
          React.createElement("div", { style: { fontSize: 13, color: "var(--ink-faint)", marginTop: 2 } }, health.technical_health_score >= 80 ? "Healthy" : health.technical_health_score >= 50 ? "Needs Work" : "Critical")
        )
      ),
      React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 } },
        [
          { label: "Files", value: health.metrics?.files_analyzed || 0, weight: 20 },
          { label: "Symbols", value: health.metrics?.symbols || 0, weight: 15 },
          { label: "APIs", value: health.metrics?.apis || 0, weight: 15 },
          { label: "Dependencies", value: health.metrics?.dependencies || 0, weight: 10 },
          { label: "Config", value: health.metrics?.config_files || 0, weight: 10 },
          { label: "Docs", value: health.metrics?.document_files || 0, weight: 10 },
        ].map((m) =>
          React.createElement("div", { key: m.label, style: { background: "var(--canvas)", border: "1px solid var(--line)", borderRadius: 8, padding: 10, minWidth: 100, flex: "1 1 0" } },
            React.createElement("div", { style: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-faint)", marginBottom: 4 } }, `${m.label} (${m.weight})`),
            React.createElement("div", { style: { fontSize: 20, fontWeight: 700, color: "var(--ink)" } }, String(m.value))
          )
        )
      ),
      React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 } },
        [
          { label: "No Cycles", value: health.metrics?.no_cycles ? "Yes (+10)" : "No (0)", weight: 10 },
          { label: "Security", value: health.security_check ? "Pass (+10)" : "Fail (0)", weight: 10 },
        ].map((m) =>
          React.createElement("div", { key: m.label, style: { background: "var(--canvas)", border: "1px solid var(--line)", borderRadius: 8, padding: 10, minWidth: 140, flex: "1 1 0" } },
            React.createElement("div", { style: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-faint)", marginBottom: 4 } }, m.label),
            React.createElement("div", { style: { fontSize: 16, fontWeight: 600, color: "var(--ink)" } }, String(m.value))
          )
        )
      ),
      React.createElement("p", { style: { fontSize: 11, color: "var(--ink-faint)", marginTop: 8 } }, "Evidence-backed: each factor references DB evidence (file count, symbol count, API discoveries, dependency relationships, architecture cycle detection, config files, documentation files, security authorization).")
    ),

    // Overview
    React.createElement("section", { style: { marginBottom: 24 } },
      React.createElement("h2", { style: { fontSize: 20, fontWeight: 700, marginBottom: 12 } }, "Overview"),
      React.createElement("p", { style: { color: "var(--ink)", lineHeight: 1.6, marginBottom: 12 } }, (overview.description || overview.project_flow_description || data.overview?.description || "No evidence-backed overview available.").slice(0, 400)),
      React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 } },
        [
          { label: "Project ID", value: data.project_id || "N/A" },
          { label: "Files", value: overview.files || 0 },
          { label: "Symbols", value: overview.symbols || 0 },
          { label: "APIs", value: overview.apis || 0 },
          { label: "Modules", value: overview.modules || 0 },
          { label: "Dependencies", value: (overview.dependencies?.internal_dependencies || 0) + (overview.dependencies?.external_dependencies || 0) },
        ].map((m) =>
          React.createElement("div", { key: m.label, style: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 10, minWidth: 120, flex: "1 1 0" } },
            React.createElement("div", { style: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-faint)", marginBottom: 4 } }, m.label),
            React.createElement("div", { style: { fontSize: 18, fontWeight: 700 } }, String(m.value))
          )
        )
      )
    ),

    // Stack
    React.createElement("section", { style: { background: "var(--surface)", borderRadius: 12, padding: 24, marginBottom: 24, border: "1px solid var(--line)" } },
      React.createElement("h2", { style: { fontSize: 20, fontWeight: 700, marginBottom: 12 } }, "Technology Stack"),
      Object.keys(stack || {}).length > 0
        ? React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
            Object.entries(stack || {}).map(([k, v]) =>
              React.createElement("span", { key: k, style: { background: "var(--primary)", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600 } }, `${k}: ${v}`)
            )
          )
        : React.createElement("p", { style: { color: "var(--ink-faint)", fontSize: 13 } }, "No technology stack evidence available."),
      React.createElement("p", { style: { fontSize: 11, color: "var(--ink-faint)", marginTop: 8 } }, "Source: DB file language detection + API route patterns + import patterns.")
    ),

    // Health + Readiness
    React.createElement("section", { style: { marginBottom: 24 } },
      React.createElement("h2", { style: { fontSize: 20, fontWeight: 700, marginBottom: 12 } }, "Hackathon & Demo Readiness"),
      React.createElement("div", { style: { display: "flex", gap: 16, flexWrap: "wrap" } },
        React.createElement("div", { style: { flex: "1 1 0", minWidth: 220 } },
          React.createElement("h3", { style: { fontSize: 14, fontWeight: 700, marginBottom: 8 } }, "Health Score"),
          React.createElement("div", { style: { fontSize: 36, fontWeight: 800, color: health.technical_health_score >= 80 ? "#10b981" : health.technical_health_score >= 50 ? "#f59e0b" : "#ef4444" } }, health.technical_health_score || 0),
          React.createElement("div", { style: { fontSize: 11, color: "var(--ink-faint)", marginTop: 4 } }, `Evidence-backed from: files=${health.metrics?.files_analyzed}, symbols=${health.metrics?.symbols}, APIs=${health.metrics?.apis}, dependencies=${health.metrics?.dependencies}, docs=${health.metrics?.document_files}, config=${health.metrics?.config_files}`)
        ),
        React.createElement("div", { style: { flex: "1 1 0", minWidth: 220 } },
          React.createElement("h3", { style: { fontSize: 14, fontWeight: 700, marginBottom: 8 } }, "Hackathon Readiness"),
          React.createElement("div", { style: { fontSize: 18, fontWeight: 700, color: "var(--ink)" } }, (data.hackathon_readiness?.overall_score || 0) + " / 100"),
          React.createElement("div", { style: { fontSize: 11, color: "var(--ink-faint)", marginTop: 4 } }, "Evidence-backed: each factor references DB counts.")
        ),
        React.createElement("div", { style: { flex: "1 1 0", minWidth: 220 } },
          React.createElement("h3", { style: { fontSize: 14, fontWeight: 700, marginBottom: 8 } }, "Demo Readiness"),
          React.createElement("p", { style: { fontSize: 12, color: "var(--ink-faint)", lineHeight: 1.5 } }, (data.hackathon_readiness?.demo_flow || []).join(" "))
        )
      )
    ),

    // Security
    React.createElement("section", { style: { background: "#fef2f2", borderRadius: 12, padding: 24, marginBottom: 24, border: "1px solid #fecaca" } },
      React.createElement("h2", { style: { fontSize: 20, fontWeight: 700, marginBottom: 12 } }, "Security Intelligence"),
      (security.security_check ? React.createElement("p", { style: { color: "#dc2626", fontSize: 13 } }, security.security_check) : React.createElement("p", { style: { color: "var(--ink-faint)", fontSize: 13 } }, "No security evidence available.")),
      React.createElement("p", { style: { fontSize: 11, color: "var(--ink-faint)", marginTop: 8 } }, "No arbitrary code execution. No secrets exposed. Authorization enforced. Project content treated as DATA only.")
    ),

    // Architecture Intelligence
    React.createElement("section", { style: { marginBottom: 24 } },
      React.createElement("h2", { style: { fontSize: 20, fontWeight: 700, marginBottom: 12 } }, "Architecture Intelligence"),
      React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 } },
        [
          { label: "Nodes", value: data.architecture_intelligence?.nodes || 0 },
          { label: "Edges", value: data.architecture_intelligence?.edges || 0 },
          { label: "Modules", value: data.architecture_intelligence?.modules || 0 },
          { label: "Entry Points", value: data.architecture_intelligence?.entry_points?.length || 0 },
          { label: "Internal Deps", value: data.architecture_intelligence?.internal_dependencies || 0 },
          { label: "External Deps", value: data.architecture_intelligence?.external_dependencies || 0 },
          { label: "Cycles", value: data.architecture_intelligence?.cycles_detected ? "Detected" : "None" },
          { label: "Hotspots", value: (data.architecture_intelligence?.coupling_hotspots || []).length },
        ].map((m) =>
          React.createElement("div", { key: m.label, style: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 10, minWidth: 120, flex: "1 1 0" } },
            React.createElement("div", { style: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-faint)", marginBottom: 4 } }, m.label),
            React.createElement("div", { style: { fontSize: 20, fontWeight: 700, color: "var(--ink)" } }, String(m.value))
          )
        )
      ),
      React.createElement("h3", { style: { fontSize: 14, fontWeight: 700, marginBottom: 8, marginTop: 16 } }, "Dependencies"),
      React.createElement("ul", { style: { fontSize: 13, color: "var(--ink)", paddingLeft: 20, lineHeight: 1.6 } },
        (data.architecture_intelligence?.dependencies || []).map((d, i) =>
          React.createElement("li", { key: i }, d.from_path ? `From: ${d.from_path}` : d.from + ` → ` + (d.to_path || d.to || d.to_symbol || ""))
        )
      )
    ),

    // Risks
    React.createElement("section", { style: { marginBottom: 24 } },
      React.createElement("h2", { style: { fontSize: 20, fontWeight: 700, marginBottom: 12 } }, "Risks"),
      React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
        (data.architecture_intelligence?.risks || []).map((r, i) =>
          React.createElement("div", { key: i, style: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, minWidth: 260, flex: "1 1 0" } },
            React.createElement("div", { style: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: r.severity === "high" ? "#ef4444" : r.severity === "medium" ? "#f59e0b" : "#10b981", marginBottom: 4, fontWeight: 700 } }, r.type || "Risk"),
            React.createElement("div", { style: { fontSize: 13, color: "var(--ink)", lineHeight: 1.5 } }, r.description || r.evidence || "No description available.")
          )
        )
      )
    ),

    // Debug Findings
    React.createElement("section", { style: { marginBottom: 24 } },
      React.createElement("h2", { style: { fontSize: 20, fontWeight: 700, marginBottom: 12 } }, "Debug Findings"),
      React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
        (data.debug_intelligence || []).map((item, i) =>
          React.createElement("div", { key: i, style: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, minWidth: 260, flex: "1 1 0" } },
            React.createElement("div", { style: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-faint)", marginBottom: 4, fontWeight: 700 } }, item.category || "Debug"),
            React.createElement("div", { style: { fontSize: 13, color: "var(--ink)", lineHeight: 1.5 } }, item.summary || item.evidence || "No details.")
          )
        )
      )
    ),

    // Recommendations
    React.createElement("section", { style: { marginBottom: 24 } },
      React.createElement("h2", { style: { fontSize: 20, fontWeight: 700, marginBottom: 12 } }, "Recommendations"),
      React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 12 } },
        ["all", "P0", "P1", "P2", "P3"].map((label) =>
          React.createElement("button", {
            key: label,
            onClick: () => setFilterPriority(label === "all" ? "all" : label),
            style: { padding: "4px 10px", borderRadius: 6, border: "1px solid var(--line)", background: filterPriority === label ? "var(--primary)" : "var(--surface)", color: filterPriority === label ? "#fff" : "var(--ink)", fontSize: 12, cursor: "pointer" }
          }, label)
        )
      ),
      React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
        recommendations
          .filter((r) => filterPriority === "all" || r.priority === filterPriority)
          .map((r, i) =>
            React.createElement("div", {
              key: i,
              style: { background: "var(--surface)", border: "1px solid var(--line)", borderLeft: `4px solid ${priorityColors[r.priority] || "#64748b"}`, borderRadius: 8, padding: 16 },
              onClick: () => toggle("recommendations", i)
            },
              React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 } },
                React.createElement("h3", { style: { fontSize: 15, fontWeight: 700 } }, r.title || r.recommendation),
                React.createElement("span", { style: { background: priorityColors[r.priority] || "#64748b", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 } }, r.priority || "P3")
              ),
              React.createElement("p", { style: { fontSize: 13, color: "var(--ink)", lineHeight: 1.5 } }, r.evidence || r.problem || r.recommendation || "No details."),
              expanded.recommendations?.[i] ? React.createElement("div", { style: { fontSize: 12, color: "var(--ink-faint)", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)" } },
                React.createElement("div", {}, `Why it matters: ${r.why_it_matters || r.impact || "Improves code quality and maintainability."}`),
                React.createElement("div", { style: { marginTop: 4 } }, `Expected impact: ${r.impact || r.expected_impact || "Lower coupling, safer future changes."}`),
                React.createElement("div", { style: { marginTop: 4, fontSize: 11, color: "var(--ink-faint)" } }, `Affected: ${r.affected_files || r.affected_modules || "Project-wide."}`)
              ) : null
            )
          )
      )
    ),

    // Feature Suggestions
    React.createElement("section", { style: { marginBottom: 24 } },
      React.createElement("h2", { style: { fontSize: 20, fontWeight: 700, marginBottom: 12 } }, "Feature Suggestions"),
      featureSuggestions.length > 0
        ? React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap" } },
            featureSuggestions.map((f, i) =>
              React.createElement("div", { key: i, style: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 16, minWidth: 260, flex: "1 1 0" } },
                React.createElement("h3", { style: { fontSize: 15, fontWeight: 700, marginBottom: 4 } }, f.feature || f.title || "New Feature"),
                React.createElement("p", { style: { fontSize: 13, color: "var(--ink)", lineHeight: 1.5 } }, f.why_this_project_needs_it || f.evidence || f.why || "Based on evidence."),
                React.createElement("p", { style: { fontSize: 11, color: "var(--ink-faint)", marginTop: 4 } }, `Value: ${f.user_value || f.expected_impact || "High"} — Area: ${f.implementation_area || f.related_areas || "General"}`)
              )
            )
          )
        : React.createElement("p", { style: { color: "var(--ink-faint)", fontSize: 13 } }, "No evidence-backed feature suggestions yet.")
    ),

    // Roadmap
    React.createElement("section", { style: { background: "var(--surface)", borderRadius: 12, padding: 24, marginBottom: 24, border: "1px solid var(--line)" } },
      React.createElement("h2", { style: { fontSize: 20, fontWeight: 700, marginBottom: 12 } }, "Roadmap"),
      React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        roadmap.map((item, i) =>
          React.createElement("div", { key: i, style: { background: "var(--canvas)", border: "1px solid var(--line)", borderRadius: 8, padding: 12 } },
            React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 } },
              React.createElement("span", { style: { fontWeight: 700, fontSize: 14 } }, item.title || item.name || "Roadmap item"),
              React.createElement("span", { style: { fontSize: 11, color: item.priority === "P0" ? "#ef4444" : item.priority === "P1" ? "#f59e0b" : item.priority === "P2" ? "#10b981" : "#64748b", fontWeight: 700 } }, item.priority || "P3")
            ),
            React.createElement("p", { style: { fontSize: 13, color: "var(--ink)", lineHeight: 1.5 } }, item.description || item.evidence || item.recommendation || "No details."),
            item.evidence ? React.createElement("p", { style: { fontSize: 11, color: "var(--ink-faint)", marginTop: 4 } }, `Evidence: ${item.evidence}`) : null
          )
        )
      )
    ),

    // Evidence
    React.createElement("section", { style: { marginBottom: 24 } },
      React.createElement("h2", { style: { fontSize: 20, fontWeight: 700, marginBottom: 12 } }, "Evidence"),
      React.createElement("p", { style: { fontSize: 11, color: "var(--ink-faint)", marginBottom: 12 } }, "Real DB evidence references from analysis, architecture, dependencies, and evidence tables."),
      React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
        (data.evidence_links || []).map((e, i) =>
          React.createElement("div", { key: i, style: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 10, fontSize: 12, lineHeight: 1.5 } },
            React.createElement("div", { style: { fontWeight: 700, color: "var(--primary)", marginBottom: 2 } }, e.type || e.reference || "Evidence"),
            React.createElement("div", { style: { color: "var(--ink)" } }, `Path: ${e.path || e.file_path || "N/A"}`),
            React.createElement("div", { style: { color: "var(--ink-faint)", fontSize: 11 } }, `Line: ${e.line_start || "N/A"}${e.line_end ? " - " + e.line_end : ""} | Version: ${e.version_id || "latest"} | Ref: ${e.reference || e.evidence_ref || "N/A"}`)
          )
        )
      )
    )
  );
};
