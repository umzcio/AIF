/**
 * Code Analysis Runner
 *
 * Executes each pass using the appropriate CLI tool (same prompt for all),
 * then synthesizes results via Claude Code CLI.
 *
 * Supports: per-pass retry, partial results (4/5 passes → synthesize with caveat),
 * abort signals for cancellation, per-model timeouts.
 */

import { spawn } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { PASSES, ANALYSIS_PROMPT, SYNTHESIS_PROMPT } from "./lenses.js";
import { runCLIWithRetry, extractJSON, loadEnv } from "../shared/cli.js";

loadEnv();

/**
 * Run Snyk agent-scan against any MCP configs or skills found in the codebase.
 * Returns parsed JSON results or null if not available/no configs found.
 */
async function runSnykAgentScan(codebasePath, outputDir) {
  // Check prerequisites
  if (!process.env.SNYK_TOKEN) {
    console.log("  ⊘ Snyk agent-scan: skipped (SNYK_TOKEN not set)");
    return null;
  }

  // Find MCP configs and skill files
  const mcpPatterns = [
    "mcp.json", "mcp_config.json", ".mcp.json",
    "claude_desktop_config.json",
    ".vscode/mcp.json", ".cursor/mcp.json",
  ];
  const foundConfigs = mcpPatterns
    .map(p => join(codebasePath, p))
    .filter(p => existsSync(p));

  // Find skill files
  const skillDirs = [
    join(codebasePath, ".claude", "skills"),
    join(codebasePath, "skills"),
  ].filter(d => existsSync(d));
  const skillFiles = [];
  try {
    const { execSync } = await import("child_process").then(m => m);
    const found = execSync(
      `find ${codebasePath} -name "SKILL.md" -o -name "*.skill.md" 2>/dev/null`,
      { encoding: "utf-8", timeout: 5000 }
    ).trim();
    if (found) skillFiles.push(...found.split("\n"));
  } catch {}

  if (foundConfigs.length === 0 && skillFiles.length === 0 && skillDirs.length === 0) {
    console.log("  ⊘ Snyk agent-scan: skipped (no MCP configs or skills found)");
    return null;
  }

  console.log(`  ▶ Running Snyk agent-scan (${foundConfigs.length} MCP configs, ${skillFiles.length + skillDirs.length} skill targets)...`);
  const start = Date.now();

  // Build scan arguments
  const args = ["snyk-agent-scan@0", "--json"]; // pin to major version 0.x
  for (const config of foundConfigs) args.push(config);
  if (skillFiles.length > 0 || skillDirs.length > 0) {
    args.push("--skills");
    for (const sf of skillFiles) args.push(sf);
    for (const sd of skillDirs) args.push(sd);
  }

  return new Promise((res) => {
    const proc = spawn("uvx", args, {
      timeout: 120000, // 2 min max
      cwd: codebasePath,
      env: { ...process.env },
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

      if (parsed) {
        writeFileSync(join(outputDir, "snyk_agent_scan.json"), JSON.stringify(parsed, null, 2));
        const issues = parsed.results?.reduce((n, r) => n + (r.issues?.length || 0), 0) || 0;
        console.log(`  ✓ Snyk agent-scan completed in ${elapsed}s (${issues} issues found)`);
      } else {
        writeFileSync(join(outputDir, "snyk_agent_scan_raw.txt"), stdout || stderr);
        console.log(`  ⚠ Snyk agent-scan completed in ${elapsed}s (could not parse output)`);
      }
      res(parsed);
    });

    proc.on("error", (err) => {
      console.log(`  ✗ Snyk agent-scan failed: ${err.message}`);
      res(null);
    });
  });
}

/**
 * Run all passes in parallel (same prompt, different models),
 * run Snyk agent-scan if applicable, then synthesize with Claude Code CLI.
 *
 * Supports per-pass retry and partial results (synthesizes even if some passes fail).
 *
 * @param {string} codebasePath - Absolute path to the codebase to analyze
 * @param {string[]} passKeys - Which passes to run (tier determines count)
 * @param {string} outputDir - Where to write results
 * @param {function} [onProgress] - Progress callback
 * @param {object} [opts] - Options
 * @param {string} [opts.runId] - Pipeline run ID (for process tracking)
 * @param {AbortSignal} [opts.signal] - AbortSignal for cancellation
 * @returns {object} - Synthesized report
 */
export async function runCodeAnalysis(codebasePath, passKeys, outputDir, onProgress, opts = {}) {
  const emit = onProgress || (() => {});
  const { runId, signal } = opts;
  mkdirSync(outputDir, { recursive: true });

  const resolvedPath = resolve(codebasePath);
  console.log(`\nCode Analysis: scanning ${resolvedPath}`);
  console.log(`Running ${passKeys.length} passes: ${passKeys.join(", ")}\n`);

  // Check cancellation
  if (signal?.aborted) throw new Error("Pipeline cancelled");

  // Run all passes + Snyk agent-scan in parallel
  const [passResults, snykResult] = await Promise.all([
    Promise.allSettled(
      passKeys.map(async (key) => {
        const pass = PASSES[key];
        if (!pass) throw new Error(`Unknown pass: ${key}`);

        console.log(`  ▶ Starting ${pass.name} (${pass.tool})...`);
        emit({ type: "pass_start", agent: "code-analysis", pass: key, model: pass.name });
        const start = Date.now();
        const result = await runCLIWithRetry(pass.tool, ANALYSIS_PROMPT, resolvedPath, outputDir, {
          runId,
          signal,
          maxRetries: 1,
          retryDelayMs: 5000,
          onRetry: (attempt, err) => {
            emit({ type: "pass_retry", agent: "code-analysis", pass: key, model: pass.name, attempt, error: err.message });
          },
        });
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`  ✓ ${pass.name} completed in ${elapsed}s`);

        // Parse the output
        const parsed = extractJSON(result.output);
        const outputBytes = result.output ? Buffer.byteLength(result.output, "utf8") : 0;
        if (!parsed) {
          console.log(`  ⚠ ${pass.name}: could not parse JSON output, saving raw`);
          writeFileSync(join(outputDir, `${key}_raw.txt`), result.output);
        } else {
          writeFileSync(join(outputDir, `${key}.json`), JSON.stringify(parsed, null, 2));
        }

        emit({ type: "pass_complete", agent: "code-analysis", pass: key, model: pass.name,
          elapsed: parseFloat(elapsed), jsonParsed: !!parsed, outputBytes });

        return { key, name: pass.name, parsed, raw: result.output };
      })
    ),
    runSnykAgentScan(resolvedPath, outputDir),
  ]);

  // Check cancellation after passes
  if (signal?.aborted) throw new Error("Pipeline cancelled");

  // Collect results
  const reports = {};
  const failures = [];
  for (const result of passResults) {
    if (result.status === "fulfilled") {
      reports[result.value.key] = result.value;
    } else {
      failures.push(result.reason.message);
      console.log(`  ✗ Pass failed: ${result.reason.message}`);
    }
  }

  const passCount = Object.keys(reports).length;
  console.log(`\n${passCount}/${passKeys.length} passes completed.`);

  if (passCount === 0) {
    throw new Error("All passes failed: " + failures.join("; "));
  }

  // Build synthesis input with partial-results caveat
  const synthesisInput = Object.entries(reports).map(([key, r]) => {
    const content = r.parsed ? JSON.stringify(r.parsed, null, 2) : r.raw.slice(0, 50000);
    return `## ${r.name} (${key})\n\n${content}`;
  }).join("\n\n---\n\n");

  // Append Snyk results if available
  let snykSection = "";
  if (snykResult) {
    snykSection = `\n\n---\n\n## Snyk Agent Scan (automated)\n\nThis is an automated scan from Snyk agent-scan, not a model report. Include its findings in the agentSecurity section of the merged report. These are tool-verified findings — treat them as confirmed.\n\n${JSON.stringify(snykResult, null, 2)}`;
  }

  // Add partial-results caveat if not all passes succeeded
  let partialCaveat = "";
  if (passCount < passKeys.length) {
    const failedModels = failures.map(f => f.split(" ")[0]).join(", ");
    partialCaveat = `\n\nIMPORTANT: Only ${passCount}/${passKeys.length} model passes completed successfully. Failed: ${failedModels}. Your synthesis is based on incomplete data. Add a note to the report metadata: "partial_analysis": true, "models_completed": ${passCount}, "models_total": ${passKeys.length}, "failed_models": [${failures.map(f => `"${f.split(" ")[0]}"`).join(", ")}].`;
  }

  // Differential review: include previous run's findings if available
  let priorFindingsSection = "";
  const priorFindings = opts.previousFindings?.codeAnalysis;
  if (priorFindings?.length) {
    priorFindingsSection = `\n\n=====================================================================
PRIOR RUN FINDINGS (DIFFERENTIAL REVIEW)
=====================================================================

The following ${priorFindings.length} findings were reported in the PREVIOUS pipeline run for this same codebase. For each prior finding, you MUST determine its current status by checking the code:

- "resolved" — the issue has been fixed in the current codebase
- "open" — the issue still exists
- "partial" — partially addressed but not fully resolved

Add a "priorStatus" field to each finding in your output. For findings that match a prior finding, also add "priorFindingTitle" with the original title.

New findings not present in the prior run should have "priorStatus": "new".

PRIOR FINDINGS:
${JSON.stringify(priorFindings, null, 2)}`;
  }

  const synthesisInputFile = join(outputDir, "_synthesis_input.txt");
  const fullSynthesisPrompt = `${SYNTHESIS_PROMPT}\n\nHere are the ${passCount} independent code analysis reports${snykResult ? " plus Snyk agent-scan results" : ""}:${partialCaveat}\n\n${synthesisInput}${snykSection}${priorFindingsSection}`;
  writeFileSync(synthesisInputFile, fullSynthesisPrompt);

  console.log("\nRunning synthesis with Claude Code CLI...");
  const synthesisResult = await runCLIWithRetry("claude", fullSynthesisPrompt, resolvedPath, outputDir, {
    runId, signal, maxRetries: 1, retryDelayMs: 10000,
  });

  const synthesized = extractJSON(synthesisResult.output);
  if (synthesized) {
    // Inject partial analysis metadata if applicable
    if (passCount < passKeys.length && synthesized.metadata) {
      synthesized.metadata.partial_analysis = true;
      synthesized.metadata.models_completed = passCount;
      synthesized.metadata.models_total = passKeys.length;
    }
    writeFileSync(join(outputDir, "synthesis.json"), JSON.stringify(synthesized, null, 2));
    console.log("✓ Synthesis complete. Report written to synthesis.json");
  } else {
    writeFileSync(join(outputDir, "synthesis_raw.txt"), synthesisResult.output);
    console.log("⚠ Synthesis produced non-JSON output. Saved as synthesis_raw.txt");
  }

  return {
    passes: reports,
    failures,
    snykAgentScan: snykResult,
    synthesis: synthesized,
    raw: synthesisResult.output,
    partial: passCount < passKeys.length,
  };
}
