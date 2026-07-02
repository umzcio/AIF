import { Router } from "express";
import multer from "multer";
import { join } from "path";
import pool from "../db/pool.js";
import { computeTrack } from "../scoring.js";
import { logAudit } from "../audit.js";
import { extractArchive } from "../utils/extract.js";
import { validateIntakeAnswers } from "../validation.js";

const CODEBASES_DIR = process.env.CODEBASES_DIR || "/data/codebases";
const upload = multer({ dest: "/tmp/aif-uploads", limits: { fileSize: 500 * 1024 * 1024 } });
const router = Router();

function computeFromAnswers(answers, artifactType) {
  if (!answers || typeof answers !== "object") return null;
  const r = computeTrack(answers, artifactType);
  return { scores: r.scores, escalations: r.escalations, floors: r.floors, pct: r.weightedPct, track: r.track };
}

function extractUpload(file, toolId) {
  const destDir = join(CODEBASES_DIR, toolId);
  return extractArchive(file, destDir);
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
    sandbox: body.sandbox === "true" || body.sandbox === true,
  };
}

// Save draft
router.post("/draft", upload.single("codebase"), async (req, res) => {
  const { name, description, submissionType, artifactType, intakeAnswers, codebaseUrl, sandbox } = parseBody(req.body);
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
       weighted_percentage, escalation_conditions, floor_conditions, track, codebase_url, sandbox)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft',
       $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17, $18, $19)
     RETURNING *`,
    [
      name, description, ownerId, submissionType, artifactType, intakeAnswers ? JSON.stringify(intakeAnswers) : null,
      computed?.scores.security ?? null, computed?.scores.accessibility ?? null,
      computed?.scores.dataSensitivity ?? null, computed?.scores.blastRadius ?? null,
      computed?.scores.autonomy ?? null, computed?.scores.comprehension ?? null, computed?.scores.maintenance ?? null,
      computed ? Math.round(computed.pct * 10000) / 100 : null,
      JSON.stringify(computed?.escalations || []),
      JSON.stringify(computed?.floors || []),
      computed?.track ?? null, codebaseUrl, sandbox,
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

  if (req.user) {
    logAudit({ actorId: req.user.userId, actorNetid: req.user.netid, action: "create_draft", entityType: "tool", entityId: tool.id, details: { name: tool.name } }).catch(() => {});
  }

  res.status(201).json({ tool, track: computed?.track ?? null });
});

// Update draft (owner only)
router.put("/draft/:id", upload.single("codebase"), async (req, res) => {
  const { rows: [existing] } = await pool.query("SELECT * FROM tools WHERE id = $1", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Tool not found" });
  if (existing.status !== "draft") return res.status(400).json({ error: "Only drafts can be edited" });
  if (req.user && existing.owner_id && existing.owner_id !== req.user.userId && req.user.role !== "admin") {
    return res.status(403).json({ error: "You can only edit your own drafts" });
  }

  const { name, description, submissionType, artifactType, intakeAnswers, codebaseUrl, sandbox } = parseBody(req.body);
  const computed = computeFromAnswers(intakeAnswers, artifactType);

  const { rows: [tool] } = await pool.query(
    `UPDATE tools SET
       name = COALESCE($1, name), description = $2, submission_type = COALESCE($3, submission_type),
       artifact_type = $4, intake_answers = $5,
       score_security = $6, score_accessibility = $7, score_data_sensitivity = $8, score_blast_radius = $9,
       score_autonomy = $10, score_comprehension = $11, score_maintenance = $12,
       weighted_percentage = $13, escalation_conditions = $14, floor_conditions = $15, track = $16,
       codebase_url = $17, sandbox = $18, updated_at = NOW()
     WHERE id = $19 RETURNING *`,
    [
      name || null, description, submissionType || null,
      artifactType, intakeAnswers ? JSON.stringify(intakeAnswers) : null,
      computed?.scores.security ?? null, computed?.scores.accessibility ?? null,
      computed?.scores.dataSensitivity ?? null, computed?.scores.blastRadius ?? null,
      computed?.scores.autonomy ?? null, computed?.scores.comprehension ?? null, computed?.scores.maintenance ?? null,
      computed ? Math.round(computed.pct * 10000) / 100 : null,
      JSON.stringify(computed?.escalations || []),
      JSON.stringify(computed?.floors || []),
      computed?.track ?? null, codebaseUrl || null, sandbox, req.params.id,
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
  const { name, description, submissionType, artifactType, intakeAnswers, codebaseUrl, sandbox } = parseBody(req.body);

  if (draftId) {
    const { rows: [existing] } = await pool.query("SELECT * FROM tools WHERE id = $1", [draftId]);
    if (!existing) return res.status(404).json({ error: "Draft not found" });
    if (existing.status !== "draft") return res.status(400).json({ error: "Tool already submitted" });

    const answers = intakeAnswers || (existing.intake_answers ? existing.intake_answers : null);
    const validation = validateIntakeAnswers(answers);
    if (!validation.ok) {
      return res.status(400).json({ error: "Intake answers incomplete", details: validation.errors });
    }
    const artType = artifactType || existing.artifact_type;
    const computed = computeFromAnswers(answers, artType);
    if (!computed) return res.status(400).json({ error: "Intake answers are required to submit" });
    const sandboxVal = sandbox || existing.sandbox || false;

    const { rows: [tool] } = await pool.query(
      `UPDATE tools SET
         name = COALESCE($1, name), description = $2, submission_type = COALESCE($3, submission_type),
         artifact_type = $4, intake_answers = $5,
         score_security = $6, score_accessibility = $7, score_data_sensitivity = $8, score_blast_radius = $9,
         score_autonomy = $10, score_comprehension = $11, score_maintenance = $12,
         weighted_percentage = $13, escalation_conditions = $14, floor_conditions = $15, track = $16,
         codebase_url = $17, sandbox = $18, status = 'pending', updated_at = NOW()
       WHERE id = $19 RETURNING *`,
      [
        name || null, description, submissionType || null,
        artType, answers ? JSON.stringify(answers) : null,
        computed.scores.security, computed.scores.accessibility,
        computed.scores.dataSensitivity, computed.scores.blastRadius,
        computed.scores.autonomy, computed.scores.comprehension, computed.scores.maintenance,
        Math.round(computed.pct * 10000) / 100,
        JSON.stringify(computed.escalations),
        JSON.stringify(computed.floors),
        computed.track, codebaseUrl || null, sandboxVal, draftId,
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

    if (req.user) {
      logAudit({ actorId: req.user.userId, actorNetid: req.user.netid, action: "submit_tool", entityType: "tool", entityId: tool.id, details: { name: tool.name, track: computed.track } }).catch(() => {});
    }

    return res.json({ tool, track: computed.track });
  }

  // Direct submit (no draft step)
  if (!name) return res.status(400).json({ error: "name is required" });
  const validation = validateIntakeAnswers(intakeAnswers);
  if (!validation.ok) {
    return res.status(400).json({ error: "Intake answers incomplete", details: validation.errors });
  }
  const computed = computeFromAnswers(intakeAnswers, artifactType);
  if (!computed) return res.status(400).json({ error: "Intake answers are required" });

  let ownerId = req.user?.userId || null;
  // Ensure user row exists (JWT may reference stale ID after DB recreate)
  if (ownerId) {
    const { rows } = await pool.query("SELECT id FROM users WHERE id = $1", [ownerId]);
    if (!rows.length) ownerId = null;
  }
  // codebasePath is NEVER accepted from user input — codebases only come via
  // file upload (extractArchive) or git clone (validated URL). Accepting arbitrary
  // paths would let authenticated users point the pipeline at any server directory.

  const { rows: [tool] } = await pool.query(
    `INSERT INTO tools (name, description, owner_id, submission_type, artifact_type, intake_answers, status,
       score_security, score_accessibility, score_data_sensitivity, score_blast_radius, score_autonomy, score_comprehension, score_maintenance,
       weighted_percentage, escalation_conditions, floor_conditions, track, codebase_url, sandbox)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending',
       $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17, $18, $19)
     RETURNING *`,
    [
      name, description, ownerId, submissionType, artifactType, intakeAnswers ? JSON.stringify(intakeAnswers) : null,
      computed.scores.security, computed.scores.accessibility,
      computed.scores.dataSensitivity, computed.scores.blastRadius,
      computed.scores.autonomy, computed.scores.comprehension, computed.scores.maintenance,
      Math.round(computed.pct * 10000) / 100,
      JSON.stringify(computed.escalations),
      JSON.stringify(computed.floors),
      computed.track, codebaseUrl, sandbox,
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

  if (req.user) {
    logAudit({ actorId: req.user.userId, actorNetid: req.user.netid, action: "submit_tool", entityType: "tool", entityId: tool.id, details: { name: tool.name, track: computed.track } }).catch(() => {});
  }

  res.status(201).json({ tool, track: computed.track });
});

// Delete draft (owner only)
router.delete("/draft/:id", async (req, res) => {
  const { rows: [existing] } = await pool.query("SELECT * FROM tools WHERE id = $1", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Tool not found" });
  if (existing.status !== "draft") return res.status(400).json({ error: "Only drafts can be deleted" });
  if (req.user && existing.owner_id && existing.owner_id !== req.user.userId && req.user.role !== "admin") {
    return res.status(403).json({ error: "You can only delete your own drafts" });
  }

  await pool.query("DELETE FROM tools WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
