import { Router } from "express";
import multer from "multer";
import { execSync } from "child_process";
import { mkdirSync } from "fs";
import { join } from "path";
import pool from "../db/pool.js";
import { computeDimensionScores, checkEscalations, computeWeightedPercentage, routeToTrack } from "../scoring.js";

const CODEBASES_DIR = process.env.CODEBASES_DIR || "/data/codebases";
const upload = multer({ dest: "/tmp/aif-uploads", limits: { fileSize: 500 * 1024 * 1024 } });
const router = Router();

function computeFromAnswers(answers, artifactType) {
  if (!answers || typeof answers !== "object") return null;
  const scores = computeDimensionScores(answers);
  const escalations = checkEscalations(answers);
  const key = artifactType || answers.q1 || "other";
  const pct = computeWeightedPercentage(scores, key);
  const track = routeToTrack(pct, escalations.length > 0);
  return { scores, escalations, pct, track };
}

async function extractUpload(file, toolId) {
  const destDir = join(CODEBASES_DIR, toolId);
  mkdirSync(destDir, { recursive: true });
  const filePath = file.path;
  const originalName = file.originalname || "";

  try {
    if (originalName.endsWith(".zip")) {
      execSync(`unzip -o -q "${filePath}" -d "${destDir}"`, { timeout: 60000 });
    } else if (originalName.endsWith(".tar.gz") || originalName.endsWith(".tgz")) {
      execSync(`tar xzf "${filePath}" -C "${destDir}"`, { timeout: 60000 });
    } else if (originalName.endsWith(".tar")) {
      execSync(`tar xf "${filePath}" -C "${destDir}"`, { timeout: 60000 });
    } else {
      try {
        execSync(`unzip -o -q "${filePath}" -d "${destDir}"`, { timeout: 60000 });
      } catch {
        execSync(`tar xf "${filePath}" -C "${destDir}"`, { timeout: 60000 });
      }
    }

    const entries = execSync(`ls "${destDir}"`, { encoding: "utf-8" }).trim().split("\n");
    return entries.length === 1 ? join(destDir, entries[0]) : destDir;
  } finally {
    try { execSync(`rm -f "${filePath}"`); } catch {}
  }
}

function parseBody(body) {
  let intakeAnswers = body.intakeAnswers;
  if (typeof intakeAnswers === "string") {
    try { intakeAnswers = JSON.parse(intakeAnswers); } catch { intakeAnswers = null; }
  }
  return {
    name: body.name,
    description: body.description || null,
    submissionType: body.submissionType || "new",
    artifactType: body.artifactType || null,
    intakeAnswers,
    codebaseUrl: body.codebaseUrl || null,
  };
}

// Save draft
router.post("/draft", upload.single("codebase"), async (req, res) => {
  const { name, description, submissionType, artifactType, intakeAnswers, codebaseUrl } = parseBody(req.body);
  if (!name) return res.status(400).json({ error: "name is required" });

  const computed = computeFromAnswers(intakeAnswers, artifactType);
  let ownerId = req.user?.userId || null;
  if (ownerId) {
    const { rows } = await pool.query("SELECT id FROM users WHERE id = $1", [ownerId]);
    if (!rows.length) ownerId = null;
  }

  const { rows: [tool] } = await pool.query(
    `INSERT INTO tools (name, description, owner_id, submission_type, artifact_type, intake_answers, status,
       score_security, score_accessibility, score_data_sensitivity, score_blast_radius, score_autonomy, score_comprehension, score_maintenance,
       weighted_percentage, escalation_conditions, track, codebase_url)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft',
       $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17)
     RETURNING *`,
    [
      name, description, ownerId, submissionType, artifactType, intakeAnswers ? JSON.stringify(intakeAnswers) : null,
      computed?.scores.security ?? null, computed?.scores.accessibility ?? null,
      computed?.scores.dataSensitivity ?? null, computed?.scores.blastRadius ?? null,
      computed?.scores.autonomy ?? null, computed?.scores.comprehension ?? null, computed?.scores.maintenance ?? null,
      computed ? Math.round(computed.pct * 10000) / 100 : null,
      JSON.stringify(computed?.escalations || []),
      computed?.track ?? null, codebaseUrl,
    ]
  );

  if (req.file) {
    try {
      const codebasePath = await extractUpload(req.file, tool.id);
      await pool.query("UPDATE tools SET codebase_path = $1 WHERE id = $2", [codebasePath, tool.id]);
      tool.codebase_path = codebasePath;
    } catch (err) {
      return res.status(400).json({ error: `Failed to extract codebase: ${err.message}` });
    }
  }

  res.status(201).json({ tool, track: computed?.track ?? null });
});

// Update draft
router.put("/draft/:id", upload.single("codebase"), async (req, res) => {
  const { rows: [existing] } = await pool.query("SELECT * FROM tools WHERE id = $1", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Tool not found" });
  if (existing.status !== "draft") return res.status(400).json({ error: "Only drafts can be edited" });

  const { name, description, submissionType, artifactType, intakeAnswers, codebaseUrl } = parseBody(req.body);
  const computed = computeFromAnswers(intakeAnswers, artifactType);

  const { rows: [tool] } = await pool.query(
    `UPDATE tools SET
       name = COALESCE($1, name), description = $2, submission_type = COALESCE($3, submission_type),
       artifact_type = $4, intake_answers = $5,
       score_security = $6, score_accessibility = $7, score_data_sensitivity = $8, score_blast_radius = $9,
       score_autonomy = $10, score_comprehension = $11, score_maintenance = $12,
       weighted_percentage = $13, escalation_conditions = $14, track = $15,
       codebase_url = $16, updated_at = NOW()
     WHERE id = $17 RETURNING *`,
    [
      name || null, description, submissionType || null,
      artifactType, intakeAnswers ? JSON.stringify(intakeAnswers) : null,
      computed?.scores.security ?? null, computed?.scores.accessibility ?? null,
      computed?.scores.dataSensitivity ?? null, computed?.scores.blastRadius ?? null,
      computed?.scores.autonomy ?? null, computed?.scores.comprehension ?? null, computed?.scores.maintenance ?? null,
      computed ? Math.round(computed.pct * 10000) / 100 : null,
      JSON.stringify(computed?.escalations || []),
      computed?.track ?? null, codebaseUrl || null, req.params.id,
    ]
  );

  if (req.file) {
    try {
      const codebasePath = await extractUpload(req.file, tool.id);
      await pool.query("UPDATE tools SET codebase_path = $1 WHERE id = $2", [codebasePath, tool.id]);
      tool.codebase_path = codebasePath;
    } catch (err) {
      return res.status(400).json({ error: `Failed to extract codebase: ${err.message}` });
    }
  }

  res.json({ tool, track: computed?.track ?? null });
});

// Submit (finalize)
router.post("/", upload.single("codebase"), async (req, res) => {
  const { draftId } = req.body;
  const { name, description, submissionType, artifactType, intakeAnswers, codebaseUrl } = parseBody(req.body);

  if (draftId) {
    const { rows: [existing] } = await pool.query("SELECT * FROM tools WHERE id = $1", [draftId]);
    if (!existing) return res.status(404).json({ error: "Draft not found" });
    if (existing.status !== "draft") return res.status(400).json({ error: "Tool already submitted" });

    const answers = intakeAnswers || (existing.intake_answers ? existing.intake_answers : null);
    const artType = artifactType || existing.artifact_type;
    const computed = computeFromAnswers(answers, artType);
    if (!computed) return res.status(400).json({ error: "Intake answers are required to submit" });

    const { rows: [tool] } = await pool.query(
      `UPDATE tools SET
         name = COALESCE($1, name), description = $2, submission_type = COALESCE($3, submission_type),
         artifact_type = $4, intake_answers = $5,
         score_security = $6, score_accessibility = $7, score_data_sensitivity = $8, score_blast_radius = $9,
         score_autonomy = $10, score_comprehension = $11, score_maintenance = $12,
         weighted_percentage = $13, escalation_conditions = $14, track = $15,
         codebase_url = $16, status = 'pending', updated_at = NOW()
       WHERE id = $17 RETURNING *`,
      [
        name || null, description, submissionType || null,
        artType, answers ? JSON.stringify(answers) : null,
        computed.scores.security, computed.scores.accessibility,
        computed.scores.dataSensitivity, computed.scores.blastRadius,
        computed.scores.autonomy, computed.scores.comprehension, computed.scores.maintenance,
        Math.round(computed.pct * 10000) / 100,
        JSON.stringify(computed.escalations),
        computed.track, codebaseUrl || null, draftId,
      ]
    );

    if (req.file) {
      try {
        const codebasePath = await extractUpload(req.file, tool.id);
        await pool.query("UPDATE tools SET codebase_path = $1 WHERE id = $2", [codebasePath, tool.id]);
        tool.codebase_path = codebasePath;
      } catch (err) {
        return res.status(400).json({ error: `Failed to extract codebase: ${err.message}` });
      }
    }

    return res.json({ tool, track: computed.track });
  }

  // Direct submit (no draft step)
  if (!name) return res.status(400).json({ error: "name is required" });
  const computed = computeFromAnswers(intakeAnswers, artifactType);
  if (!computed) return res.status(400).json({ error: "Intake answers are required" });

  let ownerId = req.user?.userId || null;
  // Ensure user row exists (JWT may reference stale ID after DB recreate)
  if (ownerId) {
    const { rows } = await pool.query("SELECT id FROM users WHERE id = $1", [ownerId]);
    if (!rows.length) ownerId = null;
  }
  const codebasePath = req.body.codebasePath || null;

  const { rows: [tool] } = await pool.query(
    `INSERT INTO tools (name, description, owner_id, submission_type, artifact_type, intake_answers, status,
       score_security, score_accessibility, score_data_sensitivity, score_blast_radius, score_autonomy, score_comprehension, score_maintenance,
       weighted_percentage, escalation_conditions, track, codebase_url, codebase_path)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending',
       $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17, $18)
     RETURNING *`,
    [
      name, description, ownerId, submissionType, artifactType, intakeAnswers ? JSON.stringify(intakeAnswers) : null,
      computed.scores.security, computed.scores.accessibility,
      computed.scores.dataSensitivity, computed.scores.blastRadius,
      computed.scores.autonomy, computed.scores.comprehension, computed.scores.maintenance,
      Math.round(computed.pct * 10000) / 100,
      JSON.stringify(computed.escalations),
      computed.track, codebaseUrl, codebasePath,
    ]
  );

  if (req.file) {
    try {
      const codePath = await extractUpload(req.file, tool.id);
      await pool.query("UPDATE tools SET codebase_path = $1 WHERE id = $2", [codePath, tool.id]);
      tool.codebase_path = codePath;
    } catch (err) {
      return res.status(400).json({ error: `Failed to extract codebase: ${err.message}` });
    }
  }

  res.status(201).json({ tool, track: computed.track });
});

// Delete draft
router.delete("/draft/:id", async (req, res) => {
  const { rows: [existing] } = await pool.query("SELECT * FROM tools WHERE id = $1", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Tool not found" });
  if (existing.status !== "draft") return res.status(400).json({ error: "Only drafts can be deleted" });

  await pool.query("DELETE FROM tools WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
