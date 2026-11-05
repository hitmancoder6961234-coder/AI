import fs from "node:fs";
import path from "node:path";

/**
 * Content validation for uploads: what the bytes ARE has to agree with what the file claims to be.
 *
 * A file name and a MIME header are chosen by the sender, so they prove nothing. We read the first few KB and:
 *   - for types that have a signature (PDF, Office, ZIP, images, audio/video, archives...), require that signature;
 *   - for text-like types (code, markdown, csv, json...), refuse binary content and any file that is really something else;
 *   - refuse executables (Windows PE, Linux ELF, macOS Mach-O) hiding under any other name, and, where the route asks for
 *     it (documents), refuse them outright.
 * Unknown extensions are allowed when they are text or carry a known signature, so existing uploads keep working.
 */

export const HEAD_BYTES = 8192;

export type SignatureKind =
  | "pdf" | "zip" | "ole" | "rtf" | "png" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "tiff" | "iso-media"
  | "mp3" | "wav" | "avi" | "ogg" | "flac" | "matroska" | "gzip" | "7z" | "rar" | "bzip2" | "xz"
  | "pe" | "elf" | "macho" | "java-class";

export interface Verdict {
  ok: boolean;
  /** what the content was recognised as, when it was */
  kind?: SignatureKind | "text" | "unknown-binary";
  code?: "INVALID_FILE_SIGNATURE" | "EXECUTABLE_CONTENT" | "BINARY_IN_TEXT_FILE";
  message?: string;
}

const startsWith = (b: Buffer, ...bytes: number[]) => b.length >= bytes.length && bytes.every((v, i) => b[i] === v);
const ascii = (b: Buffer, at: number, s: string) => b.length >= at + s.length && b.toString("latin1", at, at + s.length) === s;

/** Recognise a content type from its first bytes, or null. */
export function detectKind(b: Buffer): SignatureKind | null {
  if (!b || b.length < 2) return null;
  if (startsWith(b, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (startsWith(b, 0xff, 0xd8, 0xff)) return "jpeg";
  if (ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a")) return "gif";
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) return "webp";
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE")) return "wav";
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "AVI ")) return "avi";
  if (startsWith(b, 0x00, 0x00, 0x01, 0x00)) return "ico";
  if (startsWith(b, 0x49, 0x49, 0x2a, 0x00) || startsWith(b, 0x4d, 0x4d, 0x00, 0x2a)) return "tiff";
  if (b.subarray(0, Math.min(b.length, HEAD_BYTES)).indexOf("%PDF-") >= 0 && b.subarray(0, 1024).indexOf("%PDF-") >= 0) return "pdf";
  if (startsWith(b, 0x50, 0x4b, 0x03, 0x04) || startsWith(b, 0x50, 0x4b, 0x05, 0x06) || startsWith(b, 0x50, 0x4b, 0x07, 0x08)) return "zip";
  if (startsWith(b, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return "ole";
  if (ascii(b, 0, "{\\rtf")) return "rtf";
  if (ascii(b, 0, "OggS")) return "ogg";
  if (ascii(b, 0, "fLaC")) return "flac";
  if (startsWith(b, 0x1a, 0x45, 0xdf, 0xa3)) return "matroska";
  // (FF FE is a UTF-16 text byte-order mark, not an MP3 frame header, so it is excluded)
  if (ascii(b, 0, "ID3") || (b[0] === 0xff && b[1] !== 0xfe && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return "mp3";
  if (ascii(b, 4, "ftyp") || ["moov", "wide", "free", "mdat", "skip"].some((a) => ascii(b, 4, a))) return "iso-media";
  if (startsWith(b, 0x1f, 0x8b)) return "gzip";
  if (startsWith(b, 0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return "7z";
  if (ascii(b, 0, "Rar!")) return "rar";
  if (ascii(b, 0, "BZh")) return "bzip2";
  if (startsWith(b, 0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00)) return "xz";
  if (startsWith(b, 0x7f, 0x45, 0x4c, 0x46)) return "elf";
  if (startsWith(b, 0xfe, 0xed, 0xfa, 0xce) || startsWith(b, 0xfe, 0xed, 0xfa, 0xcf) || startsWith(b, 0xce, 0xfa, 0xed, 0xfe) || startsWith(b, 0xcf, 0xfa, 0xed, 0xfe)) return "macho";
  if (startsWith(b, 0xca, 0xfe, 0xba, 0xbe)) return "java-class"; // also the macOS universal binary header; see isExecutable
  if (ascii(b, 0, "MZ")) {
    const pe = b.length >= 0x40 ? b.readUInt32LE(0x3c) : 0;
    if ((pe > 0 && pe + 4 <= b.length && ascii(b, pe, "PE\0\0")) || b.subarray(0, Math.min(b.length, 512)).indexOf("This program") >= 0) return "pe";
  }
  return null;
}

const isExecutableKind = (k: SignatureKind | null) => k === "pe" || k === "elf" || k === "macho";

/** True when the bytes are non-text: NUL bytes outside a UTF-16 text file. */
export function looksBinary(b: Buffer): boolean {
  if (b.length === 0) return false;
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) return false; // UTF-16 BOM: text with NULs by design
  return b.indexOf(0) >= 0;
}

// Extensions that MUST carry one of these signatures.
const ZIP_BASED = [".docx", ".xlsx", ".pptx", ".docm", ".xlsm", ".pptm", ".dotx", ".xltx", ".potx", ".odt", ".ods", ".odp", ".odg", ".epub", ".zip", ".jar", ".war", ".apk", ".xpi", ".vsix", ".nupkg", ".whl", ".pages", ".numbers", ".key", ".ipa", ".crx"];
const LEGACY_OFFICE = [".doc", ".xls", ".ppt", ".dot", ".xlt", ".pot", ".msg", ".msi"];
const REQUIRED: Record<string, SignatureKind[]> = {
  ".pdf": ["pdf"],
  ".rtf": ["rtf"],
  ".png": ["png"],
  ".jpg": ["jpeg"], ".jpeg": ["jpeg"], ".jpe": ["jpeg"], ".jfif": ["jpeg"],
  ".gif": ["gif"],
  ".webp": ["webp"],
  ".ico": ["ico"],
  ".tif": ["tiff"], ".tiff": ["tiff"],
  ".mp4": ["iso-media"], ".m4a": ["iso-media"], ".m4v": ["iso-media"], ".mov": ["iso-media"], ".3gp": ["iso-media"], ".heic": ["iso-media"], ".heif": ["iso-media"], ".avif": ["iso-media"],
  ".mp3": ["mp3"],
  ".wav": ["wav"],
  ".avi": ["avi"],
  ".ogg": ["ogg"], ".oga": ["ogg"], ".ogv": ["ogg"], ".opus": ["ogg"],
  ".flac": ["flac"],
  ".webm": ["matroska"], ".mkv": ["matroska"],
  ".gz": ["gzip"], ".tgz": ["gzip"],
  ".7z": ["7z"],
  ".rar": ["rar"],
  ".bz2": ["bzip2"],
  ".xz": ["xz"],
  ".exe": ["pe"], ".dll": ["pe"], ".sys": ["pe"], ".scr": ["pe"],
  ".so": ["elf"], ".dylib": ["macho"],
  ".class": ["java-class"],
};
for (const e of ZIP_BASED) REQUIRED[e] = ["zip"];
for (const e of LEGACY_OFFICE) REQUIRED[e] = ["ole"];
// Old Office exports are frequently HTML/CSV text saved under the legacy name; the extractor reads those heuristically.
const TEXT_ALSO_OK = new Set([".doc", ".xls", ".ppt", ".dot", ".xlt", ".pot"]);
// Windows installers/executables are never accepted on document routes.
const BMP_EXT = new Set([".bmp"]);

export interface ValidateOptions {
  /** refuse executables outright (document routes); otherwise they are only refused when the name says something else */
  blockExecutables?: boolean;
}

/** Decide whether `head` (the first bytes of the file) is acceptable for a file called `filename`. */
export function validateSignature(filename: string, head: Buffer, opts: ValidateOptions = {}): Verdict {
  const name = path.basename(String(filename || "file"));
  const ext = path.extname(name).toLowerCase();
  const detected = detectKind(head);
  const bad = (code: NonNullable<Verdict["code"]>, message: string): Verdict => ({ ok: false, code, message: `${name}: ${message}` });

  if (head.length === 0) return { ok: true, kind: "unknown-binary" }; // empty files carry nothing to check

  if (opts.blockExecutables && isExecutableKind(detected)) return bad("EXECUTABLE_CONTENT", "executable programs are not accepted here.");

  const required = REQUIRED[ext];
  if (required) {
    if (required.includes(detected as SignatureKind)) return { ok: true, kind: detected as SignatureKind };
    if (TEXT_ALSO_OK.has(ext) && !looksBinary(head) && detected === null) return { ok: true, kind: "text" };
    if (isExecutableKind(detected)) return bad("EXECUTABLE_CONTENT", `an executable program is disguised as a ${ext} file.`);
    return bad("INVALID_FILE_SIGNATURE", `the content is not a real ${ext.slice(1).toUpperCase()} file (its first bytes do not match that format).`);
  }

  if (BMP_EXT.has(ext)) {
    // BMP only has the two-letter "BM" marker
    if (ascii(head, 0, "BM")) return { ok: true, kind: "bmp" };
    return bad("INVALID_FILE_SIGNATURE", "the content is not a real BMP image.");
  }

  if (ext === ".svg") {
    const text = head.toString("utf8", 0, Math.min(head.length, 4096)).toLowerCase();
    if (!looksBinary(head) && text.includes("<svg")) return { ok: true, kind: "text" };
    return bad("INVALID_FILE_SIGNATURE", "the content is not a real SVG image.");
  }

  // Everything else is treated as text-like (code, markdown, csv, json, ...) or an unknown type.
  if (isExecutableKind(detected)) return bad("EXECUTABLE_CONTENT", `an executable program is disguised as ${ext ? "a " + ext + " file" : "an unnamed file"}.`);
  if (detected && ext && TEXT_LIKE.has(ext)) return bad("INVALID_FILE_SIGNATURE", `a ${ext} file cannot contain ${detected.toUpperCase()} data.`);
  if (TEXT_LIKE.has(ext) || ext === "") {
    if (looksBinary(head)) return bad("BINARY_IN_TEXT_FILE", `binary data in a file named ${ext || "without an extension"} (it should be text).`);
    return { ok: true, kind: "text" };
  }
  // unknown extension: fine if it is text or a recognised format; unrecognised binary is allowed (projects hold all sorts)
  if (detected) return { ok: true, kind: detected };
  return { ok: true, kind: looksBinary(head) ? "unknown-binary" : "text" };
}

const TEXT_LIKE = new Set([
  ".txt", ".md", ".markdown", ".rst", ".tex", ".csv", ".tsv", ".json", ".jsonl", ".ndjson", ".xml", ".html", ".htm", ".xhtml", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env", ".log", ".sql",
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".pyw", ".ipynb", ".java", ".kt", ".kts", ".scala", ".groovy", ".c", ".h", ".cpp", ".hpp", ".cc", ".cxx", ".cs", ".go", ".rs", ".php", ".rb", ".erb",
  ".css", ".scss", ".sass", ".less", ".vue", ".svelte", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd", ".swift", ".m", ".r", ".lua", ".pl", ".dart", ".gradle", ".properties", ".proto", ".graphql", ".gql", ".tf",
  ".lock", ".gitignore", ".dockerignore", ".editorconfig", ".example", ".txt~", ".map",
]);

/** Read the first bytes of a file on disk. */
export async function readHead(file: string, bytes = HEAD_BYTES): Promise<Buffer> {
  const fh = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}
