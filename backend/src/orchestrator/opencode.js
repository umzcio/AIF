/**
 * opencode Orchestrator
 *
 * Alternate orchestrator that mirrors orchestrator/index.js but uses
 * opencode agent definitions for OpenRouter-backed passes (2-5).
 * Pass 1 (Codex/GPT-5.4) stays as direct CLI since it's not on OpenRouter.
 * Synthesis still uses Claude Code CLI.
 * Agent 4 (docs) runs 3 parallel passes: Gemini (guides), GLM-5 (HECVAT), Claude (compliance).
 *
 * Returns the IDENTICAL result shape as runPipeline() so all downstream
 * (SSE, DB, reports, findings) works without changes.
 */

import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { PASSES as CODE_PASSES, ANALYSIS_PROMPT, SYNTHESIS_PROMPT as CODE_SYNTHESIS } from "../agents/code-analysis/lenses.js";
import { PASSES as A11Y_PASSES, ACCESSIBILITY_PROMPT, SYNTHESIS_PROMPT as A11Y_SYNTHESIS } from "../agents/accessibility/prompts.js";
import { PASSES as QA_PASSES, QA_PROMPT, SYNTHESIS_PROMPT as QA_SYNTHESIS } from "../agents/qa-analysis/prompts.js";
import { runDocGenerationParallel } from "../agents/documentation/runner.js";
import { runCLIWithRetry, extractJSON } from "../agents/shared/cli.js";
import { generateAgentDefinitions, cleanupAgentDefinitions } from "./opencode-agents.js";
import { runOpencodeAgent } from "./opencode-runner.js";
import log from "../logger.js";

function summarizeFindings(synthesis) {
  if (!synthesis?.findings) return null;
  const findings = synthesis.findings;
  const bySev = { critical: 0, high: 0, warning: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    const sev = (f.severity || "info").toLowerCase();
    if (bySev[sev] !== undefined) bySev[sev]++;
    else bySev.info++;
  }
  return { total: findings.length, ...bySev, topFindings: findings.slice(0, 5).map(f => ({ severity: f.severity, title: f.title || f.finding })) };
}

const ALL_PASSES = ["pass1", "pass2", "pass3", "pass4", "pass5"];

const AGENTS = [
  { name: "code-analysis", label: "Code & Security Analysis", index: 0, passes: CODE_PASSES, prompt: ANALYSIS_PROMPT, synthPrompt: CODE_SYNTHESIS },
  { name: "accessibility", label: "Accessibility Audit", index: 1, passes: A11Y_PASSES, prompt: ACCESSIBILITY_PROMPT, synthPrompt: A11Y_SYNTHESIS },
  { name: "qa-analysis", label: "QA / Bug Detection", index: 2, passes: QA_PASSES, prompt: QA_PROMPT, synthPrompt: QA_SYNTHESIS },
];

/** Map opencode tool identifiers to OpenRouter model strings */
const TOOL_TO_MODEL = {
  "opencode:mimo": "openrouter/xiaomi/mimo-v2-flash",
  "opencode:minimax": "openrouter/minimax/minimax-m2.5",
  "opencode:glm": "openrouter/z-ai/glm-5",
  "opencode:kimi": "openrouter/moonshotai/kimi-k2",
};

/**
 * Run a single multi-model agent using opencode agent definitions for
 * OpenRouter-backed passes, and direct CLI for Codex.
 */
async function runAgentOpencode(agentDef, codebasePath, passKeys, outputDir, emit, opts = {}) {
  const { runId, signal, previousFindings } = opts;
  mkdirSync(outputDir, { recursive: true });

  const resolvedPath = codebasePath;
  const pLog = log.child({ component: "opencode-pipeline", agent: agentDef.name, runId });
  pLog.info("Agent started (opencode mode)", { passes: passKeys.length });

  if (signal?.aborted) throw new Error("Pipeline cancelled");

  // Build opencode agent definitions for non-Codex passes
  const passConfig = {};
  for (const key of passKeys) {
    const pass = agentDef.passes[key];
    if (!pass) continue;
    if (pass.tool === "codex") continue; // Codex runs direct
    const model = TOOL_TO_MODEL[pass.tool];
    if (!model) {
      pLog.warn("No OpenRouter model mapping for tool, falling back to direct CLI", { tool: pass.tool, pass: key });
      continue;
    }
    passConfig[`${agentDef.name}-${key}`] = { model, agentType: agentDef.name };
  }

  // Generate agent definitions
  const agentMap = generateAgentDefinitions(codebasePath, passConfig);

  try {
    // Run all passes in parallel
    const passResults = await Promise.allSettled(
      passKeys.map(async (key) => {
        const pass = agentDef.passes[key];
        if (!pass) throw new Error(`Unknown pass: ${key}`);

        const agentKey = `${agentDef.name}-${key}`;
        const useOpencode = agentMap.has(agentKey);

        pLog.info(`Starting ${pass.name}`, { mode: useOpencode ? "opencode" : "direct", tool: pass.tool });
        emit({ type: "pass_start", agent: agentDef.name, pass: key, model: pass.name });
        const start = Date.now();

        const onOutput = (lines) => {
          emit({ type: "pass_log", agent: agentDef.name, pass: key, model: pass.name, lines });
        };

        let result;
        if (useOpencode) {
          // Run via opencode agent definition
          result = await runOpencodeAgent(agentMap.get(agentKey), codebasePath, { runId, signal, onOutput });
        } else {
          // Direct CLI (Codex)
          result = await runCLIWithRetry(pass.tool, agentDef.prompt, resolvedPath, outputDir, {
            runId, signal, maxRetries: 1, retryDelayMs: 5000, onOutput,
            onRetry: (attempt, err) => {
              emit({ type: "pass_retry", agent: agentDef.name, pass: key, model: pass.name, attempt, error: err.message });
            },
          });
        }

        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        pLog.info(`${pass.name} completed`, { elapsed, mode: useOpencode ? "opencode" : "direct" });

        const parsed = extractJSON(result.output);
        const outputBytes = result.output ? Buffer.byteLength(result.output, "utf8") : 0;
        if (!parsed) {
          writeFileSync(join(outputDir, `${key}_raw.txt`), result.output);
        } else {
          writeFileSync(join(outputDir, `${key}.json`), JSON.stringify(parsed, null, 2));
        }

        emit({ type: "pass_complete", agent: agentDef.name, pass: key, model: pass.name,
          elapsed: parseFloat(elapsed), jsonParsed: !!parsed, outputBytes });

        return { key, name: pass.name, parsed, raw: result.output };
      })
    );

    if (signal?.aborted) throw new Error("Pipeline cancelled");

    // Collect results
    const reports = {};
    const failures = [];
    for (const result of passResults) {
      if (result.status === "fulfilled") {
        reports[result.value.key] = result.value;
      } else {
        failures.push(result.reason.message);
        pLog.warn("Pass failed", { error: result.reason.message });
      }
    }

    const passCount = Object.keys(reports).length;
    if (passCount === 0) throw new Error("All passes failed: " + failures.join("; "));

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

    let partialCaveat = "";
    if (passCount < passKeys.length) {
      const failedModels = failures.map(f => f.split(" ")[0]).join(", ");
      partialCaveat = `\n\nIMPORTANT: Only ${passCount}/${passKeys.length} model passes completed successfully. Failed: ${failedModels}. Your synthesis is based on incomplete data. Add a note to the report metadata: "partial_analysis": true, "models_completed": ${passCount}, "models_total": ${passKeys.length}.`;
    }

    // Differential review
    let priorFindingsSection = "";
    const priorKey = agentDef.name === "code-analysis" ? "codeAnalysis" : agentDef.name === "accessibility" ? "accessibility" : "qaAnalysis";
    const priorFindings = previousFindings?.[priorKey];
    if (priorFindings?.length) {
      priorFindingsSection = `\n\n=====================================================================
PRIOR RUN FINDINGS (DIFFERENTIAL REVIEW)
=====================================================================

The following ${priorFindings.length} findings were reported in the PREVIOUS pipeline run. For each, determine current status: "resolved", "open", or "partial". New findings: "priorStatus": "new".

PRIOR FINDINGS:
${JSON.stringify(priorFindings, null, 2)}`;
    }

    const fullSynthesisPrompt = `${agentDef.synthPrompt}\n\nHere are the ${passCount} independent reports:${partialCaveat}\n\n${synthesisInput}${priorFindingsSection}`;
    writeFileSync(join(outputDir, "_synthesis_input.txt"), fullSynthesisPrompt);

    pLog.info("Running synthesis with Claude Code CLI");
    emit({ type: "pass_start", agent: agentDef.name, pass: "synthesis", model: "Claude Opus 4.6" });
    const synthOnOutput = (lines) => {
      emit({ type: "pass_log", agent: agentDef.name, pass: "synthesis", model: "Claude Opus 4.6", lines });
    };
    const synthesisResult = await runCLIWithRetry("claude", fullSynthesisPrompt, resolvedPath, outputDir, {
      runId, signal, maxRetries: 1, retryDelayMs: 10000, onOutput: synthOnOutput,
    });

    const synthesized = extractJSON(synthesisResult.output);
    if (synthesized) {
      if (passCount < passKeys.length && synthesized.metadata) {
        synthesized.metadata.partial_analysis = true;
        synthesized.metadata.models_completed = passCount;
        synthesized.metadata.models_total = passKeys.length;
      }
      writeFileSync(join(outputDir, "synthesis.json"), JSON.stringify(synthesized, null, 2));
    } else {
      writeFileSync(join(outputDir, "synthesis_raw.txt"), synthesisResult.output);
    }

    return {
      passes: reports,
      failures,
      synthesis: synthesized,
      raw: synthesisResult.output,
      partial: passCount < passKeys.length,
    };
  } finally {
    // Always clean up agent definitions
    cleanupAgentDefinitions(codebasePath);
  }
}

/**
 * Run the full pipeline using opencode agent orchestration.
 * Same signature and return shape as runPipeline() in orchestrator/index.js.
 */
export async function runOpencodePipeline({ codebasePath, track, toolName, outputBase, onProgress, runId, signal, previousFindings }) {
  const emit = onProgress || (() => {});
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(outputBase, `${toolName.replace(/\s+/g, "_")}_${timestamp}`);
  mkdirSync(runDir, { recursive: true });

  const agentOpts = { runId, signal, previousFindings };
  const pipelineLog = log.child({ component: "opencode-pipeline", runId, toolName, track });
  pipelineLog.info("Pipeline started (opencode mode)", { codebasePath, outputDir: runDir });

  emit({ type: "pipeline_start", toolName, track, outputDir: runDir, mode: "opencode" });

  const passes = ALL_PASSES;

  function checkCancel() {
    if (signal?.aborted) throw new Error("Pipeline cancelled");
  }

  // Agents 1 & 2 in parallel
  checkCancel();

  emit({ type: "agent_start", agent: "code-analysis", label: "Code & Security Analysis", index: 0, passesTotal: passes.length });
  const codeAnalysisDir = join(runDir, "agent1_code_analysis");

  emit({ type: "agent_start", agent: "accessibility", label: "Accessibility Audit", index: 1, passesTotal: passes.length });
  const accessibilityDir = join(runDir, "agent2_accessibility");

  const [codeAnalysis, accessibility] = await Promise.all([
    runAgentOpencode(AGENTS[0], codebasePath, passes, codeAnalysisDir, emit, agentOpts),
    runAgentOpencode(AGENTS[1], codebasePath, passes, accessibilityDir, emit, agentOpts),
  ]);

  const codeSummary = summarizeFindings(codeAnalysis.synthesis);
  emit({ type: "agent_complete", agent: "code-analysis", index: 0, passes: Object.keys(codeAnalysis.passes).length, failures: codeAnalysis.failures.length, summary: codeSummary, partial: codeAnalysis.partial });

  const a11ySummary = summarizeFindings(accessibility.synthesis);
  emit({ type: "agent_complete", agent: "accessibility", index: 1, passes: Object.keys(accessibility.passes).length, failures: accessibility.failures.length, summary: a11ySummary, partial: accessibility.partial });

  // Agent 3: QA
  checkCancel();
  emit({ type: "agent_start", agent: "qa-analysis", label: "QA / Bug Detection", index: 2, passesTotal: passes.length });
  const qaDir = join(runDir, "agent3_qa");
  const qaAnalysis = await runAgentOpencode(AGENTS[2], codebasePath, passes, qaDir, emit, { ...agentOpts, runDir });

  const qaSummary = summarizeFindings(qaAnalysis.synthesis);
  emit({ type: "agent_complete", agent: "qa-analysis", index: 2,
    passes: Object.keys(qaAnalysis.passes).length, failures: qaAnalysis.failures.length,
    summary: qaSummary, partial: qaAnalysis.partial });

  // Agent 4: Documentation (unchanged — always uses direct Claude CLI)
  checkCancel();
  emit({ type: "agent_start", agent: "documentation", label: "Documentation Generation", index: 3, passesTotal: 3 });
  const docsDir = join(runDir, "agent4_documentation");
  const documentation = await runDocGenerationParallel(codebasePath, runDir, docsDir, agentOpts);
  const docSummary = documentation.documentation ? {
    docs: [
      documentation.documentation.userGuide ? "User Guide" : null,
      documentation.documentation.adminGuide ? "Admin Guide" : null,
      documentation.documentation.complianceSummary ? "Compliance Summary" : null,
    ].filter(Boolean),
    todoCount: documentation.documentation.metadata?.todoCount || 0,
    hecvat: !!documentation.hecvat,
  } : null;
  const docPasses = [documentation.documentation?.userGuide, documentation.documentation?.complianceSummary, documentation.hecvat].filter(Boolean).length;
  emit({ type: "agent_complete", agent: "documentation", index: 3, passes: docPasses, failures: 3 - docPasses, summary: docSummary });

  const result = {
    toolName,
    track,
    codebasePath,
    timestamp,
    outputDir: runDir,
    pipelineMode: "opencode",
    agents: {
      codeAnalysis: {
        passes: Object.keys(codeAnalysis.passes).length,
        failures: codeAnalysis.failures,
        synthesis: codeAnalysis.synthesis,
        partial: codeAnalysis.partial,
      },
      accessibility: {
        passes: Object.keys(accessibility.passes).length,
        failures: accessibility.failures,
        synthesis: accessibility.synthesis,
        partial: accessibility.partial,
      },
      qaAnalysis: {
        passes: Object.keys(qaAnalysis.passes).length,
        failures: qaAnalysis.failures,
        synthesis: qaAnalysis.synthesis,
        partial: qaAnalysis.partial,
      },
      documentation: {
        documentation: documentation.documentation,
        hecvat: documentation.hecvat,
      },
    },
  };

  emit({ type: "pipeline_complete", result });
  return result;
}
