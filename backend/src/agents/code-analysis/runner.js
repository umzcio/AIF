/**
 * Code Analysis Runner
 *
 * Executes each pass using the appropriate CLI tool (same prompt for all),
 * then synthesizes results via Claude Code CLI.
 */

import { spawn } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { PASSES, ANALYSIS_PROMPT, SYNTHESIS_PROMPT } from "./lenses.js";
import { runCLI, extractJSON, loadEnv } from "../shared/cli.js";

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
  const args = ["snyk-agent-scan@latest", "--json"];
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
 * @param {string} codebasePath - Absolute path to the codebase to analyze
 * @param {string[]} passKeys - Which passes to run (tier determines count)
 * @param {string} outputDir - Where to write results
 * @returns {object} - Synthesized report
 */
export async function runCodeAnalysis(codebasePath, passKeys, outputDir, onProgress) {
  const emit = onProgress || (() => {});
  mkdirSync(outputDir, { recursive: true });

  const resolvedPath = resolve(codebasePath);
  console.log(`\nCode Analysis: scanning ${resolvedPath}`);
  console.log(`Running ${passKeys.length} passes: ${passKeys.join(", ")}\n`);

  // Run all passes + Snyk agent-scan in parallel
  const [passResults, snykResult] = await Promise.all([
    Promise.allSettled(
      passKeys.map(async (key) => {
        const pass = PASSES[key];
        if (!pass) throw new Error(`Unknown pass: ${key}`);

        console.log(`  ▶ Starting ${pass.name} (${pass.tool})...`);
        emit({ type: "pass_start", agent: "code-analysis", pass: key, model: pass.name });
        const start = Date.now();
        const result = await runCLI(pass.tool, ANALYSIS_PROMPT, resolvedPath, outputDir);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`  ✓ ${pass.name} completed in ${elapsed}s`);
        emit({ type: "pass_complete", agent: "code-analysis", pass: key, model: pass.name, elapsed: parseFloat(elapsed) });

        // Parse the output
        const parsed = extractJSON(result.output);
        if (!parsed) {
          console.log(`  ⚠ ${pass.name}: could not parse JSON output, saving raw`);
          writeFileSync(join(outputDir, `${key}_raw.txt`), result.output);
        } else {
          writeFileSync(join(outputDir, `${key}.json`), JSON.stringify(parsed, null, 2));
        }

        return { key, name: pass.name, parsed, raw: result.output };
      })
    ),
    runSnykAgentScan(resolvedPath, outputDir),
  ]);

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

  console.log(`\n${Object.keys(reports).length}/${passKeys.length} passes completed.`);

  if (Object.keys(reports).length === 0) {
    throw new Error("All passes failed: " + failures.join("; "));
  }

  // Build synthesis input
  const synthesisInput = Object.entries(reports).map(([key, r]) => {
    const content = r.parsed ? JSON.stringify(r.parsed, null, 2) : r.raw.slice(0, 50000);
    return `## ${r.name} (${key})\n\n${content}`;
  }).join("\n\n---\n\n");

  // Append Snyk results if available
  let snykSection = "";
  if (snykResult) {
    snykSection = `\n\n---\n\n## Snyk Agent Scan (automated)\n\nThis is an automated scan from Snyk agent-scan, not a model report. Include its findings in the agentSecurity section of the merged report. These are tool-verified findings — treat them as confirmed.\n\n${JSON.stringify(snykResult, null, 2)}`;
  }

  const synthesisInputFile = join(outputDir, "_synthesis_input.txt");
  const fullSynthesisPrompt = `${SYNTHESIS_PROMPT}\n\nHere are the ${Object.keys(reports).length} independent code analysis reports${snykResult ? " plus Snyk agent-scan results" : ""}:\n\n${synthesisInput}${snykSection}`;
  writeFileSync(synthesisInputFile, fullSynthesisPrompt);

  console.log("\nRunning synthesis with Claude Code CLI...");
  const synthesisResult = await runCLI("claude", fullSynthesisPrompt, resolvedPath, outputDir);

  const synthesized = extractJSON(synthesisResult.output);
  if (synthesized) {
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
  };
}
