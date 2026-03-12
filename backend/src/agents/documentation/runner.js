/**
 * Documentation Generation Runner
 *
 * Single Claude pass — not multi-model. Reads the codebase + prior agent
 * outputs and generates three documents: User Guide, Admin Guide, Compliance Summary.
 *
 * Also runs a second Claude call for HECVAT 4 Lite Self-Assessment
 * (moved from the former Agent 3), producing hecvat_assessment.json + .xlsx.
 */

import { execSync } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { DOC_PROMPT } from "./prompts.js";
import { HECVAT_PROMPT } from "./hecvat-prompt.js";
import { runCLIWithRetry, extractJSON, loadEnv } from "../shared/cli.js";
import { exportHecvatXlsx } from "./xlsx-export.js";

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

  // Agent 3: QA / Bug Detection (was HECVAT)
  const agent3Path = join(runDir, "agent3_qa", "synthesis.json");
  if (existsSync(agent3Path)) {
    const report = readFileSync(agent3Path, "utf-8");
    sections.push(`## Agent 3: QA / Bug Detection Analysis\n\n${report}`);
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
 * Run documentation generation + HECVAT self-assessment.
 *
 * @param {string} codebasePath - Absolute path to the codebase
 * @param {string} runDir - Pipeline run directory (contains agent1_*, agent2_*, etc.)
 * @param {string} outputDir - Where to write documentation output
 * @returns {object} - Generated documentation + HECVAT assessment
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

  // --- Call 1: Documentation generation ---
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
      console.log(`[docs] Sources: code=${meta.generatedFrom?.codeAnalysis}, a11y=${meta.generatedFrom?.accessibility}, qa=${meta.generatedFrom?.qaAnalysis}`);
      console.log(`[docs] TODOs: ${meta.todoCount}, Files read: ${meta.filesRead?.length}`);
    }
  } else {
    writeFileSync(join(outputDir, "documentation_raw.txt"), result.output);
    console.log("[docs] Could not parse JSON output. Saved as documentation_raw.txt");
  }

  // --- Call 2: HECVAT Self-Assessment ---
  if (opts.signal?.aborted) throw new Error("Pipeline cancelled");

  console.log("[docs] Running HECVAT 4 Lite assessment with Claude Code CLI...");
  const hecvatFullPrompt = HECVAT_PROMPT + agentReports;
  writeFileSync(join(outputDir, "_hecvat_prompt.txt"), hecvatFullPrompt);

  let hecvatParsed = null;
  const hecvatStart = Date.now();
  try {
    const hecvatResult = await runCLIWithRetry("claude", hecvatFullPrompt, resolvedPath, outputDir, {
      runId: opts.runId, signal: opts.signal, maxRetries: 1, retryDelayMs: 10000,
    });
    const hecvatElapsed = ((Date.now() - hecvatStart) / 1000).toFixed(1);
    console.log(`[docs/hecvat] Claude completed in ${hecvatElapsed}s`);

    hecvatParsed = extractJSON(hecvatResult.output);
    if (hecvatParsed) {
      writeFileSync(join(outputDir, "hecvat_assessment.json"), JSON.stringify(hecvatParsed, null, 2));

      // Compute scoring from flat questions array if not provided
      let s = hecvatParsed.scoring;
      if (!s && hecvatParsed.questions?.length) {
        const qs = hecvatParsed.questions;
        const yes = qs.filter(q => q.status === "yes").length;
        const no = qs.filter(q => q.status === "no").length;
        const partial = qs.filter(q => q.status === "partial").length;
        const na = qs.filter(q => q.status === "not_applicable").length;
        const human = qs.filter(q => q.status === "requires_human_input").length;
        const answerable = qs.length - human;
        s = {
          totalQuestions: qs.length,
          answeredFromCode: qs.length - human,
          requiresHumanInput: human,
          readiness: { yes, no, partial, not_applicable: na, percentage: answerable > 0 ? Math.round((yes + na) / answerable * 100) : 0 },
        };
        hecvatParsed.scoring = s;
        writeFileSync(join(outputDir, "hecvat_assessment.json"), JSON.stringify(hecvatParsed, null, 2));
      }
      if (s) {
        console.log(`[docs/hecvat] Questions: ${s.totalQuestions} total, ${s.answeredFromCode} from code, ${s.requiresHumanInput} need human input`);
        console.log(`[docs/hecvat] Readiness: ${s.readiness?.percentage}% (${s.readiness?.yes} yes, ${s.readiness?.no} no, ${s.readiness?.partial} partial, ${s.readiness?.not_applicable} n/a)`);
      }

      // Export to XLSX (filled HECVAT 4.15 template)
      try {
        const xlsxPath = join(outputDir, "hecvat_assessment.xlsx");
        exportHecvatXlsx(hecvatParsed, xlsxPath);
      } catch (err) {
        console.log(`[docs/hecvat] XLSX export failed: ${err.message}`);
      }
    } else {
      writeFileSync(join(outputDir, "hecvat_raw.txt"), hecvatResult.output);
      console.log("[docs/hecvat] Could not parse JSON output. Saved as hecvat_raw.txt");
    }
  } catch (err) {
    console.log(`[docs/hecvat] HECVAT assessment failed (non-fatal): ${err.message}`);
  }

  return {
    documentation: parsed,
    hecvat: hecvatParsed,
    raw: result.output,
  };
}
