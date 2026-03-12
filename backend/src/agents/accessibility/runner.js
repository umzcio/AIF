/**
 * Accessibility Analysis Runner
 *
 * Same multi-model architecture as Agent 1 (Code Analysis):
 * - All models get the SAME WCAG 2.2 AA audit prompt
 * - Each model independently analyzes the codebase
 * - Claude synthesizes with dispute resolution via filesystem access
 *
 * Supports: per-pass retry, partial results, abort signals, per-model timeouts.
 *
 * Reuses the CLI execution and JSON extraction from the shared runner utilities.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { PASSES, ACCESSIBILITY_PROMPT, SYNTHESIS_PROMPT } from "./prompts.js";
import { runCLIWithRetry, extractJSON, loadEnv } from "../shared/cli.js";

loadEnv();

/**
 * Run the full accessibility audit pipeline.
 *
 * @param {string} codebasePath - Absolute path to the codebase to analyze
 * @param {string[]} passKeys - Which passes to run (tier determines count)
 * @param {string} outputDir - Where to write results
 * @param {function} [onProgress] - Progress callback
 * @param {object} [opts] - Options
 * @param {string} [opts.runId] - Pipeline run ID (for process tracking)
 * @param {AbortSignal} [opts.signal] - AbortSignal for cancellation
 * @returns {object} - Synthesized accessibility report
 */
export async function runAccessibilityAudit(codebasePath, passKeys, outputDir, onProgress, opts = {}) {
  const emit = onProgress || (() => {});
  const { runId, signal } = opts;
  mkdirSync(outputDir, { recursive: true });

  const resolvedPath = resolve(codebasePath);
  console.log(`\nAccessibility Audit: scanning ${resolvedPath}`);
  console.log(`Running ${passKeys.length} passes: ${passKeys.join(", ")}\n`);

  // Check cancellation
  if (signal?.aborted) throw new Error("Pipeline cancelled");

  // Run all passes in parallel
  const passResults = await Promise.allSettled(
    passKeys.map(async (key) => {
      const pass = PASSES[key];
      if (!pass) throw new Error(`Unknown pass: ${key}`);

      console.log(`  [a11y] Starting ${pass.name} (${pass.tool})...`);
      emit({ type: "pass_start", agent: "accessibility", pass: key, model: pass.name });
      const start = Date.now();
      const result = await runCLIWithRetry(pass.tool, ACCESSIBILITY_PROMPT, resolvedPath, outputDir, {
        runId,
        signal,
        maxRetries: 1,
        retryDelayMs: 5000,
        onRetry: (attempt, err) => {
          emit({ type: "pass_retry", agent: "accessibility", pass: key, model: pass.name, attempt, error: err.message });
        },
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  [a11y] ${pass.name} completed in ${elapsed}s`);

      const parsed = extractJSON(result.output);
      const outputBytes = result.output ? Buffer.byteLength(result.output, "utf8") : 0;
      if (!parsed) {
        console.log(`  [a11y] ${pass.name}: could not parse JSON output, saving raw`);
        writeFileSync(join(outputDir, `${key}_raw.txt`), result.output);
      } else {
        writeFileSync(join(outputDir, `${key}.json`), JSON.stringify(parsed, null, 2));
      }

      emit({ type: "pass_complete", agent: "accessibility", pass: key, model: pass.name,
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
      console.log(`  [a11y] Pass failed: ${result.reason.message}`);
    }
  }

  const passCount = Object.keys(reports).length;
  console.log(`\n${passCount}/${passKeys.length} accessibility passes completed.`);

  if (passCount === 0) {
    throw new Error("All accessibility passes failed: " + failures.join("; "));
  }

  // Build synthesis input — keep only checklist + findings + scorecard for merging.
  // The detailed sections (ariaAudit, keyboardAccess, colorContrast, etc.) are
  // redundant with wcagChecklist entries and blow the prompt past 120KB.
  const synthesisInput = Object.entries(reports).map(([key, r]) => {
    let content;
    if (r.parsed) {
      const trimmed = {
        uiInventory: r.parsed.uiInventory,
        wcagChecklist: r.parsed.wcagChecklist || r.parsed.wcagFindings,
        findings: r.parsed.findings,
        scorecard: r.parsed.scorecard,
        scoringSignals: r.parsed.scoringSignals,
        summary: r.parsed.summary,
      };
      content = JSON.stringify(trimmed);
    } else {
      content = r.raw.slice(0, 50000);
    }
    return `## ${r.name} (${key})\n\n${content}`;
  }).join("\n\n---\n\n");

  let partialCaveat = "";
  if (passCount < passKeys.length) {
    const failedModels = failures.map(f => f.split(" ")[0]).join(", ");
    partialCaveat = `\n\nIMPORTANT: Only ${passCount}/${passKeys.length} model passes completed successfully. Failed: ${failedModels}. Your synthesis is based on incomplete data. Add a note to the report metadata: "partial_analysis": true, "models_completed": ${passCount}, "models_total": ${passKeys.length}.`;
  }

  // Differential review: include previous run's findings if available
  let priorFindingsSection = "";
  const priorFindings = opts.previousFindings?.accessibility;
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
  const fullSynthesisPrompt = `${SYNTHESIS_PROMPT}\n\nHere are the ${passCount} independent accessibility audit reports:${partialCaveat}\n\n${synthesisInput}${priorFindingsSection}`;
  writeFileSync(synthesisInputFile, fullSynthesisPrompt);

  console.log("\n[a11y] Running synthesis with Claude Code CLI...");
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
    console.log("[a11y] Synthesis complete. Report written to synthesis.json");
  } else {
    writeFileSync(join(outputDir, "synthesis_raw.txt"), synthesisResult.output);
    console.log("[a11y] Synthesis produced non-JSON output. Saved as synthesis_raw.txt");
  }

  return {
    passes: reports,
    failures,
    synthesis: synthesized,
    raw: synthesisResult.output,
    partial: passCount < passKeys.length,
  };
}
