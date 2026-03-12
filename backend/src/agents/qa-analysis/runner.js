/**
 * QA / Bug Detection Runner
 *
 * Same multi-model architecture as Agents 1 & 2:
 * - All models get the SAME QA analysis prompt
 * - Each model independently analyzes the codebase
 * - Claude synthesizes with dispute resolution via filesystem access
 *
 * Reads Agent 1 & 2 outputs as context for the synthesis phase
 * (not for the per-model passes — those explore independently).
 *
 * Supports: per-pass retry, partial results, abort signals, per-model timeouts.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { PASSES, QA_PROMPT, SYNTHESIS_PROMPT } from "./prompts.js";
import { runCLIWithRetry, extractJSON, loadEnv } from "../shared/cli.js";

loadEnv();

/**
 * Collect prior agent synthesis reports from a pipeline run directory.
 * Returns a formatted string to append to the synthesis prompt.
 */
function collectPriorReports(runDir) {
  if (!runDir) return "";

  const sections = [];

  const agent1Path = join(runDir, "agent1_code_analysis", "synthesis.json");
  if (existsSync(agent1Path)) {
    const report = readFileSync(agent1Path, "utf-8");
    sections.push(`## Agent 1: Code & Security Analysis\n\n${report}`);
  }

  const agent2Path = join(runDir, "agent2_accessibility", "synthesis.json");
  if (existsSync(agent2Path)) {
    const report = readFileSync(agent2Path, "utf-8");
    sections.push(`## Agent 2: Accessibility Audit (WCAG 2.2 AA)\n\n${report}`);
  }

  if (sections.length === 0) return "";

  return `\n\n=====================================================================
PRIOR AGENT REPORTS (for context — avoid duplicating security findings)
=====================================================================

${sections.join("\n\n---\n\n")}`;
}

/**
 * Run the full QA / Bug Detection pipeline.
 *
 * @param {string} codebasePath - Absolute path to the codebase to analyze
 * @param {string[]} passKeys - Which passes to run
 * @param {string} outputDir - Where to write results
 * @param {function} [onProgress] - Progress callback
 * @param {object} [opts] - Options
 * @param {string} [opts.runId] - Pipeline run ID (for process tracking)
 * @param {AbortSignal} [opts.signal] - AbortSignal for cancellation
 * @param {string} [opts.runDir] - Pipeline run directory (for reading Agent 1+2 outputs)
 * @returns {object} - Synthesized QA report
 */
export async function runQAAnalysis(codebasePath, passKeys, outputDir, onProgress, opts = {}) {
  const emit = onProgress || (() => {});
  const { runId, signal } = opts;
  mkdirSync(outputDir, { recursive: true });

  const resolvedPath = resolve(codebasePath);
  console.log(`\nQA / Bug Detection: scanning ${resolvedPath}`);
  console.log(`Running ${passKeys.length} passes: ${passKeys.join(", ")}\n`);

  // Check cancellation
  if (signal?.aborted) throw new Error("Pipeline cancelled");

  // Run all passes in parallel — each model explores independently
  const passResults = await Promise.allSettled(
    passKeys.map(async (key) => {
      const pass = PASSES[key];
      if (!pass) throw new Error(`Unknown pass: ${key}`);

      console.log(`  [qa] Starting ${pass.name} (${pass.tool})...`);
      emit({ type: "pass_start", agent: "qa-analysis", pass: key, model: pass.name });
      const start = Date.now();
      const result = await runCLIWithRetry(pass.tool, QA_PROMPT, resolvedPath, outputDir, {
        runId,
        signal,
        maxRetries: 1,
        retryDelayMs: 5000,
        onRetry: (attempt, err) => {
          emit({ type: "pass_retry", agent: "qa-analysis", pass: key, model: pass.name, attempt, error: err.message });
        },
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  [qa] ${pass.name} completed in ${elapsed}s`);

      const parsed = extractJSON(result.output);
      const outputBytes = result.output ? Buffer.byteLength(result.output, "utf8") : 0;
      if (!parsed) {
        console.log(`  [qa] ${pass.name}: could not parse JSON output, saving raw`);
        writeFileSync(join(outputDir, `${key}_raw.txt`), result.output);
      } else {
        writeFileSync(join(outputDir, `${key}.json`), JSON.stringify(parsed, null, 2));
      }

      emit({ type: "pass_complete", agent: "qa-analysis", pass: key, model: pass.name,
        elapsed: parseFloat(elapsed), jsonParsed: !!parsed, outputBytes });

      return { key, name: pass.name, parsed, raw: result.output };
    })
  );

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
      console.log(`  [qa] Pass failed: ${result.reason.message}`);
    }
  }

  const passCount = Object.keys(reports).length;
  console.log(`\n${passCount}/${passKeys.length} QA passes completed.`);

  if (passCount === 0) {
    throw new Error("All QA passes failed: " + failures.join("; "));
  }

  // Build synthesis input with partial-results caveat
  const synthesisInput = Object.entries(reports).map(([key, r]) => {
    const content = r.parsed ? JSON.stringify(r.parsed, null, 2) : r.raw.slice(0, 50000);
    return `## ${r.name} (${key})\n\n${content}`;
  }).join("\n\n---\n\n");

  let partialCaveat = "";
  if (passCount < passKeys.length) {
    const failedModels = failures.map(f => f.split(" ")[0]).join(", ");
    partialCaveat = `\n\nIMPORTANT: Only ${passCount}/${passKeys.length} model passes completed successfully. Failed: ${failedModels}. Your synthesis is based on incomplete data. Add a note to the report metadata: "partial_analysis": true, "models_completed": ${passCount}, "models_total": ${passKeys.length}.`;
  }

  // Differential review: include previous run's findings if available
  let priorFindingsSection = "";
  const priorFindings = opts.previousFindings?.qaAnalysis;
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

  // Collect prior agent reports for context (Agent 1 + 2)
  const priorReports = collectPriorReports(opts.runDir);

  const synthesisInputFile = join(outputDir, "_synthesis_input.txt");
  const fullSynthesisPrompt = `${SYNTHESIS_PROMPT}\n\nHere are the ${passCount} independent QA / Bug Detection reports:${partialCaveat}\n\n${synthesisInput}${priorReports}${priorFindingsSection}`;
  writeFileSync(synthesisInputFile, fullSynthesisPrompt);

  console.log("\n[qa] Running synthesis with Claude Code CLI...");
  const synthesisResult = await runCLIWithRetry("claude", fullSynthesisPrompt, resolvedPath, outputDir, {
    runId, signal, maxRetries: 1, retryDelayMs: 10000,
  });

  const synthesized = extractJSON(synthesisResult.output);
  if (synthesized) {
    if (passCount < passKeys.length && synthesized.metadata) {
      synthesized.metadata.partial_analysis = true;
      synthesized.metadata.models_completed = passCount;
      synthesized.metadata.models_total = passKeys.length;
    }
    writeFileSync(join(outputDir, "synthesis.json"), JSON.stringify(synthesized, null, 2));
    console.log("[qa] Synthesis complete. Report written to synthesis.json");
  } else {
    writeFileSync(join(outputDir, "synthesis_raw.txt"), synthesisResult.output);
    console.log("[qa] Synthesis produced non-JSON output. Saved as synthesis_raw.txt");
  }

  return {
    passes: reports,
    failures,
    synthesis: synthesized,
    raw: synthesisResult.output,
    partial: passCount < passKeys.length,
  };
}
