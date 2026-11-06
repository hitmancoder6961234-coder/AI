import type { Tool } from "./tools.js";

/**
 * When does a tool call need the user's explicit approval?
 *
 *   "sensitive" (default)  only for tools that change the user's saved data (risk "write")
 *   "all"                  before EVERY tool call (the strict mode)
 *
 * A "write" tool ALWAYS needs approval: there is deliberately no mode that turns this off, and the mode is validated on the server, so neither the
 * model nor a crafted request can run a write tool unapproved. Unknown modes are treated as the safe default, never as "off".
 */
export type ApprovalMode = "sensitive" | "all";

export function normaliseMode(raw: unknown): ApprovalMode {
  return raw === "all" ? "all" : "sensitive";
}

/** The reason shown to the user, or null when the call may run without asking. */
export function approvalReason(tool: Pick<Tool, "name" | "risk">, mode: ApprovalMode): string | null {
  const risk = tool.risk ?? "read";
  if (risk === "write") return "This action changes your saved data.";
  if (mode === "all") return risk === "network" ? "This sends a request to the internet." : "You asked to approve every tool call.";
  return null;
}
