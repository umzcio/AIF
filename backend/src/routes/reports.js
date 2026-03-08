import { Router } from "express";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import pool from "../db/pool.js";

const router = Router();

router.get("/:runId", async (req, res) => {
  const { rows: [run] } = await pool.query(
    "SELECT * FROM pipeline_runs WHERE id = $1", [req.params.runId]
  );
  if (!run) return res.status(404).json({ error: "Run not found" });
  if (run.status !== "completed") {
    return res.status(400).json({ error: "Run not completed yet", status: run.status });
  }

  const report = { run, agents: {} };
  const dir = run.output_dir;

  const synthPath = join(dir, "agent1_code_analysis", "synthesis.json");
  if (existsSync(synthPath)) report.agents.codeAnalysis = JSON.parse(readFileSync(synthPath, "utf-8"));

  const a11yPath = join(dir, "agent2_accessibility", "synthesis.json");
  if (existsSync(a11yPath)) report.agents.accessibility = JSON.parse(readFileSync(a11yPath, "utf-8"));

  const hecvatPath = join(dir, "agent3_hecvat", "hecvat_assessment.json");
  if (existsSync(hecvatPath)) report.agents.hecvat = JSON.parse(readFileSync(hecvatPath, "utf-8"));

  const docsPath = join(dir, "agent4_documentation", "documentation.json");
  if (existsSync(docsPath)) report.agents.documentation = JSON.parse(readFileSync(docsPath, "utf-8"));

  res.json({ report });
});

router.get("/:runId/hecvat.xlsx", async (req, res) => {
  const { rows: [run] } = await pool.query(
    "SELECT * FROM pipeline_runs WHERE id = $1", [req.params.runId]
  );
  if (!run?.output_dir) return res.status(404).json({ error: "Run not found" });

  const xlsxPath = join(run.output_dir, "agent3_hecvat", "hecvat_assessment.xlsx");
  if (!existsSync(xlsxPath)) return res.status(404).json({ error: "HECVAT XLSX not found" });

  res.download(xlsxPath, "hecvat_assessment.xlsx");
});

router.get("/:runId/docs/:name", async (req, res) => {
  const { rows: [run] } = await pool.query(
    "SELECT * FROM pipeline_runs WHERE id = $1", [req.params.runId]
  );
  if (!run?.output_dir) return res.status(404).json({ error: "Run not found" });

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
