import { execFileSync } from "child_process";
import { mkdirSync, readdirSync, rmSync } from "fs";
import { join, resolve } from "path";

/**
 * Validate that no extracted paths escape the target directory via path traversal.
 */
function validateExtractedPaths(destDir) {
  const realDest = resolve(destDir);
  const entries = readdirSync(destDir, { recursive: true });
  for (const entry of entries) {
    const fullPath = resolve(destDir, entry);
    if (!fullPath.startsWith(realDest)) {
      throw new Error(`Path traversal detected: ${entry}`);
    }
  }
}

/**
 * Extract an uploaded archive (zip, tar, tar.gz) into destDir.
 * Validates against path traversal. Cleans up the uploaded temp file.
 * Returns the effective codebase path (unwraps single-entry archives).
 *
 * @param {{ path: string, originalname?: string }} file - multer file object
 * @param {string} destDir - destination directory
 * @returns {string} resolved codebase path
 */
export function extractArchive(file, destDir) {
  mkdirSync(destDir, { recursive: true });
  const filePath = file.path;
  const originalName = file.originalname || "";

  try {
    if (originalName.endsWith(".zip")) {
      execFileSync("unzip", ["-o", "-q", filePath, "-d", destDir], { timeout: 60000 });
    } else if (originalName.endsWith(".tar.gz") || originalName.endsWith(".tgz")) {
      execFileSync("tar", ["xzf", filePath, "-C", destDir], { timeout: 60000 });
    } else if (originalName.endsWith(".tar")) {
      execFileSync("tar", ["xf", filePath, "-C", destDir], { timeout: 60000 });
    } else {
      try {
        execFileSync("unzip", ["-o", "-q", filePath, "-d", destDir], { timeout: 60000 });
      } catch {
        execFileSync("tar", ["xf", filePath, "-C", destDir], { timeout: 60000 });
      }
    }

    validateExtractedPaths(destDir);

    const entries = readdirSync(destDir);
    return entries.length === 1 ? join(destDir, entries[0]) : destDir;
  } finally {
    try { rmSync(filePath, { force: true }); } catch {}
  }
}
