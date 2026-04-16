/**
 * AIF Backend — CLI entry point
 *
 * Usage:
 *   node src/index.js <codebase-path> [track]
 *
 * Example:
 *   node src/index.js /projects/CourseEval TRACK_2
 *   node src/index.js /projects/otto-bot TRACK_3
 *   node src/index.js /projects/otto-bot DEPLOY    (legacy, maps to TRACK_3)
 */

import { runDirectApiPipeline as runPipeline } from "./orchestrator/direct-api.js";
import { resolve, basename } from "path";

const LEGACY_MAP = { EXPLORE: 1, PILOT: 2, DEPLOY: 3, ESCALATE: 4 };

const codebasePath = process.argv[2];
const rawTrack = (process.argv[3] || "TRACK_3").toUpperCase();

function parseTrack(input) {
  const m = input.match(/^TRACK_(\d)$/);
  if (m) return parseInt(m[1]);
  if (LEGACY_MAP[input] !== undefined) return LEGACY_MAP[input];
  return 3; // default
}

if (!codebasePath) {
  console.log("Usage: node src/index.js <codebase-path> [track]");
  console.log("  track: TRACK_1 | TRACK_2 | TRACK_3 | TRACK_4 (default: TRACK_3)");
  console.log("  legacy: EXPLORE | PILOT | DEPLOY | ESCALATE also accepted");
  console.log("\nExample:");
  console.log("  node src/index.js /projects/CourseEval TRACK_2");
  process.exit(1);
}

const track = parseTrack(rawTrack);
const toolName = basename(resolve(codebasePath));
const outputBase = resolve(import.meta.dirname, "../../output");

try {
  const result = await runPipeline({ codebasePath, track, toolName, outputBase });

  console.log(`\n${"=".repeat(60)}`);
  console.log("PIPELINE COMPLETE");
  console.log(`${"=".repeat(60)}`);
  console.log(`Tool: ${result.toolName}`);
  console.log(`Track: ${result.track}`);
  console.log(`Output: ${result.outputDir}`);

  // Agent 1: Code & Security
  const a1 = result.agents.codeAnalysis;
  console.log(`\nAgent 1 — Code & Security: ${a1.passes} passes, ${a1.failures.length} failures`);
  if (a1.synthesis?.convergenceStats) {
    const c = a1.synthesis.convergenceStats;
    console.log(`  Convergence: ${c.confirmed} confirmed, ${c.potential} potential, ${c.resolved} resolved, ${c.needs_human_review} need human review`);
  }
  if (a1.synthesis?.escalationSignals) {
    const triggered = Object.entries(a1.synthesis.escalationSignals)
      .filter(([, v]) => v.triggered)
      .map(([k, v]) => `${k} (${v.confirmedBy}/${a1.passes})`);
    if (triggered.length) console.log(`  Escalation signals: ${triggered.join(", ")}`);
  }

  // Agent 2: Accessibility
  const a2 = result.agents.accessibility;
  console.log(`\nAgent 2 — Accessibility: ${a2.passes} passes, ${a2.failures.length} failures`);
  if (a2.synthesis?.scorecard) {
    const sc = a2.synthesis.scorecard;
    console.log(`  WCAG 2.2 AA: ${sc.overallCompliance} (${sc.estimatedConformanceLevel})`);
    const total = (p) => `${p.pass}p/${p.fail}f/${p.warning}w`;
    console.log(`  Perceivable: ${total(sc.perceivable)} | Operable: ${total(sc.operable)} | Understandable: ${total(sc.understandable)} | Robust: ${total(sc.robust)}`);
  }

  // Agent 3: HECVAT
  const a3 = result.agents.hecvat;
  if (a3?.assessment?.scoring) {
    const s = a3.assessment.scoring;
    console.log(`\nAgent 3 — HECVAT 4 Lite: ${s.totalQuestions} questions, ${s.answeredFromCode} from code, ${s.requiresHumanInput} need human`);
    console.log(`  Readiness: ${s.readiness.percentage}% (${s.readiness.yes} yes, ${s.readiness.no} no, ${s.readiness.partial} partial, ${s.readiness.not_applicable} n/a)`);
    if (a3.assessment.nonNegotiableFailures?.length) {
      console.log(`  Non-negotiable failures: ${a3.assessment.nonNegotiableFailures.map(f => f.id).join(", ")}`);
    }
  }

  // Agent 4: Documentation
  const a4 = result.agents.documentation;
  if (a4?.documentation?.metadata) {
    const m = a4.documentation.metadata;
    console.log(`\nAgent 4 — Documentation: ${m.filesRead?.length} files read, ${m.todoCount} TODOs`);
    console.log(`  User Guide: ${m.wordCount?.userGuide} words | Admin Guide: ${m.wordCount?.adminGuide} words | Compliance: ${m.wordCount?.complianceSummary} words`);
  }

  console.log(`\n${"=".repeat(60)}`);
} catch (err) {
  console.error("\nPipeline failed:", err.message);
  process.exit(1);
}
