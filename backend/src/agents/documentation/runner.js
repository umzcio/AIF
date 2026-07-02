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
import { GUIDES_PROMPT, COMPLIANCE_PROMPT } from "./prompts.js";
import { HECVAT_PROMPT } from "./hecvat-prompt.js";
import { runCLIWithRetry, extractJSON, loadEnv } from "../shared/cli.js";
import { runDirectPass, DIRECT_MODELS } from "../shared/direct-api.js";
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
 * Run documentation generation with 3 parallel passes.
 *
 * 1. Gemini 3.1 Pro Preview → User Guide + Admin Guide (CLI)
 * 2. GLM-5 → HECVAT assessment (direct OpenRouter API)
 * 3. Claude Opus 4.6 → Compliance Summary (CLI)
 */
export async function runDocGenerationParallel(codebasePath, runDir, outputDir, opts = {}) {
  mkdirSync(outputDir, { recursive: true });

  const resolvedPath = resolve(codebasePath);
  console.log(`\nDocumentation Generation (parallel mode): ${resolvedPath}`);

  const agentReports = collectAgentReports(runDir);

  if (opts.signal?.aborted) throw new Error("Pipeline cancelled");

  // Build prompts with agent reports appended
  const guidesFullPrompt = GUIDES_PROMPT + agentReports;
  const complianceFullPrompt = COMPLIANCE_PROMPT + agentReports;
  const hecvatFullPrompt = HECVAT_PROMPT + agentReports;

  writeFileSync(join(outputDir, "_guides_prompt.txt"), guidesFullPrompt);
  writeFileSync(join(outputDir, "_compliance_prompt.txt"), complianceFullPrompt);
  writeFileSync(join(outputDir, "_hecvat_prompt.txt"), hecvatFullPrompt);

  const cliOpts = { runId: opts.runId, signal: opts.signal, maxRetries: 1, retryDelayMs: 10000 };

  console.log("[docs] Starting 3 parallel passes: Gemini (guides), GLM-5 (HECVAT), Claude (compliance)");

  // Run all 3 in parallel
  const [guidesResult, hecvatResult, complianceResult] = await Promise.allSettled([
    // Pass 1: Gemini 3.1 Pro Preview → User Guide + Admin Guide
    (async () => {
      const start = Date.now();
      console.log("[docs/guides] Starting Gemini 3.1 Pro Preview...");
      const result = await runCLIWithRetry("gemini", guidesFullPrompt, resolvedPath, outputDir, cliOpts);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[docs/guides] Gemini completed in ${elapsed}s`);
      return result;
    })(),

    // Pass 2: GLM-5 via direct OpenRouter API → HECVAT
    (async () => {
      const start = Date.now();
      console.log("[docs/hecvat] Starting GLM-5 via direct API...");
      const result = await runDirectPass(DIRECT_MODELS.pass5, hecvatFullPrompt, opts.codeBundle || "", outputDir, {
        runId: opts.runId,
        signal: opts.signal,
        timeout: 25 * 60 * 1000, // 25 min for HECVAT
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[docs/hecvat] GLM-5 completed in ${elapsed}s`);
      return result;
    })(),

    // Pass 3: Claude Opus 4.6 → Compliance Summary
    (async () => {
      const start = Date.now();
      console.log("[docs/compliance] Starting Claude Opus 4.6...");
      const result = await runCLIWithRetry("claude", complianceFullPrompt, resolvedPath, outputDir, cliOpts);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[docs/compliance] Claude completed in ${elapsed}s`);
      return result;
    })(),
  ]);

  // Process guides result
  let guidesParsed = null;
  if (guidesResult.status === "fulfilled") {
    guidesParsed = extractJSON(guidesResult.value.output);
    if (guidesParsed) {
      writeFileSync(join(outputDir, "guides.json"), JSON.stringify(guidesParsed, null, 2));
    } else {
      writeFileSync(join(outputDir, "guides_raw.txt"), guidesResult.value.output);
      console.log("[docs/guides] Could not parse JSON output. Saved as guides_raw.txt");
    }
  } else {
    console.log(`[docs/guides] Gemini failed: ${guidesResult.reason.message}`);
  }

  // Process compliance result
  let complianceParsed = null;
  if (complianceResult.status === "fulfilled") {
    complianceParsed = extractJSON(complianceResult.value.output);
    if (complianceParsed) {
      writeFileSync(join(outputDir, "compliance.json"), JSON.stringify(complianceParsed, null, 2));
    } else {
      writeFileSync(join(outputDir, "compliance_raw.txt"), complianceResult.value.output);
      console.log("[docs/compliance] Could not parse JSON output. Saved as compliance_raw.txt");
    }
  } else {
    console.log(`[docs/compliance] Claude failed: ${complianceResult.reason.message}`);
  }

  // Merge into the unified documentation return shape
  const parsed = {
    userGuide: guidesParsed?.userGuide || null,
    adminGuide: guidesParsed?.adminGuide || null,
    complianceSummary: complianceParsed?.complianceSummary || null,
    metadata: {
      toolName: guidesParsed?.metadata?.toolName || complianceParsed?.metadata?.toolName || "Unknown",
      generatedFrom: {
        codeAnalysis: guidesParsed?.metadata?.generatedFrom?.codeAnalysis || complianceParsed?.metadata?.generatedFrom?.codeAnalysis || false,
        accessibility: guidesParsed?.metadata?.generatedFrom?.accessibility || complianceParsed?.metadata?.generatedFrom?.accessibility || false,
        qaAnalysis: guidesParsed?.metadata?.generatedFrom?.qaAnalysis || complianceParsed?.metadata?.generatedFrom?.qaAnalysis || false,
      },
      filesRead: guidesParsed?.metadata?.filesRead || [],
      todoCount: (guidesParsed?.metadata?.todoCount || 0) + (complianceParsed?.metadata?.todoCount || 0),
      wordCount: {
        userGuide: guidesParsed?.metadata?.wordCount?.userGuide || 0,
        adminGuide: guidesParsed?.metadata?.wordCount?.adminGuide || 0,
        complianceSummary: complianceParsed?.metadata?.wordCount || 0,
      },
    },
  };

  // Write merged documentation.json
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

  // Process HECVAT result
  let hecvatParsed = null;
  if (hecvatResult.status === "fulfilled") {
    // runDirectPass returns { output, parsed, ... } — parsed is already done
    hecvatParsed = hecvatResult.value.parsed || extractJSON(hecvatResult.value.output);
    if (hecvatParsed) {
      writeFileSync(join(outputDir, "hecvat_assessment.json"), JSON.stringify(hecvatParsed, null, 2));

      // Compute scoring if not provided
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

      // Export to XLSX
      try {
        const xlsxPath = join(outputDir, "hecvat_assessment.xlsx");
        exportHecvatXlsx(hecvatParsed, xlsxPath);
      } catch (err) {
        console.log(`[docs/hecvat] XLSX export failed: ${err.message}`);
      }
    } else {
      writeFileSync(join(outputDir, "hecvat_raw.txt"), hecvatResult.value.output);
      console.log("[docs/hecvat] Could not parse JSON output. Saved as hecvat_raw.txt");
    }
  } else {
    console.log(`[docs/hecvat] GLM-5 failed (non-fatal): ${hecvatResult.reason.message}`);
  }

  return {
    documentation: parsed,
    hecvat: hecvatParsed,
    raw: guidesResult.status === "fulfilled" ? guidesResult.value.output : null,
  };
}
