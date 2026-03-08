/**
 * Accessibility Analysis Runner
 *
 * Same multi-model architecture as Agent 1 (Code Analysis):
 * - All models get the SAME WCAG 2.2 AA audit prompt
 * - Each model independently analyzes the codebase
 * - Claude synthesizes with dispute resolution via filesystem access
 *
 * Reuses the CLI execution and JSON extraction from the shared runner utilities.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { PASSES, ACCESSIBILITY_PROMPT, SYNTHESIS_PROMPT } from "./prompts.js";
import { runCLI, extractJSON, loadEnv } from "../shared/cli.js";

loadEnv();

/**
 * Run the full accessibility audit pipeline.
 *
 * @param {string} codebasePath - Absolute path to the codebase to analyze
 * @param {string[]} passKeys - Which passes to run (tier determines count)
 * @param {string} outputDir - Where to write results
 * @returns {object} - Synthesized accessibility report
 */
export async function runAccessibilityAudit(codebasePath, passKeys, outputDir, onProgress) {
  const emit = onProgress || (() => {});
  mkdirSync(outputDir, { recursive: true });

  const resolvedPath = resolve(codebasePath);
  console.log(`\nAccessibility Audit: scanning ${resolvedPath}`);
  console.log(`Running ${passKeys.length} passes: ${passKeys.join(", ")}\n`);

  // Run all passes in parallel
  const passResults = await Promise.allSettled(
    passKeys.map(async (key) => {
      const pass = PASSES[key];
      if (!pass) throw new Error(`Unknown pass: ${key}`);

      console.log(`  [a11y] Starting ${pass.name} (${pass.tool})...`);
      emit({ type: "pass_start", agent: "accessibility", pass: key, model: pass.name });
      const start = Date.now();
      const result = await runCLI(pass.tool, ACCESSIBILITY_PROMPT, resolvedPath, outputDir);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  [a11y] ${pass.name} completed in ${elapsed}s`);
      emit({ type: "pass_complete", agent: "accessibility", pass: key, model: pass.name, elapsed: parseFloat(elapsed) });

      const parsed = extractJSON(result.output);
      if (!parsed) {
        console.log(`  [a11y] ${pass.name}: could not parse JSON output, saving raw`);
        writeFileSync(join(outputDir, `${key}_raw.txt`), result.output);
      } else {
        writeFileSync(join(outputDir, `${key}.json`), JSON.stringify(parsed, null, 2));
      }

      return { key, name: pass.name, parsed, raw: result.output };
    })
  );

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

  console.log(`\n${Object.keys(reports).length}/${passKeys.length} accessibility passes completed.`);

  if (Object.keys(reports).length === 0) {
    throw new Error("All accessibility passes failed: " + failures.join("; "));
  }

  // Build synthesis input
  const synthesisInput = Object.entries(reports).map(([key, r]) => {
    const content = r.parsed ? JSON.stringify(r.parsed, null, 2) : r.raw.slice(0, 50000);
    return `## ${r.name} (${key})\n\n${content}`;
  }).join("\n\n---\n\n");

  const synthesisInputFile = join(outputDir, "_synthesis_input.txt");
  const fullSynthesisPrompt = `${SYNTHESIS_PROMPT}\n\nHere are the ${Object.keys(reports).length} independent accessibility audit reports:\n\n${synthesisInput}`;
  writeFileSync(synthesisInputFile, fullSynthesisPrompt);

  console.log("\n[a11y] Running synthesis with Claude Code CLI...");
  const synthesisResult = await runCLI("claude", fullSynthesisPrompt, resolvedPath, outputDir);

  const synthesized = extractJSON(synthesisResult.output);
  if (synthesized) {
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
  };
}
