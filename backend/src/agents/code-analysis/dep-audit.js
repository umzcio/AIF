/**
 * Dependency Vulnerability Audit
 *
 * Runs npm audit (Node.js) or pip-audit (Python) against the codebase
 * to detect known CVEs in dependencies. Zero false positives — these
 * are verified against advisory databases (GitHub Advisory / PyPI / NVD).
 *
 * Same pattern as Snyk agent-scan: runs in parallel with model passes,
 * returns null on failure, non-blocking.
 */

import { spawn } from "child_process";
import { existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import log from "../../logger.js";

/**
 * Detect the package ecosystem(s) in a codebase.
 */
function detectEcosystem(codebasePath) {
  const ecosystems = [];
  if (existsSync(join(codebasePath, "package.json"))) ecosystems.push("npm");
  if (existsSync(join(codebasePath, "package-lock.json"))) ecosystems.push("npm-lock");
  if (existsSync(join(codebasePath, "yarn.lock"))) ecosystems.push("yarn");
  if (existsSync(join(codebasePath, "requirements.txt"))) ecosystems.push("pip");
  if (existsSync(join(codebasePath, "pyproject.toml"))) ecosystems.push("pip");
  if (existsSync(join(codebasePath, "Pipfile.lock"))) ecosystems.push("pip");
  if (existsSync(join(codebasePath, "mix.lock"))) ecosystems.push("mix");
  if (existsSync(join(codebasePath, "Gemfile.lock"))) ecosystems.push("ruby");
  if (existsSync(join(codebasePath, "go.sum"))) ecosystems.push("go");
  return ecosystems;
}

/**
 * Run npm audit and return structured findings.
 */
function runNpmAudit(codebasePath, outputDir) {
  const dLog = log.child({ component: "dep-audit", ecosystem: "npm" });

  // Need package-lock.json for npm audit
  if (!existsSync(join(codebasePath, "package-lock.json"))) {
    // Try generating one (non-destructive — doesn't install)
    dLog.info("No package-lock.json found, attempting to generate");
    try {
      const { execSync } = require("child_process");
      execSync("npm install --package-lock-only --no-audit --ignore-scripts", {
        cwd: codebasePath,
        timeout: 60000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      dLog.warn("Could not generate package-lock.json, skipping npm audit");
      return Promise.resolve(null);
    }
  }

  return new Promise((resolve) => {
    const start = Date.now();
    dLog.info("Running npm audit");

    const proc = spawn("npm", ["audit", "--json", "--omit=dev"], {
      timeout: 60000,
      cwd: codebasePath,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      // npm audit exits non-zero when vulnerabilities found — that's expected
      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch {}

      if (!parsed) {
        if (stdout || stderr) writeFileSync(join(outputDir, "npm_audit_raw.txt"), stdout || stderr);
        dLog.warn(`npm audit completed in ${elapsed}s (could not parse output)`);
        resolve(null);
        return;
      }

      // Transform npm audit v2 output to our findings format
      const findings = [];
      const vulns = parsed.vulnerabilities || {};

      for (const [pkg, info] of Object.entries(vulns)) {
        // Each vulnerability entry
        const severity = info.severity || "info";
        const via = info.via || [];

        // "via" can be strings (transitive) or objects (direct advisory)
        const advisories = via.filter(v => typeof v === "object");
        const transitive = via.filter(v => typeof v === "string");

        if (advisories.length > 0) {
          for (const advisory of advisories) {
            findings.push({
              severity: mapNpmSeverity(advisory.severity || severity),
              package: pkg,
              installedVersion: info.range || "unknown",
              vulnerableRange: advisory.range || "unknown",
              title: advisory.title || `Vulnerability in ${pkg}`,
              url: advisory.url || null,
              cwe: advisory.cwe || [],
              cvss: advisory.cvss?.score || null,
              detail: `${advisory.title || "Vulnerability"} in ${pkg}. ${advisory.url || ""}`,
              evidence: `package.json (${pkg})`,
              fixAvailable: !!info.fixAvailable,
              tool: "npm-audit",
            });
          }
        } else if (transitive.length > 0) {
          // Transitive vulnerability — inherited from another package
          findings.push({
            severity: mapNpmSeverity(severity),
            package: pkg,
            installedVersion: info.range || "unknown",
            title: `Transitive vulnerability in ${pkg} (via ${transitive.join(", ")})`,
            detail: `${pkg} is vulnerable through dependency chain: ${transitive.join(" → ")}`,
            evidence: `package.json (${pkg})`,
            fixAvailable: !!info.fixAvailable,
            tool: "npm-audit",
          });
        }
      }

      const result = {
        tool: "npm-audit",
        ecosystem: "npm",
        metadata: parsed.metadata || {},
        totalVulnerabilities: findings.length,
        bySeverity: {
          critical: findings.filter(f => f.severity === "critical").length,
          high: findings.filter(f => f.severity === "high").length,
          warning: findings.filter(f => f.severity === "warning").length,
          info: findings.filter(f => f.severity === "info").length,
        },
        findings,
      };

      writeFileSync(join(outputDir, "npm_audit.json"), JSON.stringify(result, null, 2));
      dLog.info(`npm audit completed in ${elapsed}s`, {
        total: findings.length,
        critical: result.bySeverity.critical,
        high: result.bySeverity.high,
      });
      resolve(result);
    });

    proc.on("error", (err) => {
      dLog.warn("npm audit failed", { error: err.message });
      resolve(null);
    });
  });
}

function mapNpmSeverity(npmSev) {
  switch (npmSev) {
    case "critical": return "critical";
    case "high": return "high";
    case "moderate": return "warning";
    case "low": return "info";
    default: return "info";
  }
}

/**
 * Run pip-audit (Python) and return structured findings.
 */
function runPipAudit(codebasePath, outputDir) {
  const dLog = log.child({ component: "dep-audit", ecosystem: "pip" });

  // Find requirements file
  const reqFiles = ["requirements.txt", "requirements/base.txt", "requirements/prod.txt"];
  const reqFile = reqFiles.map(f => join(codebasePath, f)).find(f => existsSync(f));

  if (!reqFile) {
    dLog.info("No requirements.txt found, skipping pip-audit");
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const start = Date.now();
    dLog.info("Running pip-audit", { reqFile });

    // pip-audit via uvx (no install needed)
    const proc = spawn("uvx", ["pip-audit", "-r", reqFile, "--format", "json", "--progress-spinner=off"], {
      timeout: 120000,
      cwd: codebasePath,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch {}

      if (!parsed) {
        if (stdout || stderr) writeFileSync(join(outputDir, "pip_audit_raw.txt"), stdout || stderr);
        dLog.warn(`pip-audit completed in ${elapsed}s (could not parse output)`);
        resolve(null);
        return;
      }

      const findings = (parsed.dependencies || [])
        .filter(d => d.vulns && d.vulns.length > 0)
        .flatMap(d => d.vulns.map(v => ({
          severity: mapPipSeverity(v),
          package: d.name,
          installedVersion: d.version,
          title: `${v.id}: ${d.name} ${d.version}`,
          url: v.link || `https://osv.dev/vulnerability/${v.id}`,
          detail: `${v.id} affects ${d.name} ${d.version}. ${v.description || ""} Fix: upgrade to ${v.fix_versions?.join(" or ") || "no fix available"}.`,
          evidence: `requirements.txt (${d.name}==${d.version})`,
          fixAvailable: v.fix_versions?.length > 0,
          fixVersions: v.fix_versions || [],
          tool: "pip-audit",
        })));

      const result = {
        tool: "pip-audit",
        ecosystem: "pip",
        totalVulnerabilities: findings.length,
        bySeverity: {
          critical: findings.filter(f => f.severity === "critical").length,
          high: findings.filter(f => f.severity === "high").length,
          warning: findings.filter(f => f.severity === "warning").length,
          info: findings.filter(f => f.severity === "info").length,
        },
        findings,
      };

      writeFileSync(join(outputDir, "pip_audit.json"), JSON.stringify(result, null, 2));
      dLog.info(`pip-audit completed in ${elapsed}s`, {
        total: findings.length,
        critical: result.bySeverity.critical,
        high: result.bySeverity.high,
      });
      resolve(result);
    });

    proc.on("error", (err) => {
      dLog.warn("pip-audit failed", { error: err.message });
      resolve(null);
    });
  });
}

function mapPipSeverity(vuln) {
  // pip-audit doesn't always provide severity; use ID prefix heuristics
  const id = vuln.id || "";
  if (id.startsWith("GHSA-") || id.startsWith("CVE-")) return "high"; // default to high for advisories
  return "warning";
}

/**
 * Run dependency vulnerability audit for all detected ecosystems.
 * Returns combined results or null if nothing applicable.
 */
export async function runDepAudit(codebasePath, outputDir) {
  const ecosystems = detectEcosystem(codebasePath);
  const dLog = log.child({ component: "dep-audit" });

  if (ecosystems.length === 0) {
    dLog.info("No recognized package ecosystem detected, skipping dependency audit");
    return null;
  }

  dLog.info("Detected package ecosystems", { ecosystems });

  const results = [];

  // Run applicable audits in parallel
  const audits = [];
  if (ecosystems.includes("npm") || ecosystems.includes("npm-lock") || ecosystems.includes("yarn")) {
    audits.push(runNpmAudit(codebasePath, outputDir));
  }
  if (ecosystems.includes("pip")) {
    audits.push(runPipAudit(codebasePath, outputDir));
  }

  const settled = await Promise.allSettled(audits);
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) results.push(r.value);
  }

  if (results.length === 0) return null;

  // Combine all findings
  const combined = {
    tools: results.map(r => r.tool),
    ecosystems: results.map(r => r.ecosystem),
    totalVulnerabilities: results.reduce((n, r) => n + r.totalVulnerabilities, 0),
    bySeverity: {
      critical: results.reduce((n, r) => n + (r.bySeverity?.critical || 0), 0),
      high: results.reduce((n, r) => n + (r.bySeverity?.high || 0), 0),
      warning: results.reduce((n, r) => n + (r.bySeverity?.warning || 0), 0),
      info: results.reduce((n, r) => n + (r.bySeverity?.info || 0), 0),
    },
    findings: results.flatMap(r => r.findings),
  };

  writeFileSync(join(outputDir, "dep_audit_combined.json"), JSON.stringify(combined, null, 2));
  dLog.info("Dependency audit complete", {
    ecosystems: combined.ecosystems,
    total: combined.totalVulnerabilities,
    critical: combined.bySeverity.critical,
    high: combined.bySeverity.high,
  });

  return combined;
}
