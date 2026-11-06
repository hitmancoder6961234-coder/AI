/**
 * Agent tools. Each tool is small, bounded and side-effect free with respect to the host:
 * no shell, no filesystem, no `eval`. Network access goes through safe-fetch (SSRF guard).
 */
import { htmlToText, safeFetch } from "./safe-fetch.js";

/** What a tool can do to the world: "read" only reads or computes, "network" sends a request to the internet, "write" changes the user's saved data. */
export type ToolRisk = "read" | "network" | "write";

export interface ToolContext {
  signal?: AbortSignal;
  /** Host-provided: save one note to the user's private memory (only ever called after the user approved it). */
  saveMemoryNote?: (content: string, category?: string) => Promise<string> | string;
  /** Per-run scratchpad. */
  memory: Map<string, string>;
  /** Optional private-knowledge search injected by the host (user's own documents). */
  knowledgeSearch?: (query: string) => Promise<string>;
}

export interface Tool {
  name: string;
  description: string;
  /** Human-readable argument schema shown to the model. */
  args: string;
  /** Defaults to "read". A "write" tool ALWAYS needs the user's approval, whatever the run's approval mode (see agent/policy.ts). */
  risk?: ToolRisk;
  run(args: Record<string, any>, ctx: ToolContext): Promise<string>;
}

// --- calculator: recursive-descent parser, no eval ---------------------------------------------

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, ln: Math.log, log: Math.log10, log2: Math.log2,
  exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export function evaluateExpression(src: string): number {
  if (src.length > 500) throw new Error("Expression too long");
  const s = src.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").toLowerCase();
  let i = 0;
  let depth = 0;

  const peek = () => s[i];
  function expect(ch: string) {
    if (s[i] !== ch) throw new Error(`Expected '${ch}' at position ${i}`);
    i++;
  }
  function number(): number {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i));
    if (!m) throw new Error(`Unexpected '${s[i] ?? "end"}' at position ${i}`);
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function primary(): number {
    if (peek() === "(") {
      if (++depth > 50) throw new Error("Nesting too deep");
      i++;
      const v = expr();
      expect(")");
      depth--;
      return v;
    }
    const id = /^[a-z_][a-z0-9_]*/.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      if (peek() === "(") {
        const fn = FUNCS[id[0]];
        if (!fn) throw new Error(`Unknown function '${id[0]}'`);
        i++;
        const args: number[] = [];
        if (peek() !== ")") {
          do args.push(expr());
          while (peek() === "," && ++i);
        }
        expect(")");
        return fn(...args);
      }
      if (id[0] in CONSTS) return CONSTS[id[0]];
      throw new Error(`Unknown name '${id[0]}'`);
    }
    return number();
  }
  function unary(): number {
    if (peek() === "-") { i++; return -unary(); }
    if (peek() === "+") { i++; return unary(); }
    return power();
  }
  function power(): number {
    const base = primary();
    if (peek() === "^" || (peek() === "*" && s[i + 1] === "*")) {
      i += peek() === "^" ? 1 : 2;
      return Math.pow(base, unary()); // right-associative
    }
    return base;
  }
  function term(): number {
    let v = unary();
    for (;;) {
      if (peek() === "*" && s[i + 1] !== "*") { i++; v *= unary(); }
      else if (peek() === "/") { i++; v /= unary(); }
      else if (peek() === "%") { i++; v %= unary(); }
      else return v;
    }
  }
  function expr(): number {
    let v = term();
    for (;;) {
      if (peek() === "+") { i++; v += term(); }
      else if (peek() === "-") { i++; v -= term(); }
      else return v;
    }
  }

  const result = expr();
  if (i !== s.length) throw new Error(`Unexpected '${s[i]}' at position ${i}`);
  if (!Number.isFinite(result)) throw new Error("Result is not a finite number");
  return result;
}

export const calculator: Tool = {
  name: "calculator",
  description: "Exact arithmetic. Supports + - * / % ^, parentheses, pi, e and sqrt/abs/sin/cos/tan/ln/log/exp/floor/ceil/round/min/max/pow.",
  args: '{"expression": "string"}',
  async run({ expression }) {
    const v = evaluateExpression(String(expression ?? ""));
    return String(Number.isInteger(v) ? v : Number(v.toPrecision(12)));
  },
};

// --- datetime ----------------------------------------------------------------------------------

export const datetime: Tool = {
  name: "datetime",
  description: "Current date and time, optionally in an IANA time zone (e.g. Asia/Kolkata).",
  args: '{"timeZone"?: "string"}',
  async run({ timeZone }) {
    const now = new Date();
    try {
      const tz = timeZone ? String(timeZone) : "UTC";
      const local = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "long", timeZone: tz }).format(now);
      return `${local} (ISO UTC: ${now.toISOString()})`;
    } catch {
      return `Unknown time zone. ISO UTC: ${now.toISOString()}`;
    }
  },
};

// --- web_search --------------------------------------------------------------------------------

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

async function duckDuckGo(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const r = await safeFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, signal);
  const out: SearchHit[] = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(r.body)) && out.length < 6) {
    let href = m[1];
    const uddg = /[?&]uddg=([^&]+)/.exec(href);
    if (uddg) href = decodeURIComponent(uddg[1]);
    out.push({ title: htmlToText(m[2]), url: href, snippet: htmlToText(m[3]), source: "DuckDuckGo" });
  }
  return out;
}

async function wikipedia(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const r = await safeFetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=5&format=json&srsearch=${encodeURIComponent(query)}`,
    signal
  );
  const json = JSON.parse(r.body);
  return (json?.query?.search || []).map((s: any) => ({
    title: String(s.title),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(s.title).replace(/ /g, "_"))}`,
    snippet: htmlToText(s.snippet),
    source: "Wikipedia",
  }));
}

/** Web search used by the agent tool and the original Darkness /search endpoint. */
export async function searchWeb(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const q = String(query ?? "").trim().slice(0, 300);
  if (!q) throw new Error("query is required");
  let hits: SearchHit[] = [];
  try {
    hits = await duckDuckGo(q, signal);
  } catch {
    /* fall through to Wikipedia */
  }
  return hits.length ? hits : wikipedia(q, signal);
}

export const webSearch: Tool = {
  name: "web_search",
  description: "Search the public web (DuckDuckGo, falling back to Wikipedia). Returns titles, URLs and snippets. Use fetch_url to read a result.",
  args: '{"query": "string"}',
  async run({ query }, ctx) {
    const results = await searchWeb(String(query ?? ""), ctx.signal);
    return results.length ? results.map((r, n) => `${n + 1}. ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n") : "No results.";
  },
};

// --- fetch_url ---------------------------------------------------------------------------------

export const fetchUrl: Tool = {
  name: "fetch_url",
  description: "Download a public web page or JSON document and return its readable text (max ~12k characters). Private/internal addresses are blocked.",
  args: '{"url": "https://..."}',
  async run({ url }, ctx) {
    const r = await safeFetch(String(url ?? ""), ctx.signal);
    const text = /html/.test(r.contentType) || /^\s*</.test(r.body) ? htmlToText(r.body) : r.body;
    const clipped = text.length > 12_000 ? `${text.slice(0, 12_000)}\n[truncated]` : text;
    return `HTTP ${r.status} ${r.url}\n\n${clipped}`;
  },
};

// --- scratchpad --------------------------------------------------------------------------------

export const scratchpad: Tool = {
  name: "scratchpad",
  description: "Short-term notes for this run only. action: set | get | list.",
  args: '{"action": "set|get|list", "key"?: "string", "value"?: "string"}',
  async run({ action, key, value }, ctx) {
    if (action === "list") return [...ctx.memory.keys()].join(", ") || "(empty)";
    if (!key) throw new Error("key is required");
    if (action === "set") {
      if (ctx.memory.size >= 50) throw new Error("Scratchpad is full");
      ctx.memory.set(String(key).slice(0, 80), String(value ?? "").slice(0, 4000));
      return "stored";
    }
    if (action === "get") return ctx.memory.get(String(key)) ?? "(not found)";
    throw new Error("action must be set, get or list");
  },
};

// --- knowledge_search (host-provided) ----------------------------------------------------------

export const knowledgeSearch: Tool = {
  name: "knowledge_search",
  description: "Search the signed-in user's own private documents and projects. Never leaves the server.",
  args: '{"query": "string"}',
  async run({ query }, ctx) {
    if (!ctx.knowledgeSearch) return "No private knowledge base is available.";
    return ctx.knowledgeSearch(String(query ?? "").slice(0, 500));
  },
};

// --- remember (the one tool that changes saved data) --------------------------------------------

export const rememberNote: Tool = {
  name: "remember",
  risk: "write",
  description: "Save ONE short note about the user (a preference or fact THEY told you) to their private memory. The user must approve every call. Never include secrets or contact details.",
  args: '{"content": "string, 3-500 characters", "category"?: "preference|fact|project|style|other"}',
  async run({ content, category }, ctx) {
    if (!ctx.saveMemoryNote) throw new Error("Saving notes is not available in this run.");
    return String(await ctx.saveMemoryNote(String(content ?? ""), category == null ? undefined : String(category)));
  },
};

// --- risk levels and argument checks -------------------------------------------------------------

for (const t of [calculator, datetime, scratchpad, knowledgeSearch]) t.risk = "read";
for (const t of [webSearch, fetchUrl]) t.risk = "network";

const str = (v: unknown, min: number, max: number) => typeof v === "string" && v.trim().length >= min && v.length <= max;
/** A cheap shape check before a tool runs (the model's arguments are untrusted input). Returns an error message, or null when the call is well formed. */
export function validateToolArgs(name: string, args: Record<string, any>): string | null {
  switch (name) {
    case "calculator": return str(args.expression, 1, 500) ? null : "expression must be a string of 1-500 characters";
    case "web_search": return str(args.query, 1, 500) ? null : "query must be a string of 1-500 characters";
    case "fetch_url": return str(args.url, 8, 2000) ? null : "url must be a string of 8-2000 characters";
    case "knowledge_search": return str(args.query, 1, 500) ? null : "query must be a string of 1-500 characters";
    case "datetime": return null;
    case "scratchpad": return ["set", "get", "list"].includes(args.action) ? null : "action must be set, get or list";
    case "remember":
      if (!str(args.content, 3, 500)) return "content must be a string of 3-500 characters";
      return args.category == null || ["preference", "fact", "project", "style", "other"].includes(args.category) ? null : "category must be preference, fact, project, style or other";
    default: return null;
  }
}

export const ALL_TOOLS: Tool[] = [calculator, datetime, webSearch, fetchUrl, scratchpad, knowledgeSearch];

/** Tools of agent sessions (durable runs with approvals): everything in ALL_TOOLS plus the write tool. The stateless /api/agent/run never gets the write tool. */
export const SESSION_TOOLS: Tool[] = [...ALL_TOOLS, rememberNote];

export function selectTools(names?: string[], pool: Tool[] = ALL_TOOLS): Tool[] {
  if (!names || !names.length) return pool;
  const wanted = new Set(names);
  return pool.filter((t) => wanted.has(t.name));
}
