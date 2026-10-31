import express from "express";
import multer from "multer";

/**
 * CANONICAL UPLOAD CONFIGURATION
 * 
 * Strict maximum upload size: exactly 100 MB across the entire application.
 * 100 MB = 104,857,600 bytes.
 */
export const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024; // 104,857,600 bytes
export const MAX_UPLOAD_SIZE_MB = 100;
export const FILE_TOO_LARGE_ERROR = "FILE_TOO_LARGE";
export const FILE_TOO_LARGE_MESSAGE = "File is too large. Maximum allowed size is 100 MB.";

export const FILE_TOO_LARGE_PAYLOAD = {
  error: FILE_TOO_LARGE_ERROR,
  message: FILE_TOO_LARGE_MESSAGE,
  maxBytes: MAX_UPLOAD_SIZE_BYTES,
  maxMB: MAX_UPLOAD_SIZE_MB,
} as const;

/**
 * Check if a given file size in bytes exceeds the maximum allowed upload limit.
 */
export function isFileTooLarge(sizeInBytes?: number | null): boolean {
  if (typeof sizeInBytes !== "number" || isNaN(sizeInBytes)) return false;
  return sizeInBytes > MAX_UPLOAD_SIZE_BYTES;
}

/**
 * Check if any file in an array of Multer files or buffer sizes exceeds the limit.
 */
export function hasOversizedFile(files?: Array<{ size?: number; buffer?: Buffer }>): boolean {
  if (!files || !Array.isArray(files)) return false;
  return files.some((f) => {
    if (!f) return false;
    const s = typeof f.size === "number" ? f.size : (f.buffer?.length ?? 0);
    return isFileTooLarge(s);
  });
}

/**
 * Shared Multer memory storage instance configured with the canonical 100 MB file limit.
 */
export const sharedMulter = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    fieldSize: 50 * 1024 * 1024,
    fields: 20000,
    files: 20000,
  },
});

/**
 * Express middleware wrapper that intercepts Multer LIMIT_FILE_SIZE and oversized
 * payloads, returning a uniform HTTP 413 response matching the strict protocol.
 */
export function wrapUploadMiddleware(multerHandler: express.RequestHandler): express.RequestHandler {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    multerHandler(req, res, (err: any) => {
      if (err) {
        if (
          err.code === "LIMIT_FILE_SIZE" ||
          err.code === "LIMIT_PART_COUNT" ||
          err.type === "entity.too.large" ||
          err.status === 413 ||
          err.statusCode === 413
        ) {
          return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
        }
        return res.status(400).json({ error: err.message || "Upload failed" });
      }

      // Authoritative secondary inspection on parsed file objects
      const allFiles: Express.Multer.File[] = [];
      if (req.file) allFiles.push(req.file);
      if (Array.isArray(req.files)) {
        allFiles.push(...(req.files as Express.Multer.File[]));
      } else if (req.files && typeof req.files === "object") {
        Object.values(req.files).forEach((val) => {
          if (Array.isArray(val)) allFiles.push(...val);
        });
      }

      for (const f of allFiles) {
        if (f) {
          const sz = typeof f.size === "number" ? f.size : (f.buffer?.length ?? 0);
          if (isFileTooLarge(sz)) {
            return res.status(413).json(FILE_TOO_LARGE_PAYLOAD);
          }
        }
      }

      next();
    });
  };
}
