/**
 * Records every route the server registers, with the file that registered it, and writes them as JSON when the server starts listening.
 * Used by scripts/authz-audit.mjs; run by hand with:
 *
 *   ROUTE_DUMP=routes.json node --import ./scripts/route-dump-hook.mjs dist/server.js
 *
 * It only observes (it wraps Express's registration methods and calls the originals); it changes no behaviour and is never loaded in production.
 */
import fs from "node:fs";
import express from "express";

const METHODS = ["get", "post", "put", "patch", "delete", "all"];
const own = new WeakMap(); // app / router -> [{ method, path, file }]
const mounts = new WeakMap(); // app / router -> [{ prefix, child }]
const callerFile = () => {
  const frames = String(new Error().stack || "").split("\n").slice(2);
  for (const f of frames) {
    if (f.includes("node_modules") || f.includes("route-dump-hook")) continue;
    const m = /\(?(?:file:\/\/\/)?([A-Za-z]:[^:)]+|\/[^:)]+)(?::\d+)+\)?$/.exec(f.trim());
    if (m) return m[1].replace(/\\/g, "/").split("/MyAI/").pop();
  }
  return "?";
};
const textOf = (p) => (typeof p === "string" ? p : Array.isArray(p) ? p.map(textOf).join("|") : String(p));
const add = (self, method, path) => { if (!own.has(self)) own.set(self, []); own.get(self).push({ method: method.toUpperCase(), path: textOf(path), file: callerFile() }); };

function wrapRegistrar(target) {
  for (const m of METHODS) {
    const orig = target[m];
    if (typeof orig !== "function") continue;
    target[m] = function (...args) {
      if (!(m === "get" && args.length === 1)) add(this, m, args[0]); // app.get("setting") reads a setting, it is not a route
      return orig.apply(this, args);
    };
  }
  const origUse = target.use;
  target.use = function (...args) {
    const prefix = typeof args[0] === "string" ? args[0] : "";
    // a mounted child is either a Router (it has a `stack`) or a whole sub-application (it can `listen`)
    for (const a of args) if (a && (typeof a === "function" || typeof a === "object") && (Array.isArray(a.stack) || typeof a.listen === "function")) { if (!mounts.has(this)) mounts.set(this, []); mounts.get(this).push({ prefix, child: a }); }
    if (typeof args[0] === "string" || Array.isArray(args[0])) add(this, "USE", args[0]);
    return origUse.apply(this, args);
  };
  const origRoute = target.route;
  if (typeof origRoute === "function") {
    target.route = function (p) {
      const route = origRoute.call(this, p);
      for (const m of METHODS) {
        const o = route[m]; if (typeof o !== "function") continue;
        route[m] = function (...a) { add(route, m, p); return o.apply(route, a); }; // (chained route() calls are recorded on the route itself)
      }
      return route;
    };
  }
}
wrapRegistrar(express.application);
wrapRegistrar(express.Router); // older router versions keep the methods on the function itself...
if (express.Router.prototype) wrapRegistrar(express.Router.prototype); // ...newer ones on the class prototype

const flatten = (node, prefix, out) => {
  for (const r of own.get(node) || []) out.push({ ...r, path: (prefix + r.path).replace(/\/{2,}/g, "/") });
  for (const { prefix: p, child } of mounts.get(node) || []) flatten(child, prefix + p, out);
};

const origListen = express.application.listen;
express.application.listen = function (...args) {
  try {
    const out = []; flatten(this, "", out);
    if (process.env.ROUTE_DUMP) fs.writeFileSync(process.env.ROUTE_DUMP, JSON.stringify(out, null, 1));
  } catch (e) { console.error("route-dump-hook:", e && e.message); }
  return origListen.apply(this, args);
};
