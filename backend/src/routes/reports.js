import { Router } from "express";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import pool from "../db/pool.js";

const router = Router();

/**
 * Verify the requesting user can access reports for this run.
 * Builders can only access reports for their own tools; reviewers/admins can access all.
 */
async function requireRunAccess(req, res) {
  if (!req.user) { res.status(401).json({ error: "Authentication required" }); return null; }
  const { rows: [run] } = await pool.query("SELECT * FROM pipeline_runs WHERE id = $1", [req.params.runId]);
  if (!run) { res.status(404).json({ error: "Run not found" }); return null; }
  if (req.user.role === "builder") {
    const { rows: [tool] } = await pool.query("SELECT owner_id FROM tools WHERE id = $1", [run.tool_id]);
    if (!tool || tool.owner_id !== req.user.userId) { res.status(403).json({ error: "Access denied" }); return null; }
  }
  return run;
}

/**
 * Load all agent outputs for a completed run and normalize findings into a flat array.
 */
function loadFindings(outputDir) {
  const findings = [];

  // Agent 1: Code & Security
  const synthPath = join(outputDir, "agent1_code_analysis", "synthesis.json");
  if (existsSync(synthPath)) {
    const data = JSON.parse(readFileSync(synthPath, "utf-8"));
    for (const f of (data.findings || [])) {
      findings.push({
        agent: "Code & Security",
        severity: f.severity || "info",
        category: f.category || "",
        title: f.title || "",
        detail: f.detail || "",
        file: f.evidence || "",
        recommendation: f.remediation || "",
        convergence: f.convergenceCount ?? "",
        confidence: f.confidence || "",
        reportedBy: Array.isArray(f.reportedBy) ? f.reportedBy.join(", ") : "",
      });
    }
  }

  // Agent 2: Accessibility
  const a11yPath = join(outputDir, "agent2_accessibility", "synthesis.json");
  if (existsSync(a11yPath)) {
    const data = JSON.parse(readFileSync(a11yPath, "utf-8"));
    for (const f of (data.findings || [])) {
      findings.push({
        agent: "Accessibility",
        severity: f.severity || "info",
        category: f.category || f.wcagCriterion || "",
        title: f.title || "",
        detail: f.detail || "",
        file: f.evidence || "",
        recommendation: f.recommendation || "",
        convergence: f.convergenceCount ?? "",
        confidence: f.confidence || "",
        reportedBy: Array.isArray(f.reportedBy) ? f.reportedBy.join(", ") : "",
      });
    }
  }

  // Agent 3: QA / Bug Detection
  const qaPath = join(outputDir, "agent3_qa", "synthesis.json");
  if (existsSync(qaPath)) {
    const data = JSON.parse(readFileSync(qaPath, "utf-8"));
    for (const f of (data.findings || [])) {
      findings.push({
        agent: "QA / Bug Detection",
        severity: f.severity || "info",
        category: f.category || "",
        title: f.title || "",
        detail: f.detail || "",
        file: f.evidence || "",
        recommendation: f.remediation || f.suggestedFix || "",
        convergence: f.convergenceCount ?? "",
        confidence: f.confidence || "",
        reportedBy: Array.isArray(f.reportedBy) ? f.reportedBy.join(", ") : "",
      });
    }
  }

  // HECVAT findings (from Agent 4 output, with backward-compat fallback to old Agent 3)
  let hecvatPath = join(outputDir, "agent4_documentation", "hecvat_assessment.json");
  if (!existsSync(hecvatPath)) hecvatPath = join(outputDir, "agent3_hecvat", "hecvat_assessment.json");
  if (existsSync(hecvatPath)) {
    const data = JSON.parse(readFileSync(hecvatPath, "utf-8"));
    for (const f of (data.nonNegotiableFailures || [])) {
      findings.push({
        agent: "HECVAT",
        severity: "critical",
        category: f.category || "Non-negotiable",
        title: `${f.id || ""}: ${f.question || f.finding || "Non-negotiable failure"}`.trim(),
        detail: f.answer || f.detail || "",
        file: f.evidence || "",
        recommendation: f.remediation || "",
        convergence: "",
        confidence: "",
        reportedBy: "",
      });
    }
    for (const f of (data.highRiskFindings || [])) {
      findings.push({
        agent: "HECVAT",
        severity: f.severity || "high",
        category: f.area || f.category || "",
        title: `${f.id || f.area || ""}: ${f.finding || f.title || ""}`.trim(),
        detail: f.detail || "",
        file: f.evidence || "",
        recommendation: f.remediation || "",
        convergence: "",
        confidence: "",
        reportedBy: "",
      });
    }
    for (const q of (data.questions || [])) {
      if (q.status === "no" || q.status === "partial") {
        findings.push({
          agent: "HECVAT",
          severity: q.status === "no" ? "high" : "medium",
          category: q.category || "",
          title: `${q.id || ""}: ${q.status === "no" ? "Non-compliant" : "Partially compliant"}`,
          detail: q.answer || "",
          file: q.evidence || "",
          recommendation: "",
          convergence: "",
          confidence: "",
          reportedBy: "",
        });
      }
    }
  }

  return findings;
}

function escapeCsvField(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function findingsToCsv(findings) {
  const headers = ["Agent", "Severity", "Category", "Title", "Detail", "File/Evidence", "Recommendation", "Convergence", "Confidence", "Reported By"];
  const keys = ["agent", "severity", "category", "title", "detail", "file", "recommendation", "convergence", "confidence", "reportedBy"];
  const rows = [headers.map(escapeCsvField).join(",")];
  for (const f of findings) {
    rows.push(keys.map(k => escapeCsvField(f[k])).join(","));
  }
  return rows.join("\r\n");
}

router.get("/:runId", async (req, res) => {
  const run = await requireRunAccess(req, res);
  if (!run) return;
  if (run.status !== "completed") {
    return res.status(400).json({ error: "Run not completed yet", status: run.status });
  }

  const report = { run, agents: {} };
  const dir = run.output_dir;

  const synthPath = join(dir, "agent1_code_analysis", "synthesis.json");
  if (existsSync(synthPath)) report.agents.codeAnalysis = JSON.parse(readFileSync(synthPath, "utf-8"));

  const a11yPath = join(dir, "agent2_accessibility", "synthesis.json");
  if (existsSync(a11yPath)) report.agents.accessibility = JSON.parse(readFileSync(a11yPath, "utf-8"));

  // Agent 3: QA Analysis (new)
  const qaPath = join(dir, "agent3_qa", "synthesis.json");
  if (existsSync(qaPath)) report.agents.qaAnalysis = JSON.parse(readFileSync(qaPath, "utf-8"));

  // HECVAT: now from Agent 4, with backward-compat fallback to old Agent 3
  let hecvatPath = join(dir, "agent4_documentation", "hecvat_assessment.json");
  if (!existsSync(hecvatPath)) hecvatPath = join(dir, "agent3_hecvat", "hecvat_assessment.json");
  if (existsSync(hecvatPath)) report.agents.hecvat = JSON.parse(readFileSync(hecvatPath, "utf-8"));

  const docsPath = join(dir, "agent4_documentation", "documentation.json");
  if (existsSync(docsPath)) report.agents.documentation = JSON.parse(readFileSync(docsPath, "utf-8"));

  res.json({ report });
});

// Export all findings as JSON
router.get("/:runId/findings.json", async (req, res) => {
  const run = await requireRunAccess(req, res);
  if (!run) return;
  if (run.status !== "completed") return res.status(400).json({ error: "Run not completed yet" });

  const { rows: [tool] } = await pool.query("SELECT name, track FROM tools WHERE id = $1", [run.tool_id]);
  const findings = loadFindings(run.output_dir);

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${(tool?.name || "findings").replace(/[^a-zA-Z0-9_-]/g, "_")}_findings.json"`);
  res.json({
    tool: tool?.name || null,
    track: tool?.track || null,
    runId: run.id,
    completedAt: run.completed_at,
    totalFindings: findings.length,
    findings,
  });
});

// Export all findings as CSV
router.get("/:runId/findings.csv", async (req, res) => {
  const run = await requireRunAccess(req, res);
  if (!run) return;
  if (run.status !== "completed") return res.status(400).json({ error: "Run not completed yet" });

  const { rows: [tool] } = await pool.query("SELECT name FROM tools WHERE id = $1", [run.tool_id]);
  const findings = loadFindings(run.output_dir);
  const csv = findingsToCsv(findings);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${(tool?.name || "findings").replace(/[^a-zA-Z0-9_-]/g, "_")}_findings.csv"`);
  res.send(csv);
});

router.get("/:runId/hecvat.xlsx", async (req, res) => {
  const run = await requireRunAccess(req, res);
  if (!run) return;

  // Try new location (Agent 4) first, fall back to old location (Agent 3)
  let xlsxPath = join(run.output_dir, "agent4_documentation", "hecvat_assessment.xlsx");
  if (!existsSync(xlsxPath)) xlsxPath = join(run.output_dir, "agent3_hecvat", "hecvat_assessment.xlsx");
  if (!existsSync(xlsxPath)) return res.status(404).json({ error: "HECVAT XLSX not found" });

  res.download(xlsxPath, "hecvat_assessment.xlsx");
});

router.get("/:runId/docs/:name", async (req, res) => {
  const run = await requireRunAccess(req, res);
  if (!run) return;
  if (!run.output_dir) return res.status(404).json({ error: "Run output not found" });

  const validDocs = ["USER_GUIDE", "ADMIN_GUIDE", "COMPLIANCE_SUMMARY"];
  const docBase = req.params.name.replace(/\.(md|docx)$/, "");
  if (!validDocs.includes(docBase)) return res.status(400).json({ error: "Invalid document name" });

  // Prefer .docx if available, fall back to .md
  const docxPath = join(run.output_dir, "agent4_documentation", `${docBase}.docx`);
  const mdPath = join(run.output_dir, "agent4_documentation", `${docBase}.md`);

  if (existsSync(docxPath)) {
    res.download(docxPath, `${docBase}.docx`);
  } else if (existsSync(mdPath)) {
    res.download(mdPath, `${docBase}.md`);
  } else {
    res.status(404).json({ error: "Document not found" });
  }
});

export default router;
