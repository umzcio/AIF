#!/usr/bin/env node
/**
 * Resume a failed pipeline run from where it left off.
 * Reads existing pass results, runs only the missing steps.
 *
 * Usage: node src/resume-pipeline.js <run-output-dir> <codebase-path>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { loadEnv, runCLIWithRetry, extractJSON } from "./agents/shared/cli.js";
import { SYNTHESIS_PROMPT as A11Y_SYNTHESIS } from "./agents/accessibility/prompts.js";
import { SYNTHESIS_PROMPT as QA_SYNTHESIS, QA_PROMPT, PASSES as QA_PASSES } from "./agents/qa-analysis/prompts.js";
import { runDocGenerationParallel } from "./agents/documentation/runner.js";

loadEnv();

const runDir = process.argv[2];
const codebasePath = process.argv[3];

if (!runDir || !codebasePath) {
  console.error("Usage: node src/resume-pipeline.js <run-output-dir> <codebase-path>");
  process.exit(1);
}

console.log(`Resuming pipeline from: ${runDir}`);
console.log(`Codebase: ${codebasePath}\n`);

// --- Agent 2: Accessibility synthesis (if missing) ---
const a11yDir = join(runDir, "agent2_accessibility");
if (existsSync(a11yDir) && !existsSync(join(a11yDir, "synthesis.json"))) {
  console.log("=== Agent 2: Running accessibility synthesis ===");

  // Read existing pass results
  const passFiles = ["pass1", "pass2", "pass3", "pass4", "pass5"];
  const reports = {};
  for (const key of passFiles) {
    const jsonPath = join(a11yDir, `${key}.json`);
    if (existsSync(jsonPath)) {
      const parsed = JSON.parse(readFileSync(jsonPath, "utf-8"));
      reports[key] = { key, name: key, parsed };
    }
  }
  // Also check codex.json (some runs write both)
  const codexPath = join(a11yDir, "codex.json");
  if (existsSync(codexPath) && !reports.pass1) {
    reports.pass1 = { key: "pass1", name: "Pass 1 (Codex/GPT-5.4)", parsed: JSON.parse(readFileSync(codexPath, "utf-8")) };
  }

  const passCount = Object.keys(reports).length;
  console.log(`  Found ${passCount} existing pass results`);

  // Build trimmed synthesis input
  const synthesisInput = Object.entries(reports).map(([key, r]) => {
    const trimmed = {
      uiInventory: r.parsed.uiInventory,
      wcagChecklist: r.parsed.wcagChecklist || r.parsed.wcagFindings,
      findings: r.parsed.findings,
      scorecard: r.parsed.scorecard,
      scoringSignals: r.parsed.scoringSignals,
      summary: r.parsed.summary,
    };
    return `## ${r.name} (${key})\n\n${JSON.stringify(trimmed)}`;
  }).join("\n\n---\n\n");

  const fullPrompt = `${A11Y_SYNTHESIS}\n\nHere are the ${passCount} independent accessibility audit reports:\n\n${synthesisInput}`;
  console.log(`  Synthesis prompt size: ${(fullPrompt.length / 1024).toFixed(1)}KB`);

  writeFileSync(join(a11yDir, "_synthesis_input_resume.txt"), fullPrompt);

  const result = await runCLIWithRetry("claude", fullPrompt, codebasePath, a11yDir, {
    maxRetries: 1, retryDelayMs: 10000,
  });

  const synthesized = extractJSON(result.output);
  if (synthesized) {
    writeFileSync(join(a11yDir, "synthesis.json"), JSON.stringify(synthesized, null, 2));
    console.log("  ✓ Accessibility synthesis complete\n");
  } else {
    writeFileSync(join(a11yDir, "synthesis_raw.txt"), result.output);
    console.log("  ⚠ Non-JSON output, saved as synthesis_raw.txt\n");
  }
} else if (existsSync(join(a11yDir, "synthesis.json"))) {
  console.log("=== Agent 2: Accessibility synthesis already exists, skipping ===\n");
}

// --- Agent 3: QA / Bug Detection (full run if missing) ---
const qaDir = join(runDir, "agent3_qa");
if (!existsSync(join(qaDir, "synthesis.json"))) {
  console.log("=== Agent 3: Running QA / Bug Detection ===");
  mkdirSync(qaDir, { recursive: true });

  // Run 5 model passes
  const passKeys = ["pass1", "pass2", "pass3", "pass4", "pass5"];
  const passResults = await Promise.allSettled(
    passKeys.map(async (key) => {
      const pass = QA_PASSES[key];
      console.log(`  [qa] Starting ${pass.name} (${pass.tool})...`);
      const start = Date.now();
      const result = await runCLIWithRetry(pass.tool, QA_PROMPT, codebasePath, qaDir, {
        maxRetries: 1, retryDelayMs: 5000,
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  [qa] ${pass.name} completed in ${elapsed}s`);
      const parsed = extractJSON(result.output);
      if (parsed) {
        writeFileSync(join(qaDir, `${key}.json`), JSON.stringify(parsed, null, 2));
      } else {
        writeFileSync(join(qaDir, `${key}_raw.txt`), result.output);
        console.log(`  [qa] ${pass.name}: could not parse JSON`);
      }
      return { key, name: pass.name, parsed, raw: result.output };
    })
  );

  const reports = {};
  const failures = [];
  for (const r of passResults) {
    if (r.status === "fulfilled") reports[r.value.key] = r.value;
    else failures.push(r.reason.message);
  }
  const passCount = Object.keys(reports).length;
  console.log(`  ${passCount}/${passKeys.length} QA passes completed`);

  if (passCount === 0) {
    console.error("  All QA passes failed:", failures);
    process.exit(1);
  }

  // Build synthesis input
  const synthesisInput = Object.entries(reports).map(([key, r]) => {
    let content;
    if (r.parsed) {
      const trimmed = { ...r.parsed };
      delete trimmed.filesReviewed;
      content = JSON.stringify(trimmed);
    } else {
      content = r.raw.slice(0, 50000);
    }
    return `## ${r.name} (${key})\n\n${content}`;
  }).join("\n\n---\n\n");

  // Collect prior agent reports
  const sections = [];
  const a1Synth = join(runDir, "agent1_code_analysis", "synthesis.json");
  if (existsSync(a1Synth)) sections.push(`## Agent 1: Code & Security\n\n${readFileSync(a1Synth, "utf-8")}`);
  const a2Synth = join(runDir, "agent2_accessibility", "synthesis.json");
  if (existsSync(a2Synth)) sections.push(`## Agent 2: Accessibility\n\n${readFileSync(a2Synth, "utf-8")}`);
  const priorReports = sections.length ? `\n\nPRIOR AGENT REPORTS:\n\n${sections.join("\n\n---\n\n")}` : "";

  const fullPrompt = `${QA_SYNTHESIS}\n\nHere are the ${passCount} independent QA reports:\n\n${synthesisInput}${priorReports}`;
  console.log(`  QA synthesis prompt size: ${(fullPrompt.length / 1024).toFixed(1)}KB`);
  writeFileSync(join(qaDir, "_synthesis_input.txt"), fullPrompt);

  console.log("  [qa] Running synthesis with Claude...");
  const synthResult = await runCLIWithRetry("claude", fullPrompt, codebasePath, qaDir, {
    maxRetries: 1, retryDelayMs: 10000,
  });

  const qaSynthesized = extractJSON(synthResult.output);
  if (qaSynthesized) {
    writeFileSync(join(qaDir, "synthesis.json"), JSON.stringify(qaSynthesized, null, 2));
    console.log("  ✓ QA synthesis complete\n");
  } else {
    writeFileSync(join(qaDir, "synthesis_raw.txt"), synthResult.output);
    console.log("  ⚠ Non-JSON QA output\n");
  }
} else {
  console.log("=== Agent 3: QA synthesis already exists, skipping ===\n");
}

// --- Agent 4: Documentation + HECVAT ---
const docsDir = join(runDir, "agent4_documentation");
if (!existsSync(join(docsDir, "documentation.json"))) {
  console.log("=== Agent 4: Running Documentation Generation ===");
  const docs = await runDocGenerationParallel(codebasePath, runDir, docsDir, {});
  console.log("  ✓ Documentation generation complete");
  if (docs.hecvat) console.log("  ✓ HECVAT assessment complete");
  console.log();
} else {
  console.log("=== Agent 4: Documentation already exists, skipping ===\n");
}

console.log("=== Pipeline resume complete ===");
