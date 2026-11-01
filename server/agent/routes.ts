/**
 * HTTP surface of the agent.
 *
 *   GET  /api/agent/tools   tools + which provider is active (never returns keys)
 *   POST /api/agent/run     {goal, history?, maxSteps?, tools?, provider?}
 *                           Server-Sent Events by default, JSON when ?stream=0
 *
 * Requires a signed-in user. Goals and answers are never logged.
 */
import type { Express, Request, Response } from "express";
import { runAgent, type AgentEvent } from "./core.js";
import { availableProviders, createLLM, type ChatMsg } from "./providers.js";
import { ALL_TOOLS, selectTools } from "./tools.js";

export interface AgentRouteDeps {
  getUserId: (req: Request) => string | null;
  /** Search the user's own knowledge base; returns formatted text. */
  knowledgeSearch?: (userId: string, query: string) => Promise<string>;
}

const MAX_GOAL = 8_000;
const MAX_CONCURRENT_PER_USER = 2;
const active = new Map<string, number>();

function validHistory(input: unknown): ChatMsg[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-12)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 8000) }));
}

export function registerAgentRoutes(app: Express, deps: AgentRouteDeps): void {
  app.get("/api/agent/tools", (req, res) => {
    if (!deps.getUserId(req)) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    res.json({
      tools: ALL_TOOLS.map((t) => ({ name: t.name, description: t.description, args: t.args })),
      providers: availableProviders(),
      active: availableProviders()[0] || null,
    });
  });

  app.post("/api/agent/run", async (req: Request, res: Response) => {
    const userId = deps.getUserId(req);
    if (!userId) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });

    const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
    if (!goal) return res.status(400).json({ error: "goal is required" });
    if (goal.length > MAX_GOAL) return res.status(413).json({ error: `goal is limited to ${MAX_GOAL} characters` });

    if ((active.get(userId) || 0) >= MAX_CONCURRENT_PER_USER) {
      return res.status(429).json({ error: "Too many agent runs in progress", code: "AGENT_BUSY" });
    }

    let llm;
    try {
      llm = createLLM(process.env, typeof req.body?.provider === "string" ? req.body.provider : undefined);
    } catch (err: any) {
      return res.status(503).json({ error: err.message, code: "NO_PROVIDER" });
    }

    const tools = selectTools(Array.isArray(req.body?.tools) ? req.body.tools.map(String) : undefined);
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    active.set(userId, (active.get(userId) || 0) + 1);

    const stream = String(req.query.stream ?? "1") !== "0";
    const send = (e: AgentEvent) => {
      if (!stream || res.writableEnded) return;
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };

    if (stream) {
      res.status(200).set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
    }

    try {
      const result = await runAgent({
        llm,
        tools,
        goal,
        history: validHistory(req.body?.history),
        maxSteps: Number(req.body?.maxSteps) || 8,
        signal: controller.signal,
        onEvent: send,
        knowledgeSearch: deps.knowledgeSearch ? (q) => deps.knowledgeSearch!(userId, q) : undefined,
      });
      if (stream) res.end();
      else res.json({ answer: result.answer, steps: result.steps, trace: result.trace });
    } catch (err: any) {
      const message = controller.signal.aborted ? "Cancelled" : String(err?.message || err).slice(0, 400);
      if (stream) {
        send({ type: "error", message });
        res.end();
      } else if (!res.headersSent) {
        res.status(502).json({ error: message });
      }
    } finally {
      const n = (active.get(userId) || 1) - 1;
      if (n <= 0) active.delete(userId);
      else active.set(userId, n);
    }
  });
}
