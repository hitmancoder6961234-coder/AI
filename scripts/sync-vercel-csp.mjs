#!/usr/bin/env node
/**
 * Rewrites the Content-Security-Policy headers in vercel.json from server/security/csp.ts, so the static host sends exactly
 * the policy the API server does. Run with:  node --import tsx scripts/sync-vercel-csp.mjs
 * (tests/csp.test.ts fails when vercel.json and csp.ts disagree.)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCsp } from "../server/security/csp.ts";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "vercel.json");
const raw = fs.readFileSync(file, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const cfg = JSON.parse(raw);

const common = cfg.headers.find((h) => h.source === "/(.*)" || h.source === "/((?!classic/).*)").headers.filter(
  (h) => !/^content-security-policy/i.test(h.key) && h.key !== "Reporting-Endpoints", // Reporting-Endpoints: an older revision sent it
);
const rest = cfg.headers.filter((h) => !["/(.*)", "/((?!classic/).*)", "/classic/(.*)"].includes(h.source));

cfg.headers = [
  { source: "/((?!classic/).*)", headers: [...common, { key: "Content-Security-Policy", value: buildCsp("app") }] },
  { source: "/classic/(.*)", headers: [...common, { key: "Content-Security-Policy", value: buildCsp("classic") }] },
  ...rest,
];
fs.writeFileSync(file, JSON.stringify(cfg, null, 2).replace(/\n/g, eol) + eol);
console.log("vercel.json CSP updated");
