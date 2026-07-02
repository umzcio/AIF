import { execFileSync } from "child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { join, resolve } from "path";

// Hard cap on cumulative decompressed size (PRAC-05). Prevents a small,
// rate-limit-friendly upload from expanding into a disk-exhaustion bomb.
const MAX_EXTRACTED_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

/**
 * Thrown when an archive fails the pre-extraction safety check (traversal,
 * absolute path, or symlink member). Distinguished from execFileSync errors
 * (e.g. "not a valid zip") so the unknown-extension fallback path in
 * extractArchive() doesn't accidentally swallow a real safety rejection and
 * silently retry with the other archive tool.
 */
class UnsafeArchiveError extends Error {}

/**
 * Reject a member name that would escape destDir: a `..` path segment or an
 * absolute path. This is the PRIMARY guard against zip-slip/tar-slip — it
 * runs BEFORE anything is written to disk (PRAC-06).
 */
function assertSafeEntryName(name) {
  if (!name) return;
  const clean = name.replace(/\/+$/, "");
  if (clean.split("/").includes("..")) {
    throw new UnsafeArchiveError(`Archive entry contains a path traversal segment: ${name}`);
  }
  if (clean.startsWith("/")) {
    throw new UnsafeArchiveError(`Archive entry has an absolute path: ${name}`);
  }
}

function listZipNames(filePath) {
  const out = execFileSync("unzip", ["-Z1", filePath], { timeout: 30000, encoding: "utf-8" });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

function assertNoZipSymlinks(filePath) {
  // zipinfo's default (non -1) listing is a `ls -l`-style table; the first
  // character of each line is the Unix file-type bit ('l' = symlink).
  const verbose = execFileSync("unzip", ["-Z", filePath], { timeout: 30000, encoding: "utf-8" });
  for (const line of verbose.split("\n")) {
    if (/^l/.test(line)) {
      throw new UnsafeArchiveError(`Archive contains a symlink entry, which is not allowed: ${line.trim()}`);
    }
  }
}

function listTarNames(filePath) {
  // GNU tar auto-detects gzip/bzip2/xz compression from the file's magic
  // bytes even without -z, so plain -tf works for both .tar and .tar.gz.
  const out = execFileSync("tar", ["-tf", filePath], { timeout: 30000, encoding: "utf-8" });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

function assertNoTarSymlinks(filePath) {
  // `tar -tvf` prints an `ls -l`-style mode string; 'l' = symlink, 'h' = hard link.
  const verbose = execFileSync("tar", ["-tvf", filePath], { timeout: 30000, encoding: "utf-8" });
  for (const line of verbose.split("\n")) {
    if (/^[lh]/.test(line)) {
      throw new UnsafeArchiveError(`Archive contains a symlink/hardlink entry, which is not allowed: ${line.trim()}`);
    }
  }
}

function validateZipMembersPreExtract(filePath) {
  const names = listZipNames(filePath);
  names.forEach(assertSafeEntryName);
  assertNoZipSymlinks(filePath);
}

function validateTarMembersPreExtract(filePath) {
  const names = listTarNames(filePath);
  names.forEach(assertSafeEntryName);
  assertNoTarSymlinks(filePath);
}

/**
 * List and validate archive members BEFORE extraction (PRAC-06 fix). Rejects
 * any entry with a `..` path segment, an absolute path, or a symlink type.
 * Dispatches by extension, falling back to zip-then-tar detection for
 * unrecognized extensions (mirroring the extraction fallback below).
 */
function validateArchiveMembersPreExtract(filePath, originalName) {
  const isZip = originalName.endsWith(".zip");
  const isTarGz = originalName.endsWith(".tar.gz") || originalName.endsWith(".tgz");
  const isTar = originalName.endsWith(".tar");

  if (isZip) {
    validateZipMembersPreExtract(filePath);
  } else if (isTarGz || isTar) {
    validateTarMembersPreExtract(filePath);
  } else {
    try {
      validateZipMembersPreExtract(filePath);
    } catch (err) {
      if (err instanceof UnsafeArchiveError) throw err;
      validateTarMembersPreExtract(filePath);
    }
  }
}

/**
 * Validate that no extracted paths escape the target directory via path
 * traversal. Kept as defense-in-depth (PRAC-06): readdirSync(recursive)
 * can only ever return entries that already live inside destDir (Node
 * builds these paths by walking the real tree rooted at destDir), so this
 * throw is effectively unreachable — the pre-extraction member check above
 * is the actual guard. Retained in case a future extraction tool changes
 * behavior underneath this function.
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

/** Sum file sizes recursively under dir. */
function sumDirSize(dir) {
  let total = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += sumDirSize(full);
    } else if (entry.isFile()) {
      total += statSync(full).size;
    }
  }
  return total;
}

/**
 * Extract an uploaded archive (zip, tar, tar.gz) into destDir.
 * Validates members against path traversal/absolute paths/symlinks BEFORE
 * extraction, and enforces a hard cap on cumulative decompressed size
 * AFTER extraction. Cleans up the uploaded temp file.
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
    // Primary guard (PRAC-06): reject unsafe members before writing anything.
    validateArchiveMembersPreExtract(filePath, originalName);

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

    // Decompression cap (PRAC-05): abort if the archive expanded past the
    // limit, regardless of its compressed upload size.
    const extractedBytes = sumDirSize(destDir);
    if (extractedBytes > MAX_EXTRACTED_BYTES) {
      rmSync(destDir, { recursive: true, force: true });
      throw new Error(`Extracted archive exceeds the ${MAX_EXTRACTED_BYTES}-byte decompression cap (was ${extractedBytes} bytes)`);
    }

    // Secondary guard, defense-in-depth only (see doc comment above).
    validateExtractedPaths(destDir);

    const entries = readdirSync(destDir);
    if (entries.length === 0) {
      throw new Error("Archive is empty — no files to analyze");
    }
    return entries.length === 1 ? join(destDir, entries[0]) : destDir;
  } finally {
    try { rmSync(filePath, { force: true }); } catch {}
  }
}
