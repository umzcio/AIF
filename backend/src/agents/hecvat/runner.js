/**
 * HECVAT Self-Assessment Runner
 *
 * Single Claude pass — reads codebase + prior agent reports (Agent 1, Agent 2)
 * and pre-populates a HECVAT 4 Lite self-assessment (87 critical questions).
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { HECVAT_PROMPT } from "./prompts.js";
import { runCLIWithRetry, extractJSON, loadEnv } from "../shared/cli.js";
import { exportHecvatXlsx } from "./xlsx-export.js";

loadEnv();

/**
 * Collect prior agent synthesis reports from a pipeline run directory.
 */
function collectAgentReports(runDir) {
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

  if (sections.length === 0) {
    return "\n\nNo prior agent reports available. Answer questions from the codebase only.";
  }

  return `\n\n=====================================================================
PRIOR AGENT REPORTS
=====================================================================

${sections.join("\n\n---\n\n")}`;
}

/**
 * Run HECVAT self-assessment.
 *
 * @param {string} codebasePath - Absolute path to the codebase
 * @param {string} runDir - Pipeline run directory (contains agent1_*, agent2_*)
 * @param {string} outputDir - Where to write HECVAT output
 * @returns {object} - HECVAT assessment results
 */
export async function runHecvatAssessment(codebasePath, runDir, outputDir, opts = {}) {
  mkdirSync(outputDir, { recursive: true });

  const resolvedPath = resolve(codebasePath);
  console.log(`\nHECVAT Self-Assessment: ${resolvedPath}`);

  const agentReports = collectAgentReports(runDir);
  const fullPrompt = HECVAT_PROMPT + agentReports;

  writeFileSync(join(outputDir, "_hecvat_prompt.txt"), fullPrompt);

  if (opts.signal?.aborted) throw new Error("Pipeline cancelled");

  console.log("[hecvat] Running HECVAT 4 Lite assessment with Claude Code CLI...");
  const start = Date.now();
  const result = await runCLIWithRetry("claude", fullPrompt, resolvedPath, outputDir, {
    runId: opts.runId, signal: opts.signal, maxRetries: 1, retryDelayMs: 10000,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[hecvat] Claude completed in ${elapsed}s`);

  const parsed = extractJSON(result.output);
  if (parsed) {
    writeFileSync(join(outputDir, "hecvat_assessment.json"), JSON.stringify(parsed, null, 2));

    // Compute scoring from flat questions array if not provided
    let s = parsed.scoring;
    if (!s && parsed.questions?.length) {
      const qs = parsed.questions;
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
      parsed.scoring = s;
      // Re-write with computed scoring
      writeFileSync(join(outputDir, "hecvat_assessment.json"), JSON.stringify(parsed, null, 2));
    }
    if (s) {
      console.log(`[hecvat] Questions: ${s.totalQuestions} total, ${s.answeredFromCode} from code, ${s.requiresHumanInput} need human input`);
      console.log(`[hecvat] Readiness: ${s.readiness?.percentage}% (${s.readiness?.yes} yes, ${s.readiness?.no} no, ${s.readiness?.partial} partial, ${s.readiness?.not_applicable} n/a)`);
    }
    if (parsed.nonNegotiableFailures?.length) {
      console.log(`[hecvat] Non-negotiable failures: ${parsed.nonNegotiableFailures.length}`);
      for (const f of parsed.nonNegotiableFailures) {
        console.log(`  - ${f.id}: ${f.detail}`);
      }
    }
    if (parsed.highRiskFindings?.length) {
      console.log(`[hecvat] High-risk findings: ${parsed.highRiskFindings.length}`);
    }

    // Export to XLSX (filled HECVAT 4.15 template)
    try {
      const xlsxPath = join(outputDir, "hecvat_assessment.xlsx");
      exportHecvatXlsx(parsed, xlsxPath);
    } catch (err) {
      console.log(`[hecvat] XLSX export failed: ${err.message}`);
    }
  } else {
    writeFileSync(join(outputDir, "hecvat_raw.txt"), result.output);
    console.log("[hecvat] Could not parse JSON output. Saved as hecvat_raw.txt");
  }

  return {
    assessment: parsed,
    raw: result.output,
  };
}
