/**
 * Semgrep SAST Scanner
 *
 * Runs Semgrep with p/default + p/owasp-top-ten rulesets against the
 * codebase for static application security testing. Catches SQL injection,
 * XSS, command injection, insecure deserialization, hardcoded secrets,
 * and other OWASP patterns mechanically.
 *
 * Same pattern as dep-audit and Snyk: runs in parallel with model passes,
 * returns null on failure, non-blocking.
 */

import { spawn } from "child_process";
import { existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import log from "../../logger.js";
import { toolEnv } from "../shared/cli.js";

/**
 * Map Semgrep severity to our schema.
 */
function mapSeverity(semgrepSev) {
  switch (semgrepSev?.toUpperCase()) {
    case "ERROR": return "high";
    case "WARNING": return "warning";
    case "INFO": return "info";
    default: return "info";
  }
}

/**
 * Map Semgrep impact (from metadata) to our schema — more granular than severity.
 */
function mapImpact(impact) {
  switch (impact?.toUpperCase()) {
    case "HIGH": return "high";
    case "MEDIUM": return "warning";
    case "LOW": return "info";
    default: return null;
  }
}

/**
 * Run Semgrep SAST scan against a codebase.
 * Returns structured findings or null if not applicable/failed.
 */
export async function runSemgrep(codebasePath, outputDir) {
  const sLog = log.child({ component: "semgrep" });

  // Check if semgrep is installed
  try {
    const { execSync } = await import("child_process");
    execSync("semgrep --version", { encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    sLog.info("Semgrep not installed, skipping SAST scan");
    return null;
  }

  // Check if there's actually code to scan
  if (!existsSync(codebasePath)) {
    sLog.warn("Codebase path does not exist", { codebasePath });
    return null;
  }

  const start = Date.now();
  sLog.info("Running Semgrep SAST scan", { codebasePath });

  const outputFile = join(outputDir, "semgrep_results.json");

  return new Promise((resolve) => {
    const proc = spawn("semgrep", [
      "--config", "p/default",
      "--config", "p/owasp-top-ten",
      "--json",
      "--output", outputFile,
      "--quiet",         // suppress progress output
      "--no-git-ignore", // don't respect .gitignore (scan everything)
      "--timeout", "60", // per-rule timeout in seconds
      codebasePath,
    ], {
      timeout: 300000, // 5 min max total
      env: toolEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      let parsed = null;
      if (existsSync(outputFile)) {
        try {
          const raw = readFileSync(outputFile, "utf-8");
          parsed = JSON.parse(raw);
        } catch {}
      }

      if (!parsed || !parsed.results) {
        if (stderr) writeFileSync(join(outputDir, "semgrep_stderr.txt"), stderr);
        sLog.warn(`Semgrep completed in ${elapsed}s (could not parse output)`, { code });
        resolve(null);
        return;
      }

      // Transform Semgrep output to our findings format
      const findings = parsed.results.map(r => {
        const meta = r.extra?.metadata || {};
        const impactSev = mapImpact(meta.impact);
        const severity = impactSev || mapSeverity(r.extra?.severity);

        // Make path relative
        const relPath = (r.path || "").replace(codebasePath + "/", "").replace(codebasePath, "");

        return {
          severity,
          ruleId: r.check_id || "unknown",
          title: `${r.check_id}: ${r.extra?.message || "Security issue detected"}`,
          detail: r.extra?.message || "",
          file: relPath,
          line: r.start?.line || 0,
          endLine: r.end?.line || 0,
          evidence: `${relPath}:${r.start?.line || 0}`,
          category: meta.category || "security",
          cwe: meta.cwe || [],
          owaspIds: meta.owasp || [],
          confidence: meta.confidence || "unknown",
          references: meta.references || [],
          tool: "semgrep",
        };
      });

      const result = {
        tool: "semgrep",
        version: parsed.version || "unknown",
        totalFindings: findings.length,
        bySeverity: {
          critical: findings.filter(f => f.severity === "critical").length,
          high: findings.filter(f => f.severity === "high").length,
          warning: findings.filter(f => f.severity === "warning").length,
          info: findings.filter(f => f.severity === "info").length,
        },
        rulesRun: parsed.results?.length > 0 ? [...new Set(parsed.results.map(r => r.check_id))].length : 0,
        errors: parsed.errors?.length || 0,
        findings,
      };

      writeFileSync(join(outputDir, "semgrep_findings.json"), JSON.stringify(result, null, 2));
      sLog.info(`Semgrep completed in ${elapsed}s`, {
        total: findings.length,
        high: result.bySeverity.high,
        warning: result.bySeverity.warning,
        rulesRun: result.rulesRun,
      });
      resolve(result);
    });

    proc.on("error", (err) => {
      sLog.warn("Semgrep failed", { error: err.message });
      resolve(null);
    });
  });
}
