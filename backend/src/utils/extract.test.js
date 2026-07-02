import { describe, it } from "node:test";
import assert from "node:assert";
import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { extractArchive } from "./extract.js";

// These tests build real archives on disk with the system `zip`/`unzip`/`tar`
// CLIs (the same tools extract.js shells out to) rather than mocking, so the
// pre-extraction validation and the extraction dispatch are exercised for
// real. If a required tool is missing, the whole suite is skipped with a
// clear reason rather than failing.
function hasCli(bin) {
  try {
    execFileSync("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const HAS_ARCHIVE_TOOLS = hasCli("zip") && hasCli("unzip") && hasCli("tar");
const SKIP_REASON = HAS_ARCHIVE_TOOLS ? false : "zip/unzip/tar CLI not available in this environment";

/** Fresh scratch dir for one test, auto-namespaced under the OS tmpdir. */
function makeWorkDir() {
  return mkdtempSync(join(tmpdir(), "extract-test-"));
}

/** Build a valid zip at zipPath containing the given { relPath: content } map. */
function buildZip(workDir, zipPath, files) {
  const srcDir = join(workDir, "src-payload");
  mkdirSync(srcDir, { recursive: true });
  const relPaths = [];
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(srcDir, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
    relPaths.push(relPath);
  }
  execFileSync("zip", ["-q", zipPath, ...relPaths], { cwd: srcDir });
}

/**
 * Build a zip with two entries where the SECOND entry's compressed data is
 * corrupted (bad CRC) after archive creation. This simulates the real-world
 * failure mode the fix targets: pre-extraction member listing (`unzip -Z1`)
 * reads the central directory only and succeeds fine, so validation passes
 * and `unzip -o -q` proceeds — extracting the first entry fully to disk —
 * before hitting the corrupted second entry, printing a CRC error, and
 * exiting non-zero. That's a genuine "partial content already written, then
 * the extraction command throws" case, structurally identical to an
 * execFileSync timeout killing unzip/tar mid-decompression on a real zip
 * bomb (PRAC-05) — deterministic and fast instead of slow and huge.
 */
/**
 * Scan a zip buffer for local file header records (`PK\x03\x04`) and return
 * each entry's name and the byte range of its compressed data. Used to
 * target corruption precisely at one entry's data without touching the
 * central directory (needed for listing/validation) or other entries.
 */
function findLocalFileEntries(buf) {
  const SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const entries = [];
  let i = 0;
  while (true) {
    const idx = buf.indexOf(SIG, i);
    if (idx === -1) break;
    const compSize = buf.readUInt32LE(idx + 18);
    const fnlen = buf.readUInt16LE(idx + 26);
    const extralen = buf.readUInt16LE(idx + 28);
    const name = buf.slice(idx + 30, idx + 30 + fnlen).toString();
    const dataStart = idx + 30 + fnlen + extralen;
    const dataEnd = dataStart + compSize;
    entries.push({ name, dataStart, dataEnd });
    i = dataEnd;
  }
  return entries;
}

function buildPartialFailureZip(workDir) {
  const zipPath = join(workDir, "partial-fail.zip");
  buildZip(workDir, zipPath, {
    "a.txt": "A".repeat(50000) + Math.random(),
    "b.txt": "B".repeat(50000) + Math.random(),
  });

  const names = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf-8" })
    .split("\n").map((l) => l.trim()).filter(Boolean);
  assert.ok(names.includes("b.txt"), "expected b.txt entry in test fixture zip");

  // Corrupt bytes inside b.txt's own compressed data range only. This keeps
  // the central directory (at the true end of the file, after all local
  // entries) intact — so `unzip -Z1` listing / pre-extraction validation
  // still passes — while making the second entry's actual decompression
  // fail with a CRC mismatch once `unzip -o -q` reaches it, after a.txt has
  // already been written to disk in full.
  const buf = Buffer.from(readFileSync(zipPath));
  const entries = findLocalFileEntries(buf);
  const bEntry = entries.find((e) => e.name === "b.txt");
  assert.ok(bEntry, "expected to locate b.txt's local file header in the zip fixture");
  assert.ok(bEntry.dataEnd > bEntry.dataStart, "b.txt entry should have non-empty compressed data");
  for (let i = bEntry.dataStart; i < bEntry.dataEnd; i++) {
    buf[i] ^= 0xff;
  }
  writeFileSync(zipPath, buf);
  return zipPath;
}

/** Build a tar with a member name that escapes the extraction root via `../`. */
function buildTraversalTar(workDir) {
  const srcDir = join(workDir, "tar-src");
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, "PWNED.txt"), "traversal");
  const tarPath = join(workDir, "evil.tar");
  execFileSync(
    "tar",
    ["-cf", tarPath, "--transform", "s,^PWNED.txt,../PWNED.txt,", "PWNED.txt"],
    { cwd: srcDir }
  );
  return tarPath;
}

describe("extractArchive", () => {
  it("extracts a valid zip successfully and returns the codebase path", { skip: SKIP_REASON }, () => {
    const workDir = makeWorkDir();
    try {
      const zipPath = join(workDir, "good.zip");
      buildZip(workDir, zipPath, { "readme.txt": "hello", "src/index.js": "console.log(1)" });
      const destDir = join(workDir, "dest");

      const file = { path: zipPath, originalname: "good.zip" };
      const result = extractArchive(file, destDir);

      assert.ok(existsSync(destDir), "destDir should exist after successful extraction");
      // Two entries at the top level (readme.txt, src/) -> not unwrapped.
      assert.strictEqual(result, destDir);
      assert.ok(existsSync(join(destDir, "readme.txt")));
      assert.ok(existsSync(join(destDir, "src", "index.js")));
      // Uploaded temp archive is cleaned up.
      assert.ok(!existsSync(zipPath), "uploaded temp archive should be removed after extraction");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("removes destDir when pre-extraction member validation rejects a traversal entry", { skip: SKIP_REASON }, () => {
    const workDir = makeWorkDir();
    try {
      const tarPath = buildTraversalTar(workDir);
      const destDir = join(workDir, "dest-evil");
      const file = { path: tarPath, originalname: "evil.tar" };

      assert.throws(() => extractArchive(file, destDir));
      assert.ok(!existsSync(destDir), "destDir must not be left on disk after a rejected/failed extraction");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("reclaims destDir when the extraction command writes partial content then fails (simulated zip-bomb-timeout scenario)", { skip: SKIP_REASON }, () => {
    const workDir = makeWorkDir();
    try {
      const zipPath = buildPartialFailureZip(workDir);
      const destDir = join(workDir, "dest-partial");

      const file = { path: zipPath, originalname: "partial-fail.zip" };
      assert.throws(() => extractArchive(file, destDir));

      // Core PRAC-05 regression check: before the fix, unzip would have
      // already written a.txt (and possibly a truncated b.txt) to destDir
      // before erroring on the bad CRC, and extractArchive's catch block
      // did nothing to reclaim it — destDir would persist, orphaned, on
      // disk. After the fix, ANY throw inside the extraction try block
      // removes destDir before rethrowing.
      assert.ok(!existsSync(destDir), "destDir must be reclaimed after a mid-extraction failure");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("wipes stale content from a prior failed/partial run before retrying, instead of compounding it", { skip: SKIP_REASON }, () => {
    const workDir = makeWorkDir();
    try {
      const destDir = join(workDir, "dest-retry");
      // Simulate leftover state from a prior failed run that (pre-fix) was
      // never cleaned up: destDir exists with a stale file.
      mkdirSync(destDir, { recursive: true });
      writeFileSync(join(destDir, "stale-from-previous-attempt.txt"), "leftover");

      const zipPath = join(workDir, "good2.zip");
      buildZip(workDir, zipPath, { "fresh.txt": "new content" });
      const file = { path: zipPath, originalname: "good2.zip" };

      extractArchive(file, destDir);

      assert.ok(!existsSync(join(destDir, "stale-from-previous-attempt.txt")), "stale content from a prior attempt must not survive a retry");
      assert.ok(existsSync(join(destDir, "fresh.txt")), "fresh extraction output should be present");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
