/**
 * Orchestrator
 *
 * Takes an intake (codebase path + track) and runs the appropriate agents.
 * Agent 1: Code & Security Analysis (multi-model)
 * Agent 2: Accessibility / WCAG 2.2 AA (multi-model)
 * Agent 3: HECVAT 4 Lite Self-Assessment (single Claude pass)
 * Agent 4: Documentation Generation (single Claude pass)
 */

import { runCodeAnalysis } from "../agents/code-analysis/runner.js";
import { runAccessibilityAudit } from "../agents/accessibility/runner.js";
import { runHecvatAssessment } from "../agents/hecvat/runner.js";
import { runDocGeneration } from "../agents/documentation/runner.js";
import { join } from "path";
import { mkdirSync } from "fs";

function summarizeFindings(synthesis) {
  if (!synthesis?.findings) return null;
  const findings = synthesis.findings;
  const bySev = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    const sev = (f.severity || "info").toLowerCase();
    if (bySev[sev] !== undefined) bySev[sev]++;
    else bySev.info++;
  }
  return { total: findings.length, ...bySev, topFindings: findings.slice(0, 5).map(f => ({ severity: f.severity, title: f.title || f.finding })) };
}

const ALL_PASSES = ["pass1", "pass2", "pass3", "pass4", "pass5"];

/**
 * Run the full analysis pipeline for a submission.
 *
 * @param {object} params
 * @param {string} params.codebasePath - Absolute path to codebase
 * @param {number} params.track - 1 | 2 | 3 | 4
 * @param {string} params.toolName - Name of the tool being reviewed
 * @param {string} params.outputBase - Base directory for output
 * @returns {object} - Full pipeline results
 */
export async function runPipeline({ codebasePath, track, toolName, outputBase, onProgress }) {
  const emit = onProgress || (() => {});
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(outputBase, `${toolName.replace(/\s+/g, "_")}_${timestamp}`);
  mkdirSync(runDir, { recursive: true });

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Pipeline: ${toolName}`);
  console.log(`Track: ${track}`);
  console.log(`Codebase: ${codebasePath}`);
  console.log(`Output: ${runDir}`);
  console.log(`${"=".repeat(60)}`);

  emit({ type: "pipeline_start", toolName, track, outputDir: runDir });

  const passes = ALL_PASSES;

  const AGENTS = [
    { name: "code-analysis", label: "Code & Security Analysis", index: 0 },
    { name: "accessibility", label: "Accessibility Audit", index: 1 },
    { name: "hecvat", label: "HECVAT 4 Lite", index: 2 },
    { name: "documentation", label: "Documentation Generation", index: 3 },
  ];

  // Agent 1: Code & Security Analysis
  emit({ type: "agent_start", agent: AGENTS[0].name, label: AGENTS[0].label, index: 0, passesTotal: passes.length });
  console.log(`\nAgent 1: Code & Security Analysis (${passes.length} passes)`);
  const codeAnalysisDir = join(runDir, "agent1_code_analysis");
  const codeAnalysis = await runCodeAnalysis(codebasePath, passes, codeAnalysisDir, emit);
  const codeSummary = summarizeFindings(codeAnalysis.synthesis);
  emit({ type: "agent_complete", agent: AGENTS[0].name, index: 0, passes: Object.keys(codeAnalysis.passes).length, failures: codeAnalysis.failures.length, summary: codeSummary });

  // Agent 2: Accessibility (WCAG 2.2 AA)
  emit({ type: "agent_start", agent: AGENTS[1].name, label: AGENTS[1].label, index: 1, passesTotal: passes.length });
  console.log(`\nAgent 2: Accessibility Audit (${passes.length} passes)`);
  const accessibilityDir = join(runDir, "agent2_accessibility");
  const accessibility = await runAccessibilityAudit(codebasePath, passes, accessibilityDir, emit);
  const a11ySummary = summarizeFindings(accessibility.synthesis);
  emit({ type: "agent_complete", agent: AGENTS[1].name, index: 1, passes: Object.keys(accessibility.passes).length, failures: accessibility.failures.length, summary: a11ySummary });

  // Agent 3: HECVAT 4 Lite Self-Assessment (single Claude pass, reads Agent 1+2 outputs)
  emit({ type: "agent_start", agent: AGENTS[2].name, label: AGENTS[2].label, index: 2, passesTotal: 1 });
  console.log(`\nAgent 3: HECVAT 4 Lite Self-Assessment`);
  const hecvatDir = join(runDir, "agent3_hecvat");
  const hecvat = await runHecvatAssessment(codebasePath, runDir, hecvatDir);
  const hecvatSummary = hecvat.assessment ? {
    total: hecvat.assessment.questions?.length || 0,
    answeredFromCode: hecvat.assessment.questions?.filter(q => q.source === "code").length || 0,
    nonNegotiable: hecvat.assessment.nonNegotiableFailures?.length || 0,
    highRisk: hecvat.assessment.highRiskFindings?.length || 0,
  } : null;
  emit({ type: "agent_complete", agent: AGENTS[2].name, index: 2, passes: 1, failures: hecvat.assessment ? 0 : 1, summary: hecvatSummary });

  // Agent 4: Documentation Generation (single Claude pass, reads all prior agent outputs)
  emit({ type: "agent_start", agent: AGENTS[3].name, label: AGENTS[3].label, index: 3, passesTotal: 1 });
  console.log(`\nAgent 4: Documentation Generation`);
  const docsDir = join(runDir, "agent4_documentation");
  const documentation = await runDocGeneration(codebasePath, runDir, docsDir);
  const docSummary = documentation.documentation ? {
    docs: [
      documentation.documentation.userGuide ? "User Guide" : null,
      documentation.documentation.adminGuide ? "Admin Guide" : null,
      documentation.documentation.complianceSummary ? "Compliance Summary" : null,
    ].filter(Boolean),
    todoCount: documentation.documentation.metadata?.todoCount || 0,
  } : null;
  emit({ type: "agent_complete", agent: AGENTS[3].name, index: 3, passes: 1, failures: documentation.documentation ? 0 : 1, summary: docSummary });

  const result = {
    toolName,
    track,
    codebasePath,
    timestamp,
    outputDir: runDir,
    agents: {
      codeAnalysis: {
        passes: Object.keys(codeAnalysis.passes).length,
        failures: codeAnalysis.failures,
        synthesis: codeAnalysis.synthesis,
      },
      accessibility: {
        passes: Object.keys(accessibility.passes).length,
        failures: accessibility.failures,
        synthesis: accessibility.synthesis,
      },
      hecvat: {
        assessment: hecvat.assessment,
      },
      documentation: {
        documentation: documentation.documentation,
      },
    },
  };

  emit({ type: "pipeline_complete", result });
  return result;
}
