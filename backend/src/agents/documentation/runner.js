/**
 * Documentation Generation Runner
 *
 * Single Claude pass — not multi-model. Reads the codebase + prior agent
 * outputs and generates three documents: User Guide, Admin Guide, Compliance Summary.
 */

import { execSync } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { DOC_PROMPT } from "./prompts.js";
import { runCLIWithRetry, extractJSON, loadEnv } from "../shared/cli.js";

loadEnv();

/**
 * Collect prior agent synthesis reports from a pipeline run directory.
 * Returns a formatted string to append to the doc prompt.
 */
function collectAgentReports(runDir) {
  const sections = [];

  // Agent 1: Code & Security Analysis
  const agent1Path = join(runDir, "agent1_code_analysis", "synthesis.json");
  if (existsSync(agent1Path)) {
    const report = readFileSync(agent1Path, "utf-8");
    sections.push(`## Agent 1: Code & Security Analysis\n\n${report}`);
  }

  // Agent 2: Accessibility (WCAG 2.2 AA)
  const agent2Path = join(runDir, "agent2_accessibility", "synthesis.json");
  if (existsSync(agent2Path)) {
    const report = readFileSync(agent2Path, "utf-8");
    sections.push(`## Agent 2: Accessibility Audit (WCAG 2.2 AA)\n\n${report}`);
  }

  // Agent 3: HECVAT Self-Assessment
  const agent3Path = join(runDir, "agent3_hecvat", "hecvat_assessment.json");
  if (existsSync(agent3Path)) {
    const report = readFileSync(agent3Path, "utf-8");
    sections.push(`## Agent 3: HECVAT 4 Lite Self-Assessment\n\n${report}`);
  }

  if (sections.length === 0) {
    return "\n\nNo prior agent reports available. Generate documentation from the codebase only.";
  }

  return `\n\n=====================================================================
PRIOR AGENT REPORTS
=====================================================================

${sections.join("\n\n---\n\n")}`;
}

/**
 * Run documentation generation.
 *
 * @param {string} codebasePath - Absolute path to the codebase
 * @param {string} runDir - Pipeline run directory (contains agent1_*, agent2_*, etc.)
 * @param {string} outputDir - Where to write documentation output
 * @returns {object} - Generated documentation
 */
export async function runDocGeneration(codebasePath, runDir, outputDir, opts = {}) {
  mkdirSync(outputDir, { recursive: true });

  const resolvedPath = resolve(codebasePath);
  console.log(`\nDocumentation Generation: ${resolvedPath}`);

  // Build the full prompt with prior agent reports
  const agentReports = collectAgentReports(runDir);
  const fullPrompt = DOC_PROMPT + agentReports;

  writeFileSync(join(outputDir, "_doc_prompt.txt"), fullPrompt);

  if (opts.signal?.aborted) throw new Error("Pipeline cancelled");

  console.log("[docs] Running documentation generation with Claude Code CLI...");
  const start = Date.now();
  const result = await runCLIWithRetry("claude", fullPrompt, resolvedPath, outputDir, {
    runId: opts.runId, signal: opts.signal, maxRetries: 1, retryDelayMs: 10000,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[docs] Claude completed in ${elapsed}s`);

  const parsed = extractJSON(result.output);
  if (parsed) {
    writeFileSync(join(outputDir, "documentation.json"), JSON.stringify(parsed, null, 2));

    // Write individual markdown files and convert to docx
    const mdFiles = [
      ["userGuide", "USER_GUIDE"],
      ["adminGuide", "ADMIN_GUIDE"],
      ["complianceSummary", "COMPLIANCE_SUMMARY"],
    ];
    for (const [key, name] of mdFiles) {
      if (parsed[key]) {
        const mdPath = join(outputDir, `${name}.md`);
        const docxPath = join(outputDir, `${name}.docx`);
        writeFileSync(mdPath, parsed[key]);
        try {
          execSync(`pandoc "${mdPath}" -o "${docxPath}" --from=markdown --to=docx`, { timeout: 30000 });
          console.log(`[docs] ${name}.docx written`);
        } catch (err) {
          console.log(`[docs] ${name}.md written (docx conversion failed: ${err.message})`);
        }
      }
    }

    const meta = parsed.metadata;
    if (meta) {
      console.log(`[docs] Tool: ${meta.toolName}`);
      console.log(`[docs] Sources: code=${meta.generatedFrom?.codeAnalysis}, a11y=${meta.generatedFrom?.accessibility}, hecvat=${meta.generatedFrom?.hecvat}`);
      console.log(`[docs] TODOs: ${meta.todoCount}, Files read: ${meta.filesRead?.length}`);
    }
  } else {
    writeFileSync(join(outputDir, "documentation_raw.txt"), result.output);
    console.log("[docs] Could not parse JSON output. Saved as documentation_raw.txt");
  }

  return {
    documentation: parsed,
    raw: result.output,
  };
}
