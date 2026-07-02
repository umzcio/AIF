/**
 * Pipeline Orchestrator
 *
 * Drives the full 4-agent pipeline. Pass 1 (Codex) runs via CLI,
 * passes 2-5 run via direct OpenRouter API, synthesis runs via Claude Code CLI.
 * Deterministic tools (Semgrep, ESLint, npm audit, Snyk) run in parallel with model passes.
 */

import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { PASSES as CODE_PASSES, ANALYSIS_PROMPT, SYNTHESIS_PROMPT as CODE_SYNTHESIS, buildStackChecklists, STACK_SYNTHESIS_PROMPT } from "../agents/code-analysis/lenses.js";
import { PASSES as A11Y_PASSES, ACCESSIBILITY_PROMPT, SYNTHESIS_PROMPT as A11Y_SYNTHESIS } from "../agents/accessibility/prompts.js";
import { runA11yLinter } from "../agents/accessibility/linter.js";
import { runDepAudit } from "../agents/code-analysis/dep-audit.js";
import { runSemgrep } from "../agents/code-analysis/semgrep.js";
import { runEslintQA } from "../agents/qa-analysis/eslint-qa.js";
import { PASSES as QA_PASSES, QA_PROMPT, SYNTHESIS_PROMPT as QA_SYNTHESIS } from "../agents/qa-analysis/prompts.js";
import { runDocGenerationParallel } from "../agents/documentation/runner.js";
import { runCLIWithRetry, extractJSON } from "../agents/shared/cli.js";
import { PROMPT_SUFFIX } from "../agents/shared/direct-api.js";
import { runDirectPass, DIRECT_MODELS } from "../agents/shared/direct-api.js";
import { bundleCodebase } from "../agents/shared/codebase-bundle.js";
import { CODE_ANALYSIS_SCHEMA } from "../agents/code-analysis/schema.js";
import { ACCESSIBILITY_SCHEMA } from "../agents/accessibility/schema.js";
import { QA_SCHEMA } from "../agents/qa-analysis/schema.js";
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
  { name: "code-analysis", label: "Code & Security Analysis", index: 0, passes: CODE_PASSES, prompt: ANALYSIS_PROMPT, synthPrompt: CODE_SYNTHESIS, schema: CODE_ANALYSIS_SCHEMA },
  { name: "accessibility", label: "Accessibility Audit", index: 1, passes: A11Y_PASSES, prompt: ACCESSIBILITY_PROMPT, synthPrompt: A11Y_SYNTHESIS, schema: ACCESSIBILITY_SCHEMA },
  { name: "qa-analysis", label: "QA / Bug Detection", index: 2, passes: QA_PASSES, prompt: QA_PROMPT, synthPrompt: QA_SYNTHESIS, schema: QA_SCHEMA },
];

/**
 * Run a single multi-model agent using direct API for OpenRouter passes
 * and Codex CLI for pass 1.
 */
async function runAgentDirect(agentDef, codebasePath, codeBundle, passKeys, outputDir, emit, opts = {}) {
  const { runId, signal, previousFindings } = opts;
  mkdirSync(outputDir, { recursive: true });

  const pLog = log.child({ component: "direct-api-pipeline", agent: agentDef.name, runId });
  pLog.info("Agent started (direct-api mode)", { passes: passKeys.length });

  if (signal?.aborted) throw new Error("Pipeline cancelled");

  // Run all passes in parallel
  const passResults = await Promise.allSettled(
    passKeys.map(async (key) => {
      const pass = agentDef.passes[key];
      if (!pass) throw new Error(`Unknown pass: ${key}`);

      const isCodex = pass.tool === "codex";
      const directModel = !isCodex ? DIRECT_MODELS[key] : null;
      const mode = isCodex ? "codex-cli" : "direct-api";

      pLog.info(`Starting ${pass.name}`, { mode, model: directModel?.model || pass.tool });
      emit({ type: "pass_start", agent: agentDef.name, pass: key, model: pass.name });
      const start = Date.now();

      const onOutput = (lines) => {
        emit({ type: "pass_log", agent: agentDef.name, pass: key, model: pass.name, lines });
      };

      let result;
      if (isCodex) {
        // Pass 1: Codex CLI (unchanged)
        result = await runCLIWithRetry(pass.tool, agentDef.prompt + PROMPT_SUFFIX, codebasePath, outputDir, {
          runId, signal, maxRetries: 1, retryDelayMs: 5000, onOutput,
          onRetry: (attempt, err) => {
            emit({ type: "pass_retry", agent: agentDef.name, pass: key, model: pass.name, attempt, error: err.message });
          },
        });
        // Codex returns { output, ... } — parse with extractJSON
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        pLog.info(`${pass.name} completed`, { elapsed, mode });

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
      } else {
        // Passes 2-5: Direct OpenRouter API
        if (!directModel) throw new Error(`No direct model configured for ${key}`);

        const directResult = await runDirectPass(directModel, agentDef.prompt, codeBundle, outputDir, {
          runId, signal, schema: agentDef.schema, onOutput,
          timeout: 10 * 60 * 1000, // 10 minutes
        });

        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        pLog.info(`${pass.name} completed`, {
          elapsed, mode, attempt: directResult.attempt,
          jsonParsed: !!directResult.parsed,
          usage: directResult.usage,
          finishReason: directResult.finishReason,
        });

        const outputBytes = directResult.output ? Buffer.byteLength(directResult.output, "utf8") : 0;
        if (directResult.parsed) {
          writeFileSync(join(outputDir, `${key}.json`), JSON.stringify(directResult.parsed, null, 2));
        } else {
          writeFileSync(join(outputDir, `${key}_raw.txt`), directResult.output || "no output");
        }

        emit({ type: "pass_complete", agent: agentDef.name, pass: key, model: pass.name,
          elapsed: parseFloat(elapsed), jsonParsed: !!directResult.parsed, outputBytes });

        return { key, name: pass.name, parsed: directResult.parsed, raw: directResult.output };
      }
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

  // Build synthesis input — trim verbose sections to keep prompt under ~80KB
  const MAX_PASS_CHARS = 15000;
  const synthesisInput = Object.entries(reports).map(([key, r]) => {
    let content;
    if (r.parsed) {
      const trimmed = { ...r.parsed };
      delete trimmed.filesReviewed;
      if (trimmed.wcagChecklist && typeof trimmed.wcagChecklist === "object") {
        for (const [, val] of Object.entries(trimmed.wcagChecklist)) {
          if (typeof val === "object" && val !== null) {
            for (const field of ["detail", "evidence", "notes", "description"]) {
              if (typeof val[field] === "string" && val[field].length > 200) {
                val[field] = val[field].slice(0, 200) + "…";
              }
            }
          }
        }
      }
      content = JSON.stringify(trimmed);
      if (content.length > MAX_PASS_CHARS) {
        pLog.info("Truncating verbose pass for synthesis", { pass: key, original: content.length, truncated: MAX_PASS_CHARS });
        content = content.slice(0, MAX_PASS_CHARS) + '…(truncated)';
      }
    } else {
      content = (r.raw || "").slice(0, MAX_PASS_CHARS);
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
  const synthesisResult = await runCLIWithRetry("claude", fullSynthesisPrompt, codebasePath, outputDir, {
    runId, signal, maxRetries: 1, retryDelayMs: 10000, onOutput: synthOnOutput,
  });

  let synthesized = extractJSON(synthesisResult.output);
  if (synthesized) {
    if (passCount < passKeys.length && synthesized.metadata) {
      synthesized.metadata.partial_analysis = true;
      synthesized.metadata.models_completed = passCount;
      synthesized.metadata.models_total = passKeys.length;
    }
    writeFileSync(join(outputDir, "synthesis.json"), JSON.stringify(synthesized, null, 2));

    // Stack-specific deep dive (Agent 1 only)
    if (agentDef.name === "code-analysis" && synthesized.inventory) {
      const stackChecklists = buildStackChecklists(synthesized.inventory);
      if (stackChecklists) {
        pLog.info("Running stack-specific deep dive", {
          checklists: stackChecklists.split("###").length - 1,
        });
        emit({ type: "pass_start", agent: agentDef.name, pass: "stack-check", model: "Claude Opus 4.6" });
        const stackOnOutput = (lines) => {
          emit({ type: "pass_log", agent: agentDef.name, pass: "stack-check", model: "Claude Opus 4.6", lines });
        };

        const existingTitles = (synthesized.findings || []).map(f => f.title || "").join("\n- ");
        const stackPrompt = STACK_SYNTHESIS_PROMPT
          .replace("{EXISTING_FINDINGS}", existingTitles ? `- ${existingTitles}` : "(none)")
          .replace("{STACK_CHECKLISTS}", stackChecklists);

        writeFileSync(join(outputDir, "_stack_synthesis_input.txt"), stackPrompt);

        try {
          const stackResult = await runCLIWithRetry("claude", stackPrompt, codebasePath, outputDir, {
            runId, signal, maxRetries: 1, retryDelayMs: 10000, onOutput: stackOnOutput,
          });

          const stackData = extractJSON(stackResult.output);
          if (stackData?.stackFindings?.length) {
            pLog.info("Stack deep dive found new findings", { count: stackData.stackFindings.length });
            synthesized.findings = [...(synthesized.findings || []), ...stackData.stackFindings];
            synthesized.stackDeepDive = {
              checklistsEvaluated: stackData.checklistsEvaluated || [],
              itemsChecked: stackData.itemsChecked || 0,
              itemsFailed: stackData.itemsFailed || 0,
              summary: stackData.summary || "",
            };
            writeFileSync(join(outputDir, "synthesis.json"), JSON.stringify(synthesized, null, 2));
          } else {
            pLog.info("Stack deep dive found no new findings");
            synthesized.stackDeepDive = {
              checklistsEvaluated: stackData?.checklistsEvaluated || [],
              itemsChecked: stackData?.itemsChecked || 0,
              itemsFailed: 0,
              summary: stackData?.summary || "No additional stack-specific issues found",
            };
            writeFileSync(join(outputDir, "synthesis.json"), JSON.stringify(synthesized, null, 2));
          }
          writeFileSync(join(outputDir, "stack_deep_dive.json"), JSON.stringify(stackData, null, 2));
          emit({ type: "pass_complete", agent: agentDef.name, pass: "stack-check", model: "Claude Opus 4.6",
            elapsed: 0, jsonParsed: !!stackData, outputBytes: stackResult.output?.length || 0 });
        } catch (err) {
          pLog.warn("Stack deep dive failed (non-fatal)", { error: err.message });
          emit({ type: "pass_failed", agent: agentDef.name, pass: "stack-check", model: "Claude Opus 4.6",
            error: err.message, errorCategory: "stack_deep_dive" });
        }
      } else {
        pLog.info("No applicable stack checklists for this codebase");
      }
    }
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
}

/**
 * Run the full pipeline.
 * Returns { toolName, track, outputDir, runDir, agents: { codeAnalysis, accessibility, qa, documentation } }.
 */
export async function runDirectApiPipeline({ codebasePath, track, toolName, outputBase, onProgress, runId, signal, previousFindings }) {
  const emit = onProgress || (() => {});
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(outputBase, `${toolName.replace(/\s+/g, "_")}_${timestamp}`);
  mkdirSync(runDir, { recursive: true });

  const agentOpts = { runId, signal, previousFindings };
  const pipelineLog = log.child({ component: "direct-api-pipeline", runId, toolName, track });
  pipelineLog.info("Pipeline started (direct-api mode)", { codebasePath, outputDir: runDir });

  emit({ type: "pipeline_start", toolName, track, outputDir: runDir, mode: "direct-api" });

  // Bundle codebase once, reuse for all agents
  pipelineLog.info("Bundling codebase");
  const bundle = await bundleCodebase(codebasePath);
  pipelineLog.info("Codebase bundled", {
    files: bundle.totalFiles, chars: bundle.totalChars, truncated: bundle.truncated, excluded: bundle.excluded.length,
  });
  writeFileSync(join(runDir, "_bundle_manifest.json"), JSON.stringify({
    files: bundle.manifest, excluded: bundle.excluded,
    totalFiles: bundle.totalFiles, totalChars: bundle.totalChars, truncated: bundle.truncated,
  }, null, 2));

  const codeBundle = bundle.bundle;
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

  // Wrap tool calls with SSE events
  async function runToolWithEvents(name, target, fn) {
    pipelineLog.info("Tool started", { tool: name, target });
    emit({ type: "tool_start", tool: name, target });
    const start = Date.now();
    try {
      const result = await fn();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const findings = result?.findings?.length || result?.totalVulnerabilities || 0;
      emit({ type: "tool_complete", tool: name, target, elapsed: parseFloat(elapsed), findings, skipped: !result });
      return result;
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      emit({ type: "tool_complete", tool: name, target, elapsed: parseFloat(elapsed), findings: 0, skipped: true, error: err.message });
      pipelineLog.warn(`${name} failed (non-fatal)`, { error: err.message });
      return null;
    }
  }

  const [codeAnalysis, accessibility, a11yLinterResult, depAuditResult, semgrepResult] = await Promise.all([
    runAgentDirect(AGENTS[0], codebasePath, codeBundle, passes, codeAnalysisDir, emit, agentOpts),
    runAgentDirect(AGENTS[1], codebasePath, codeBundle, passes, accessibilityDir, emit, agentOpts),
    runToolWithEvents("jsx-a11y", "accessibility", () => runA11yLinter(codebasePath, join(runDir, "agent2_accessibility"))),
    runToolWithEvents("npm-audit", "security", () => runDepAudit(codebasePath, join(runDir, "agent1_code_analysis"))),
    runToolWithEvents("semgrep", "security", () => runSemgrep(codebasePath, join(runDir, "agent1_code_analysis"))),
  ]);

  // Emit tools_summary so late-connecting SSE clients get tool states
  emit({ type: "tools_summary", tools: {
    "jsx-a11y": { status: a11yLinterResult ? "complete" : "skipped", findings: a11yLinterResult?.findings?.length || 0 },
    "npm-audit": { status: depAuditResult ? "complete" : "skipped", findings: depAuditResult?.totalVulnerabilities || 0 },
    "semgrep": { status: semgrepResult ? "complete" : "skipped", findings: semgrepResult?.findings?.length || 0 },
  }});

  // Merge linter findings into Agent 2 synthesis
  if (a11yLinterResult?.findings?.length && accessibility.synthesis) {
    const linterFindings = a11yLinterResult.findings.map(f => ({
      severity: f.severity,
      category: f.ruleId?.replace("jsx-a11y/", "") || "linter",
      title: f.title, detail: f.detail, evidence: f.evidence,
      reportedBy: ["eslint-plugin-jsx-a11y"], convergenceCount: 1, confidence: "confirmed", toolVerified: true,
    }));
    accessibility.synthesis.findings = [...(accessibility.synthesis.findings || []), ...linterFindings];
    accessibility.synthesis.a11yLinter = {
      tool: a11yLinterResult.tool, filesScanned: a11yLinterResult.totalFiles,
      errors: a11yLinterResult.totalErrors, warnings: a11yLinterResult.totalWarnings, findingsAdded: linterFindings.length,
    };
    writeFileSync(join(runDir, "agent2_accessibility", "synthesis.json"), JSON.stringify(accessibility.synthesis, null, 2));
    pipelineLog.info("Merged a11y linter findings into Agent 2 synthesis", { count: linterFindings.length });
  }

  // Merge dependency audit findings into Agent 1 synthesis
  if (depAuditResult?.findings?.length && codeAnalysis.synthesis) {
    const depFindings = depAuditResult.findings.map(f => ({
      severity: f.severity, category: "dependency_vulnerability",
      title: f.title, detail: f.detail, evidence: f.evidence,
      reportedBy: [f.tool], convergenceCount: 1, confidence: "confirmed", toolVerified: true,
      fixAvailable: f.fixAvailable || false,
    }));
    codeAnalysis.synthesis.findings = [...(codeAnalysis.synthesis.findings || []), ...depFindings];
    codeAnalysis.synthesis.depAudit = {
      tools: depAuditResult.tools, ecosystems: depAuditResult.ecosystems,
      totalVulnerabilities: depAuditResult.totalVulnerabilities,
      bySeverity: depAuditResult.bySeverity, findingsAdded: depFindings.length,
    };
    writeFileSync(join(runDir, "agent1_code_analysis", "synthesis.json"), JSON.stringify(codeAnalysis.synthesis, null, 2));
    pipelineLog.info("Merged dependency audit findings into Agent 1 synthesis", { count: depFindings.length });
  }

  // Merge Semgrep SAST findings into Agent 1 synthesis (deduplicated)
  if (semgrepResult?.findings?.length && codeAnalysis.synthesis) {
    const existingEvidence = new Set((codeAnalysis.synthesis.findings || []).map(f => f.evidence || ""));
    const existingTitles = new Set((codeAnalysis.synthesis.findings || []).map(f => (f.title || "").toLowerCase()));
    const semgrepFindings = semgrepResult.findings
      .filter(f => {
        if (existingEvidence.has(f.evidence)) return false;
        const titleLower = (f.title || "").toLowerCase();
        for (const et of existingTitles) {
          if (et && titleLower && (et.includes(titleLower.slice(0, 30)) || titleLower.includes(et.slice(0, 30)))) return false;
        }
        return true;
      })
      .map(f => ({
        severity: f.severity, category: f.category || "security",
        title: f.title, detail: f.detail, evidence: f.evidence,
        reportedBy: ["semgrep"], convergenceCount: 1, confidence: "confirmed", toolVerified: true,
        semgrepRule: f.ruleId, cwe: f.cwe,
      }));
    if (semgrepFindings.length > 0) {
      codeAnalysis.synthesis.findings = [...(codeAnalysis.synthesis.findings || []), ...semgrepFindings];
      codeAnalysis.synthesis.semgrep = {
        tool: "semgrep", totalScanned: semgrepResult.totalFindings,
        deduplicated: semgrepResult.findings.length - semgrepFindings.length,
        findingsAdded: semgrepFindings.length, bySeverity: semgrepResult.bySeverity,
      };
      writeFileSync(join(runDir, "agent1_code_analysis", "synthesis.json"), JSON.stringify(codeAnalysis.synthesis, null, 2));
      pipelineLog.info("Merged Semgrep findings into Agent 1 synthesis", {
        added: semgrepFindings.length, deduplicated: semgrepResult.findings.length - semgrepFindings.length,
      });
    }
  }

  const codeSummary = summarizeFindings(codeAnalysis.synthesis);
  emit({ type: "agent_complete", agent: "code-analysis", index: 0, passes: Object.keys(codeAnalysis.passes).length, failures: codeAnalysis.failures.length, summary: codeSummary, partial: codeAnalysis.partial });

  const a11ySummary = summarizeFindings(accessibility.synthesis);
  emit({ type: "agent_complete", agent: "accessibility", index: 1, passes: Object.keys(accessibility.passes).length, failures: accessibility.failures.length, summary: a11ySummary, partial: accessibility.partial });

  // Agent 3: QA (model passes + ESLint QA in parallel)
  checkCancel();
  emit({ type: "agent_start", agent: "qa-analysis", label: "QA / Bug Detection", index: 2, passesTotal: passes.length });
  const qaDir = join(runDir, "agent3_qa");
  const [qaAnalysis, eslintQAResult] = await Promise.all([
    runAgentDirect(AGENTS[2], codebasePath, codeBundle, passes, qaDir, emit, { ...agentOpts, runDir }),
    runToolWithEvents("eslint-qa", "qa", () => runEslintQA(codebasePath, join(runDir, "agent3_qa"))),
  ]);

  // Emit eslint-qa tool summary
  emit({ type: "tools_summary", tools: {
    "eslint-qa": { status: eslintQAResult ? "complete" : "skipped", findings: eslintQAResult?.findings?.length || 0 },
  }});

  // Merge ESLint QA findings into Agent 3 synthesis
  if (eslintQAResult?.findings?.length && qaAnalysis.synthesis) {
    const existingQAEvidence = new Set((qaAnalysis.synthesis.findings || []).map(f => f.evidence || ""));
    const qaLintFindings = eslintQAResult.findings
      .filter(f => !existingQAEvidence.has(f.evidence))
      .map(f => ({
        severity: f.severity, category: f.category,
        title: f.title, detail: f.detail, evidence: f.evidence,
        reportedBy: ["eslint-qa"], convergenceCount: 1, confidence: "confirmed", toolVerified: true,
      }));
    if (qaLintFindings.length > 0) {
      qaAnalysis.synthesis.findings = [...(qaAnalysis.synthesis.findings || []), ...qaLintFindings];
      qaAnalysis.synthesis.eslintQA = {
        tool: "eslint-qa", typescript: eslintQAResult.typescript,
        filesScanned: eslintQAResult.totalFiles, findingsAdded: qaLintFindings.length,
        byCategory: eslintQAResult.byCategory,
      };
      writeFileSync(join(runDir, "agent3_qa", "synthesis.json"), JSON.stringify(qaAnalysis.synthesis, null, 2));
      pipelineLog.info("Merged ESLint QA findings into Agent 3 synthesis", { count: qaLintFindings.length });
    }
  }

  const qaSummary = summarizeFindings(qaAnalysis.synthesis);
  emit({ type: "agent_complete", agent: "qa-analysis", index: 2,
    passes: Object.keys(qaAnalysis.passes).length, failures: qaAnalysis.failures.length,
    summary: qaSummary, partial: qaAnalysis.partial });

  // Agent 4: Documentation (unchanged — always uses direct Claude CLI)
  checkCancel();
  emit({ type: "agent_start", agent: "documentation", label: "Documentation Generation", index: 3, passesTotal: 3 });
  const docsDir = join(runDir, "agent4_documentation");
  const documentation = await runDocGenerationParallel(codebasePath, runDir, docsDir, { ...agentOpts, codeBundle });
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
    toolName, track, codebasePath, timestamp,
    outputDir: runDir,
    pipelineMode: "direct-api",
    agents: {
      codeAnalysis: {
        passes: Object.keys(codeAnalysis.passes).length, failures: codeAnalysis.failures,
        synthesis: codeAnalysis.synthesis, partial: codeAnalysis.partial,
      },
      accessibility: {
        passes: Object.keys(accessibility.passes).length, failures: accessibility.failures,
        synthesis: accessibility.synthesis, partial: accessibility.partial,
      },
      qaAnalysis: {
        passes: Object.keys(qaAnalysis.passes).length, failures: qaAnalysis.failures,
        synthesis: qaAnalysis.synthesis, partial: qaAnalysis.partial,
      },
      documentation: {
        documentation: documentation.documentation, hecvat: documentation.hecvat,
      },
    },
  };

  emit({ type: "pipeline_complete", result });
  return result;
}
