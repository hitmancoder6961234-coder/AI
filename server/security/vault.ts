/**
 * Vault — authenticated encryption for data that leaves the primary database
 * (e.g. the Aiven mirror) or is handed to a third party.
 *
 * AES-256-GCM with a random 96-bit IV per message. The key is supplied through
 * PRIVACY_ENCRYPTION_KEY (32 random bytes, base64). Generate one with
 * `scripts/new-secrets.ps1`. The key never touches the repository or the logs.
 *
 * Wire format:  v1.<iv>.<tag>.<ciphertext>   (all base64url)
 */
import crypto from "crypto";

const ALGO = "aes-256-gcm";
const PREFIX = "v1";

let cachedKey: Buffer | null | undefined;
let cachedPrev: Buffer | null | undefined;

function loadKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = (process.env.PRIVACY_ENCRYPTION_KEY || "").trim();
  if (!raw) {
    cachedKey = null;
    return cachedKey;
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "PRIVACY_ENCRYPTION_KEY must decode to exactly 32 bytes (base64). Run scripts/new-secrets.ps1 to create one."
    );
  }
  cachedKey = key;
  return cachedKey;
}

/** The key used before the last rotation (PRIVACY_ENCRYPTION_KEY_PREVIOUS): only ever used to READ values sealed with it. */
function loadPreviousKey(): Buffer | null {
  if (cachedPrev !== undefined) return cachedPrev;
  const raw = (process.env.PRIVACY_ENCRYPTION_KEY_PREVIOUS || "").trim();
  if (!raw) return (cachedPrev = null);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("PRIVACY_ENCRYPTION_KEY_PREVIOUS must decode to exactly 32 bytes (base64).");
  return (cachedPrev = key);
}

export function vaultEnabled(): boolean {
  try {
    return loadKey() !== null;
  } catch {
    return false;
  }
}

/** Encrypt a string. Throws if no key is configured — callers must check vaultEnabled(). */
export function seal(plain: string, aad = ""): string {
  const key = loadKey();
  if (!key) throw new Error("Vault is not configured (PRIVACY_ENCRYPTION_KEY missing)");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

/** Decrypt a value produced by seal(). Throws on tampering, wrong key or wrong aad. */
export function open(sealed: string, aad = ""): string {
  const key = loadKey();
  if (!key) throw new Error("Vault is not configured (PRIVACY_ENCRYPTION_KEY missing)");
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error("Unrecognised vault payload");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ct = Buffer.from(parts[3], "base64url");
  const attempt = (k: Buffer) => {
    const decipher = crypto.createDecipheriv(ALGO, k, iv);
    if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  };
  try {
    return attempt(key);
  } catch (err) {
    // key rotation: values sealed before the rotation are still readable while the previous key is configured
    const prev = loadPreviousKey();
    if (prev) return attempt(prev);
    throw err;
  }
}

/** Test hook: forget the cached key so a new env value is read. */
export function _resetVaultForTests(): void {
  cachedKey = undefined;
  cachedPrev = undefined;
}
