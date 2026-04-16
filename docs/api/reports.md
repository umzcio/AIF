# Reports

Routes mounted under `/aif/api/reports`. These endpoints expose the outputs of a completed pipeline run: structured agent findings, generated documentation, and HECVAT self-assessment. Finding-status persistence (mark as resolved / wontfix) is also handled here.

## Access Control

- Builders may read outputs for their own tools only.
- Reviewers and admins may read outputs for any tool.
- The finding-status persistence endpoints use owner-or-role (`reviewer`, `admin`) on the **tool** rather than on the run.

## Output Layout

Each run writes to `<output_dir>/agent<N>_<slug>/`:

```
<run.output_dir>/
|-- agent1_code_analysis/synthesis.json
|-- agent2_accessibility/synthesis.json
|-- agent3_qa/synthesis.json
`-- agent4_documentation/
    |-- documentation.json
    |-- USER_GUIDE.md / .docx
    |-- ADMIN_GUIDE.md / .docx
    |-- COMPLIANCE_SUMMARY.md / .docx
    |-- hecvat_assessment.json
    `-- hecvat_assessment.xlsx
```

For backward compatibility, HECVAT artifacts are also read from the legacy `agent3_hecvat/` location if not present under Agent 4.

## Endpoints

### GET /reports/:runId

Returns the consolidated output for a completed run. The server assembles the response by reading each agent's `synthesis.json` directly from disk.

**Auth**: Authenticated; builders must own the tool.

**Path parameters**:

| Name | Type | Description |
|------|------|-------------|
| `runId` | uuid | Run ID (must be in `completed` status) |

**Response** `200 OK`:

```json
{
  "report": {
    "run": {
      "id": "a1b2...",
      "tool_id": "0c3f...",
      "status": "completed",
      "output_dir": "/data/pipeline-output/a1b2..."
    },
    "agents": {
      "codeAnalysis": {
        "summary": "...",
        "dimensionScores": {
          "security": { "score": 2, "notes": "..." },
          "accessibility": { "score": 1, "notes": "..." }
        },
        "findings": [
          {
            "severity": "high",
            "category": "secrets",
            "title": "Hard-coded API key in config",
            "detail": "...",
            "evidence": "src/config.js:12",
            "remediation": "...",
            "convergenceCount": 4,
            "reportedBy": ["gpt-5.4", "minimax-m2.5", "kimi-k2", "glm-5"]
          }
        ]
      },
      "accessibility": { "findings": [], "...": "..." },
      "qaAnalysis":   { "findings": [], "...": "..." },
      "hecvat":       { "questions": [], "nonNegotiableFailures": [] },
      "documentation": { "userGuide": "...", "adminGuide": "...", "complianceSummary": "..." }
    }
  }
}
```

Agent sections are present only if the corresponding synthesis file exists on disk.

**Errors**:

- `400 Bad Request` — `Run not completed yet` (includes current status)
- `401 Unauthorized` — `Authentication required`
- `403 Forbidden` — `Access denied` (builder viewing someone else's run)
- `404 Not Found` — `Run not found`

### GET /reports/:runId/findings.json

Downloads all findings flattened into a single JSON document. Suitable for export into ticketing systems or external audit tools.

**Auth**: Authenticated; builders must own the tool.

**Response** `200 OK`:

```
Content-Type: application/json
Content-Disposition: attachment; filename="<toolname>_findings.json"
```

Body:

```json
{
  "tool": "Student Dashboard",
  "track": 3,
  "runId": "a1b2...",
  "completedAt": "2026-04-12T18:00:00Z",
  "totalFindings": 17,
  "findings": [
    {
      "agent": "Code & Security",
      "severity": "high",
      "category": "secrets",
      "title": "Hard-coded API key in config",
      "detail": "...",
      "file": "src/config.js:12",
      "recommendation": "...",
      "convergence": 4,
      "confidence": "high",
      "reportedBy": "gpt-5.4, minimax-m2.5, kimi-k2, glm-5"
    }
  ]
}
```

**Errors**:

- `400 Bad Request` — `Run not completed yet`
- `404 Not Found` — `Run not found`

### GET /reports/:runId/findings.csv

Same data as `findings.json` formatted as CSV. Columns:

```
Agent, Severity, Category, Title, Detail, File/Evidence, Recommendation, Convergence, Confidence, Reported By
```

Fields are RFC 4180-escaped: values containing commas, newlines, carriage returns, or double quotes are wrapped in double quotes with embedded quotes doubled.

**Auth**: Authenticated; builders must own the tool.

**Response** `200 OK`:

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="<toolname>_findings.csv"
```

**Errors**: Same as `findings.json`.

### GET /reports/:runId/hecvat.xlsx

Downloads the HECVAT 4.15 self-assessment as an XLSX workbook. The server writes a filled template with all 87 critical questions; questions the pipeline could not answer are left as `needs_human_input` for the reviewer to complete.

**Auth**: Authenticated; builders must own the tool.

**Response** `200 OK`:

```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="hecvat_assessment.xlsx"
```

**Errors**:

- `404 Not Found` — `HECVAT XLSX not found` (file missing on disk)
- `404 Not Found` — `Run not found`

### GET /reports/:runId/docs/:name

Downloads a generated documentation artifact. Valid names are `USER_GUIDE`, `ADMIN_GUIDE`, and `COMPLIANCE_SUMMARY`. A `.md` or `.docx` suffix is accepted but the server always prefers `.docx` (converted via `pandoc`) when present, falling back to the Markdown source.

**Auth**: Authenticated; builders must own the tool.

**Path parameters**:

| Name | Type | Description |
|------|------|-------------|
| `runId` | uuid | Run ID |
| `name` | string | `USER_GUIDE`, `ADMIN_GUIDE`, or `COMPLIANCE_SUMMARY` (optionally with `.md`/`.docx`) |

**Response** `200 OK`: file download (`.docx` preferred, `.md` fallback).

**Errors**:

- `400 Bad Request` — `Invalid document name`
- `404 Not Found` — `Run output not found`
- `404 Not Found` — `Document not found` (neither `.docx` nor `.md` exists)

## Finding Status Persistence

Finding statuses are stored per-tool (not per-run). A finding is identified by a stable string ID computed client-side from the finding's content — typically a hash of agent + title + evidence — so that the same finding is tracked across retries of a pipeline.

Allowed statuses:

| Status | Meaning |
|--------|---------|
| `open` | Default; finding is unresolved |
| `resolved` | Builder/reviewer confirmed the finding is fixed |
| `wontfix` | Accepted risk; filed for audit |

### GET /reports/tools/:toolId/finding-statuses

Returns the current status map for a tool.

**Auth**: Owner, reviewer, or admin.

**Response** `200 OK`:

```json
{
  "statuses": {
    "c9f4...": "resolved",
    "3d20...": "wontfix"
  }
}
```

**Errors**:

- `401 Unauthorized` — `Authentication required`
- `403 Forbidden` — caller is not owner, reviewer, or admin
- `404 Not Found` — `Tool not found`

### PUT /reports/tools/:toolId/finding-statuses

Bulk upsert of finding statuses. The server performs a single `INSERT ... ON CONFLICT DO UPDATE` so that any finding IDs not included in the payload keep their prior status.

**Auth**: Owner, reviewer, or admin. **CSRF**: Required.

**Request body**:

| Field | Type | Constraints |
|-------|------|-------------|
| `statuses` | object | 1-500 keys; each value must be `open`, `resolved`, or `wontfix` |

```json
{
  "statuses": {
    "c9f4...": "resolved",
    "3d20...": "wontfix"
  }
}
```

**Response** `200 OK`:

```json
{ "saved": 2 }
```

**Errors**:

- `400 Bad Request` — validation failure (empty map, >500 entries, unknown status value)
- `403 Forbidden` — caller is not owner, reviewer, or admin
- `404 Not Found` — `Tool not found`

## Related

- [pipeline.md](pipeline.md) — how a run reaches `completed` status
- [review.md](review.md) — comments and approvals on a tool
- [analytics.md](analytics.md) — run-level cost and timing breakdowns
