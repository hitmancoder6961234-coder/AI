/**
 * SSRF-safe HTTP fetch for agent tools.
 *
 * - Only http/https on ports 80, 443, 8080, 8443.
 * - Every address the hostname resolves to must be public. The check runs inside the socket's own
 *   `lookup`, so the address we validate is the address we connect to (no DNS-rebinding gap).
 * - Redirects are followed manually (max 3) and re-validated at every hop.
 * - Response size and time are capped; only text-like content types are returned.
 */
import dns from "dns";
import http from "http";
import https from "https";
import net from "net";

const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local + cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast / reserved
    );
  }
  if (net.isIPv6(ip)) {
    const g = expandIPv6(ip);
    if (!g) return true;
    if (g.every((x) => x === 0)) return true; // ::
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
    // IPv4 embedded in IPv6: ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible), 64:ff9b::/96 (NAT64)
    const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
    const compat = g.slice(0, 6).every((x) => x === 0);
    const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);
    if (mapped || compat || nat64) {
      return isPrivateAddress(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    }
    const first = g[0];
    return (
      (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
      (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
      (first & 0xff00) === 0xff00 // multicast
    );
  }
  return true; // not an IP at all → refuse
}

/** Expand any textual IPv6 address into eight 16-bit groups (null if malformed). */
function expandIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase().split("%")[0];
  const dotted = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[1].split(".").map(Number);
    if (o.some((n) => n > 255)) return null;
    addr = addr.slice(0, -dotted[1].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail].map((h) => parseInt(h, 16));
  return groups.length === 8 && groups.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? groups : null;
}

function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  cb: (err: NodeJS.ErrnoException | null, address: any, family?: number) => void
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, "" as any);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return cb(new Error("Blocked: destination resolves to a private or reserved address"), "" as any);
    }
    if ((options as any).all) return cb(null, list as any);
    cb(null, list[0].address, list[0].family);
  });
}

export function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https URLs are allowed");
  if (url.username || url.password) throw new Error("URLs with embedded credentials are not allowed");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) throw new Error(`Port ${port} is not allowed`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isPrivateAddress(host)) throw new Error("Blocked: private or reserved address");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error("Blocked: local hostname");
  }
  return url;
}

export interface SafeResponse {
  status: number;
  url: string;
  contentType: string;
  body: string;
  truncated: boolean;
}

export interface SafeInit {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

function once(url: URL, signal?: AbortSignal, init: SafeInit = {}): Promise<{ res: http.IncomingMessage; req: http.ClientRequest }> {
  const mod = url.protocol === "https:" ? https : http;
  const method = init.method || "GET";
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method,
        lookup: guardedLookup as any,
        timeout: TIMEOUT_MS,
        headers: {
          "user-agent": "DarknessAI-Agent/1.0 (+privacy-respecting; no cookies)",
          accept: "text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1",
          "accept-encoding": "identity",
          ...(init.body !== undefined ? { "content-length": String(Buffer.byteLength(init.body)) } : {}),
          ...(init.headers || {}),
        },
        signal,
      },
      (res) => resolve({ res, req })
    );
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

export async function safeFetch(rawUrl: string, signal?: AbortSignal, init: SafeInit = {}): Promise<SafeResponse> {
  let url = validateUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { res, req } = await once(url, signal, init);
    const status = res.statusCode || 0;
    // A POST is never silently replayed to another host: redirects are followed for GET only.
    if (status >= 300 && status < 400 && res.headers.location && (init.method || "GET") === "GET") {
      res.resume();
      url = validateUrl(new URL(res.headers.location, url).toString());
      continue;
    }
    const contentType = String(res.headers["content-type"] || "").toLowerCase();
    if (contentType && !/(text\/|json|xml|javascript)/.test(contentType)) {
      req.destroy();
      throw new Error(`Unsupported content type: ${contentType.split(";")[0]}`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    for await (const chunk of res) {
      size += (chunk as Buffer).length;
      if (size > MAX_BYTES) {
        truncated = true;
        req.destroy();
        break;
      }
      chunks.push(chunk as Buffer);
    }
    return { status, url: url.toString(), contentType, body: Buffer.concat(chunks).toString("utf8"), truncated };
  }
  throw new Error("Too many redirects");
}

/** Reduce HTML to readable text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}
