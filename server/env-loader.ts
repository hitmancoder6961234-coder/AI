import fs from "fs";
import path from "path";

let envLoaded = false;

export function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;

  const envFiles = [".env", ".env.local"];
  for (const file of envFiles) {
    const filePath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    } catch {}
  }
}

// Auto-run on module load
loadEnv();
