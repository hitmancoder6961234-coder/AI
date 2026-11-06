/* ZIP upload pipeline: one request for small archives, 3 MB parts for larger ones (see the comment on DIRECT_ZIP_MAX_BYTES).
 * Moved out of pages/project.js unchanged so it can be unit-tested (tests/zip-upload.test.js style) without a browser. */

/* ============================================================
   ZIP Upload Pipeline & Chunked Engine
   ============================================================ */
export async function uploadZipInChunks(file, projectIdToMerge, onProgress) {
  const MAX_UPLOAD_SIZE = 104857600; // 100 MB (104,857,600 bytes)
  if (file && file.size > MAX_UPLOAD_SIZE) {
    throw new Error(`ZIP file is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed upload size is 100 MB (104,857,600 bytes).`);
  }

  const startTime = Date.now();

  const formatBytes = (bytes) => {
    if (bytes <= 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const idx = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, idx)).toFixed(2)) + " " + sizes[idx];
  };

  const formatSpeed = (bytesPerSec) => {
    if (bytesPerSec <= 0) return "Calculating...";
    if (bytesPerSec > 1024 * 1024) {
      return (bytesPerSec / (1024 * 1024)).toFixed(2) + " MB/s";
    } else if (bytesPerSec > 1024) {
      return (bytesPerSec / 1024).toFixed(1) + " KB/s";
    } else {
      return Math.round(bytesPerSec) + " B/s";
    }
  };

  const formatETA = (seconds) => {
    if (seconds === undefined || isNaN(seconds) || seconds === Infinity) return "Calculating ETA...";
    if (seconds <= 0) return "Almost done";
    if (seconds < 60) return `${seconds}s remaining`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s remaining`;
  };

  // A request body sent through the hosted front door (Vercel) is capped at about 4.5 MB (error FUNCTION_PAYLOAD_TOO_LARGE; streaming and
  // paid plans do not lift it). Stay well under it, multipart overhead included: small ZIPs go in one request, larger ones in 3 MB parts.
  const DIRECT_ZIP_MAX_BYTES = 3.5 * 1024 * 1024;
  const CHUNK_BYTES = 3 * 1024 * 1024;
  const PAYLOAD_MSG = "The hosting front door rejected this request as too large (about 4 MB per request). ZIP projects are split automatically; for other large files, open the app directly on its API server address.";
  const isFrontDoor413 = (status, text) => status === 413 && /FUNCTION_PAYLOAD_TOO_LARGE|Request Entity Too Large|Payload Too Large/i.test(String(text || ""));

  if (file.size <= DIRECT_ZIP_MAX_BYTES) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append("file", file, file.name);
      if (projectIdToMerge) {
        fd.append("projectId", projectIdToMerge);
      } else {
        fd.append("name", file.name.replace(/\.zip$/i, ""));
      }

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const percent = Math.min(99, Math.round((e.loaded / e.total) * 100));
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? e.loaded / elapsed : 0;
          const remaining = e.total - e.loaded;
          const eta = speed > 0 ? Math.ceil(remaining / speed) : undefined;
          if (onProgress) {
            onProgress(
              percent,
              `Uploading ${file.name}`,
              `Transferred ${formatBytes(e.loaded)} of ${formatBytes(e.total)} • Speed: ${formatSpeed(speed)} • ETA: ${formatETA(eta)}`
            );
          }
        }
      });

      xhr.addEventListener("load", () => {
        if (onProgress) onProgress(100, "Extracting & Analyzing Project...", "Scanning dependencies and building intelligence graphs...");
        try {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(res);
          } else {
            reject(new Error(res.error || "Upload failed with status " + xhr.status));
          }
        } catch (err) {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({ success: true, project: {} });
          } else {
            reject(new Error(isFrontDoor413(xhr.status, xhr.responseText) ? PAYLOAD_MSG : "Upload failed: " + xhr.responseText));
          }
        }
      });

      xhr.addEventListener("error", () => reject(new Error("Network transfer error")));
      xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

      const uploadUrl = window.Darkness.api ? window.Darkness.api._url("/api/projects/upload-zip") : "/api/projects/upload-zip";
      const authHeaders = (window.Darkness.api && typeof window.Darkness.api._getAuthHeaders === "function") ? window.Darkness.api._getAuthHeaders() : {};
      xhr.open("POST", uploadUrl);
      Object.entries(authHeaders).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.withCredentials = true;
      xhr.send(fd);
    });
  }

  // Chunked upload for larger archives (parts stay under the front door's request cap)
  const chunkSize = CHUNK_BYTES;
  const totalChunks = Math.ceil(file.size / chunkSize);
  const uploadId = "up_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  let resData = null;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const chunkBlob = file.slice(start, end);

    const fd = new FormData();
    fd.append("file", chunkBlob, file.name);
    fd.append("chunkIndex", i);
    fd.append("totalChunks", totalChunks);
    fd.append("uploadId", uploadId);
    if (projectIdToMerge) {
      fd.append("projectId", projectIdToMerge);
    } else {
      fd.append("name", file.name.replace(/\.zip$/i, ""));
    }

    const uploadedBefore = i * chunkSize;
    const percent = Math.min(99, Math.round((uploadedBefore / file.size) * 100));
    const elapsedMs = Date.now() - startTime;
    const speed = elapsedMs > 0 ? (uploadedBefore / (elapsedMs / 1000)) : 0;
    const remainingBytes = file.size - uploadedBefore;
    const eta = speed > 0 ? Math.ceil(remainingBytes / speed) : undefined;

    const text = `Uploading ${file.name}`;
    const secondaryText = `Part ${i + 1} of ${totalChunks} • Speed: ${formatSpeed(speed)} • ETA: ${formatETA(eta)} • ${formatBytes(uploadedBefore)} of ${formatBytes(file.size)}`;

    if (onProgress) {
      onProgress(percent, text, secondaryText);
    }

    const chunkUrl = window.Darkness.api ? window.Darkness.api._url("/api/projects/upload-zip/chunk") : "/api/projects/upload-zip/chunk";
    const chunkAuthHeaders = (window.Darkness.api && typeof window.Darkness.api._getAuthHeaders === "function") ? window.Darkness.api._getAuthHeaders() : {};

    let resp = null;
    let chunkErr = null;
    for (let cAttempt = 0; cAttempt < 3; cAttempt++) {
      try {
        resp = await fetch(chunkUrl, {
          method: "POST",
          body: fd,
          credentials: "include",
          headers: chunkAuthHeaders,
        });
        if (resp) break;
      } catch (err) {
        chunkErr = err;
        if (cAttempt < 2) await new Promise(r => setTimeout(r, 600 * (cAttempt + 1)));
      }
    }
    if (!resp) {
      throw new Error("Network connection error: " + (chunkErr?.message || "Failed to fetch chunk"));
    }

    const textRes = await resp.text();
    try { resData = JSON.parse(textRes); } catch { resData = { error: textRes }; }
    if (!resp.ok) {
      throw new Error(isFrontDoor413(resp.status, textRes) ? PAYLOAD_MSG : (resData && resData.error) || "Chunk upload failed");
    }

    const uploadedAfter = Math.min(file.size, (i + 1) * chunkSize);
    const percentAfter = Math.min(99, Math.round((uploadedAfter / file.size) * 100));
    const elapsedMsAfter = Date.now() - startTime;
    const speedAfter = elapsedMsAfter > 0 ? (uploadedAfter / (elapsedMsAfter / 1000)) : 0;
    const remainingBytesAfter = file.size - uploadedAfter;
    const etaAfter = speedAfter > 0 ? Math.ceil(remainingBytesAfter / speedAfter) : undefined;

    const textAfter = i + 1 === totalChunks ? "Extracting & processing on server..." : `Uploading ${file.name}`;
    const secondaryTextAfter = i + 1 === totalChunks
      ? "Assembling parts and scanning project files..."
      : `Part ${i + 1} of ${totalChunks} • Speed: ${formatSpeed(speedAfter)} • ETA: ${formatETA(etaAfter)} • ${formatBytes(uploadedAfter)} of ${formatBytes(file.size)}`;

    if (onProgress) {
      onProgress(percentAfter, textAfter, secondaryTextAfter);
    }
  }

  return resData;
}
