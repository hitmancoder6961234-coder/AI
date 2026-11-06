import type { Request, RequestHandler, Response } from "express";
import { logger } from "./logger.js";

/**
 * Liveness and readiness.
 *
 *   GET /api/health  - LIVENESS: "is the process up and able to answer?". Cheap, touches nothing, always 200 while the
 *                      process runs. Orchestrators restart the instance when this fails, so it must never fail because a
 *                      dependency is down.
 *   GET /api/ready   - READINESS: "should this instance receive traffic right now?". Runs the checks below.
 *                      200 `ready`      every required check passed
 *                      200 `degraded`   required checks passed, an OPTIONAL service (cloud mirror, Supabase) is down
 *                      503 `not_ready`  a REQUIRED check failed (database, storage, disk space, upload temp folder)
 *                      503 `draining`   the process received SIGTERM and is finishing in-flight work
 *
 * Failure details are logged (with the request id), never returned: the response says which check failed and a coarse
 * reason (`timeout` / `unavailable`), not paths, driver messages or connection strings.
 */
export interface HealthCheck {
  name: string;
  /** a failing required check makes the instance not ready; a failing optional one only marks it degraded */
  required: boolean;
  /** throw (or reject) to fail; return normally to pass */
  run: () => void | string | Promise<void | string>;
  timeoutMs?: number;
  /** reuse the last result for this long (use for checks that call out to other services) */
  cacheMs?: number;
}

export interface CheckResult {
  required: boolean;
  status: "ok" | "fail";
  ms: number;
  error?: "timeout" | "unavailable";
  note?: string;
}

const cache = new WeakMap<HealthCheck, { at: number; result: CheckResult }>();

export async function runCheck(check: HealthCheck, now: () => number = Date.now): Promise<CheckResult> {
  if (check.cacheMs) {
    const hit = cache.get(check);
    if (hit && now() - hit.at < check.cacheMs) return hit.result;
  }
  const t0 = now();
  const timeoutMs = check.timeoutMs ?? 2000;
  let timer: NodeJS.Timeout | undefined;
  let result: CheckResult;
  try {
    const note = await Promise.race([
      Promise.resolve().then(() => check.run()),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error("check timed out"), { code: "CHECK_TIMEOUT" })), timeoutMs); }),
    ]);
    result = { required: check.required, status: "ok", ms: now() - t0, ...(typeof note === "string" && note ? { note } : {}) };
  } catch (err: any) {
    logger.warn("readiness_check_failed", { check: check.name, required: check.required, err });
    result = { required: check.required, status: "fail", ms: now() - t0, error: err?.code === "CHECK_TIMEOUT" ? "timeout" : "unavailable" };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (check.cacheMs) cache.set(check, { at: now(), result });
  return result;
}

export type ReadinessState = "ready" | "degraded" | "not_ready" | "draining";

export async function evaluateReadiness(checks: HealthCheck[], draining: boolean): Promise<{ state: ReadinessState; checks: Record<string, CheckResult> }> {
  const entries = await Promise.all(checks.map(async (c) => [c.name, await runCheck(c)] as const));
  const results = Object.fromEntries(entries);
  const requiredFailed = entries.some(([, r]) => r.required && r.status === "fail");
  const optionalFailed = entries.some(([, r]) => !r.required && r.status === "fail");
  const state: ReadinessState = draining ? "draining" : requiredFailed ? "not_ready" : optionalFailed ? "degraded" : "ready";
  return { state, checks: results };
}

export function livenessHandler(service: string, startedAt = Date.now()): RequestHandler {
  return (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ status: "ok", service, uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
  };
}

export function readinessHandler(opts: { service: string; checks: HealthCheck[]; isDraining: () => boolean }): RequestHandler {
  return async (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const { state, checks } = await evaluateReadiness(opts.checks, opts.isDraining());
    const ok = state === "ready" || state === "degraded";
    if (state === "draining") res.setHeader("Retry-After", "5");
    res.status(ok ? 200 : 503).json({ status: state, service: opts.service, checks });
  };
}

// ---- graceful shutdown state --------------------------------------------------------------------------------------------
let draining = false;
export const isDraining = (): boolean => draining;
export function markDraining(value = true): void { draining = value; }
