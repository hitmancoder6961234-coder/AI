/**
 * Compatibility entry point. The Darkness backend is now a single unified server (TypeScript, built to
 * dist/server.js). `node server.js` and hosts configured with the old start command keep working.
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

if (!existsSync(new URL("./dist/server.js", import.meta.url))) {
  console.log("[darkness] dist/server.js not found - building once (npm run build)...");
  try {
    execSync("npm run build", { stdio: "inherit" });
  } catch {
    console.error("[darkness] Build failed. Run `npm install && npm run build`, then `npm start`.");
    process.exit(1);
  }
}
await import("./dist/server.js");
