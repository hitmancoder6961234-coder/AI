import React, { useState, useEffect } from "react";

export default function PatchAgentPage({ projectId }) {
  const [patches, setPatches] = useState([]);
  const [selectedPatch, setSelectedPatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [approvalState, setApprovalState] = useState({});
  const [verificationState, setVerificationState] = useState({});

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/patches`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setPatches(d.patches || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId]);

  const handleApprove = async (patchId) => {
    setApprovalState((prev) => ({ ...prev, [patchId]: "APPROVING" }));
    try {
      const resp = await fetch(`/api/patches/${patchId}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include" });
      const result = await resp.json();
      setApprovalState((prev) => ({ ...prev, [patchId]: result.ok ? "APPROVED" : "FAILED" }));
      // Refresh patches
      const refreshResp = await fetch(`/api/projects/${projectId}/patches`, { credentials: "include" });
      const refreshData = await refreshResp.json();
      setPatches(refreshData.patches || []);
    } catch {
      setApprovalState((prev) => ({ ...prev, [patchId]: "FAILED" }));
    }
  };

  const handleApply = async (patchId) => {
    setApprovalState((prev) => ({ ...prev, [patchId]: "APPLYING" }));
    try {
      const resp = await fetch(`/api/patches/${patchId}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include" });
      const result = await resp.json();
      setApprovalState((prev) => ({ ...prev, [patchId]: result.ok ? "APPLIED" : "APPLY_FAILED" }));
      const refreshResp = await fetch(`/api/projects/${projectId}/patches`, { credentials: "include" });
      const refreshData = await refreshResp.json();
      setPatches(refreshData.patches || []);
    } catch {
      setApprovalState((prev) => ({ ...prev, [patchId]: "APPLY_FAILED" }));
    }
  };

  const handleVerify = async (patchId) => {
    setVerificationState((prev) => ({ ...prev, [patchId]: "VERIFYING" }));
    try {
      const resp = await fetch(`/api/patches/${patchId}/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include" });
      const result = await resp.json();
      setVerificationState((prev) => ({ ...prev, [patchId]: result.ok ? "VERIFIED" : "VERIFICATION_FAILED" }));
      const refreshResp = await fetch(`/api/projects/${projectId}/patches`, { credentials: "include" });
      const refreshData = await refreshResp.json();
      setPatches(refreshData.patches || []);
    } catch {
      setVerificationState((prev) => ({ ...prev, [patchId]: "VERIFICATION_FAILED" }));
    }
  };

  const handleRollback = async (patchId) => {
    try {
      const resp = await fetch(`/api/patches/${patchId}/rollback`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include" });
      const result = await resp.json();
      setApprovalState((prev) => ({ ...prev, [patchId]: result.ok ? "ROLLED_BACK" : "ROLLBACK_FAILED" }));
      const refreshResp = await fetch(`/api/projects/${projectId}/patches`, { credentials: "include" });
      const refreshData = await refreshResp.json();
      setPatches(refreshData.patches || []);
    } catch {
      setApprovalState((prev) => ({ ...prev, [patchId]: "ROLLBACK_FAILED" }));
    }
  };

  return React.createElement(
    "div",
    { className: "patch-agent-page", style: { maxWidth: 1200, margin: "0 auto", padding: 24, color: "var(--ink)", fontFamily: "var(--font-body)", minHeight: "100vh" } },
    React.createElement("h1", { style: { fontSize: 28, fontWeight: 700, marginBottom: 4 } }, "Project Copilot"),
    React.createElement("p", { style: { color: "var(--ink-faint)", marginBottom: 24 } }, `Project: ${projectId}`),
    loading ? React.createElement("div", { className: "p-8 text-center text-muted" }, "Loading patches...") :
    patches.length === 0 ? React.createElement("div", { className: "p-8 text-center text-muted" }, "No patches found for this project. Run analysis first to generate evidence-backed recommendations.") :
    React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 16 } },
      patches.map((patch, i) =>
        React.createElement("div", { key: patch.id || i, style: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 20 } },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 } },
            React.createElement("h3", { style: { fontSize: 18, fontWeight: 700 } }, patch.title || "Untitled Patch"),
            React.createElement("span", { style: { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: patch.status === "VERIFIED" ? "#10b981" : patch.status === "APPLIED" ? "#3b82f6" : patch.status === "APPROVED" ? "#8b5cf6" : patch.status === "PROPOSED" ? "#f59e0b" : "#64748b", color: "#fff" } }, patch.status || "PROPOSED")
          ),
          React.createElement("p", { style: { fontSize: 13, color: "var(--ink)", marginBottom: 8, lineHeight: 1.5 } }, patch.request || patch.reason || "No request description available."),
          React.createElement("p", { style: { fontSize: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: 10, fontFamily: "monospace", whiteSpace: "pre-wrap", overflowX: "auto", marginBottom: 8 } }, patch.diff_text || "No diff available."),
          React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: "var(--ink-faint)", marginBottom: 8 } },
            React.createElement("span", {}, `Project: ${patch.project_id || projectId}`),
            React.createElement("span", {}, `Files: ${JSON.parse(patch.files_changed_json || "[]").join(", ")}`),
            React.createElement("span", {}, `Evidence: ${patch.evidence_refs ? JSON.parse(patch.evidence_refs || "[]").length : 0}`),
            React.createElement("span", {}, `Risk: ${patch.risk_level || "LOW"}`)
          ),
          React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
            patch.status === "PROPOSED" && React.createElement("button", { onClick: () => handleApprove(patch.id), style: { padding: "4px 12px", borderRadius: 6, border: "none", background: "#3b82f6", color: "#fff", fontSize: 13, cursor: "pointer" } }, "Approve"),
            (patch.status === "PROPOSED" || patch.status === "APPROVED" || patch.status === "VERIFIED") && React.createElement("button", { onClick: () => handleApply(patch.id), style: { padding: "4px 12px", borderRadius: 6, border: "none", background: patch.status === "VERIFIED" ? "#10b981" : "#10b981", color: "#fff", fontSize: 13, cursor: "pointer" } }, "Apply"),
            (patch.status === "APPLIED" || patch.status === "VERIFIED") && React.createElement("button", { onClick: () => handleVerify(patch.id), style: { padding: "4px 12px", borderRadius: 6, border: "none", background: "#9333ea", color: "#fff", fontSize: 13, cursor: "pointer" } }, "Verify"),
            (patch.status === "APPLIED" || patch.status === "VERIFIED" || patch.status === "FAILED") && React.createElement("button", { onClick: () => handleRollback(patch.id), style: { padding: "4px 12px", borderRadius: 6, border: "none", background: "#64748b", color: "#fff", fontSize: 13, cursor: "pointer" } }, "Rollback"),
            React.createElement("span", { style: { fontSize: 11, color: approvalState[patch.id] ? (approvalState[patch.id] === "APPROVED" ? "#10b981" : approvalState[patch.id] === "APPLIED" ? "#3b82f6" : approvalState[patch.id] === "VERIFIED" ? "#9333ea" : approvalState[patch.id] === "ROLLED_BACK" ? "#64748b" : "#ef4444") : "var(--ink-faint)", fontWeight: 600 } }, approvalState[patch.id] ? approvalState[patch.id] : "Pending"),
            verificationState[patch.id] ? React.createElement("span", { style: { fontSize: 11, color: verificationState[patch.id] === "VERIFIED" ? "#10b981" : "#ef4444", fontWeight: 700 } }, verificationState[patch.id] === "VERIFIED" ? "VERIFIED" : verificationState[patch.id] === "VERIFYING" ? "Verifying..." : "Verification failed") : null
          )
        )
      )
    )
  );
};
