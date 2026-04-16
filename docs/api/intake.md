# Intake

Routes mounted under `/aif/api/intake`. These endpoints accept the 21-question intake form, score it on seven weighted dimensions, route to a track (1–4), and persist the result as a tool row. All scoring is authoritative on the server side; the frontend computes the same values only as a preview.

All intake endpoints accept `multipart/form-data` so that a codebase archive can be attached in the same request. State-changing requests require authentication and a valid CSRF token (see [overview.md](overview.md)). For multipart requests, the CSRF token may be passed as a `_csrf` form field instead of the `x-csrf-token` header.

## Scoring

On submit or draft save, the server:

1. Parses `intakeAnswers` (JSON-encoded 21-question map) and `artifactType`.
2. Runs `computeDimensionScores()` to derive the seven dimension scores (security, accessibility, dataSensitivity, blastRadius, autonomy, comprehension, maintenance).
3. Runs `checkEscalations()` to detect any of the seven Track 4 escalation conditions.
4. Runs `computeWeightedPercentage()` using the artifact-type weight profile.
5. Runs `routeToTrack()` to map percentage + escalation flag to Track 1–4.

The resulting `tools` row stores all seven dimension scores, the weighted percentage (rounded to two decimals), the list of triggered escalations, and the computed track.

## Shared Request Fields

All endpoints accept the following fields (multipart form):

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | On create | Tool display name |
| `description` | string | No | Free-text description |
| `submissionType` | string | No | `new` \| `existing` (default `new`) |
| `artifactType` | string | No | One of `public-site`, `internal-app`, `script-api`, `ai-agent`, `data-pipeline`, `other` |
| `intakeAnswers` | string (JSON) | On submit | JSON object keyed `q1`…`q21` |
| `codebaseUrl` | string | No | HTTPS git URL (validated on pipeline run) |
| `sandbox` | string (`"true"` or `"false"`) | No | Opt-in private sandbox mode |
| `codebase` | file | No | `.zip`, `.tar.gz`, or `.tar.bz2` up to 500 MB |
| `_csrf` | string | On state change | CSRF token (alternative to header) |

`intakeAnswers` is sent as a JSON string even inside multipart form data because `FormData` cannot carry nested objects directly.

## Endpoints

### POST /intake/draft

Saves an intake as a draft. Drafts skip scoring validation — partial answers are accepted. The draft is owned by the authenticated caller.

**Auth**: Authenticated (any role). **CSRF**: Required.

**Request**: Multipart form with the shared fields. A `codebase` file may be attached and, if present, will be extracted into `CODEBASES_DIR/<toolId>/`.

**Response** `201 Created`:

```json
{
  "tool": {
    "id": "0c3f...",
    "name": "Student Dashboard",
    "status": "draft",
    "track": 3,
    "weighted_percentage": 48.32,
    "score_security": 2,
    "...": "..."
  },
  "track": 3
}
```

**Errors**:

- `400 Bad Request` — `name is required`
- `400 Bad Request` — `Failed to extract codebase: <reason>`
- `401 Unauthorized` — no session
- `403 Forbidden` — CSRF mismatch

### PUT /intake/draft/:id

Updates a draft in place. Only the draft's owner — or an admin — may update it, and only while `status = 'draft'`. Any fields that are omitted keep their current value; `description`, `artifactType`, and `intakeAnswers` are set to their supplied value (or `null`).

**Auth**: Owner or admin. **CSRF**: Required.

**Path parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | uuid | Draft tool ID |

**Request**: Multipart form, same fields as `POST /intake/draft`.

**Response** `200 OK`:

```json
{ "tool": { "...": "..." }, "track": 3 }
```

**Errors**:

- `400 Bad Request` — `Only drafts can be edited`
- `403 Forbidden` — `You can only edit your own drafts`
- `404 Not Found` — `Tool not found`

### DELETE /intake/draft/:id

Deletes a draft. Only the owner or an admin may delete it, and only while `status = 'draft'`.

**Auth**: Owner or admin. **CSRF**: Required.

**Response** `200 OK`:

```json
{ "ok": true }
```

**Errors**:

- `400 Bad Request` — `Only drafts can be deleted`
- `403 Forbidden` — `You can only delete your own drafts`
- `404 Not Found` — `Tool not found`

### POST /intake

Finalizes an intake. This is the submission endpoint. It has two modes:

1. **Promote a draft** — include `draftId` in the body. The server loads the existing draft, merges any supplied fields, recomputes scores, and transitions the tool from `draft` to `pending`.
2. **Direct submit** — omit `draftId`. The server creates a new tool row in `pending` status.

In both modes, `intakeAnswers` is required for scoring. The response includes the final track assignment so the frontend can display the routing decision immediately.

**Auth**: Authenticated (any role). **CSRF**: Required.

**Request**: Multipart form with shared fields plus (optional):

| Field | Type | Notes |
|-------|------|-------|
| `draftId` | uuid | When present, promote this draft instead of creating a new tool |

**Response** `200 OK` (draft promotion) or `201 Created` (direct submit):

```json
{
  "tool": {
    "id": "0c3f...",
    "name": "Student Dashboard",
    "status": "pending",
    "track": 3,
    "weighted_percentage": 48.32,
    "escalation_conditions": [],
    "owner_id": 42,
    "sandbox": false,
    "...": "..."
  },
  "track": 3
}
```

**Errors**:

- `400 Bad Request` — `name is required`
- `400 Bad Request` — `Intake answers are required` / `Intake answers are required to submit`
- `400 Bad Request` — `Tool already submitted` (draftId points to a non-draft tool)
- `400 Bad Request` — `Failed to extract codebase: <reason>`
- `404 Not Found` — `Draft not found`

## Security Notes

- `codebasePath` is **never** read from user input. Codebases are only accepted as uploaded archives (extracted by the server into a sandboxed directory) or as HTTPS git URLs validated by the pipeline runner.
- Uploaded archives are validated to prevent path traversal: any extracted file whose resolved path escapes the target directory causes the operation to fail.
- File size limit: 500 MB per archive.

## Related

- [registry.md](registry.md) — viewing and editing tools after submission
- [pipeline.md](pipeline.md) — starting the agent pipeline on a submitted tool
- [../framework/scoring-model.md](../framework/scoring-model.md) — the authoritative scoring model
