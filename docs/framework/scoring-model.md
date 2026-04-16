# Scoring Model

The AIF scoring model converts 21 intake answers into seven 0–3 dimension scores, applies an artifact-type weight profile, and produces a single weighted percentage that feeds track routing. This document specifies the authoritative computation as implemented in `backend/src/scoring.js`.

## Summary

- Seven dimensions: Security, Accessibility, Data Sensitivity, Blast Radius, Autonomy, Comprehension, Maintenance
- Each dimension scored 0–3 based on deterministic rules over intake answers
- Six artifact types, each with a distinct integer weight profile across the seven dimensions
- Weighted percentage computed as `Σ(score × weight) / (3 × Σ weights) × 100`
- The frontend (`frontend/src/constants.js`) provides a preview-only copy of this logic; the backend recomputes authoritatively on submission

## Authoritative Source

The canonical implementation lives in `backend/src/scoring.js`. The frontend duplicate in `frontend/src/constants.js` is explicitly marked "Preview-only" and any divergence must be reconciled in favor of the backend. The unit test suite `backend/src/scoring.test.js` asserts frontend/backend weight matrix parity.

## The Seven Dimensions

Each dimension is an integer in the range `[0, 3]`. Scoring rules below use intake answer keys (`q1` through `q21`) as documented in the intake form.

### Dimension Table

| Dimension | Label | Short Code | Drivers |
|-----------|-------|------------|---------|
| security | Security | SEC | q5 (access surface), q6 (auth) |
| accessibility | Accessibility | A11Y | q5 (access surface), q1 (artifact type) |
| dataSensitivity | Data Sensitivity | DATA | q9 (handles data), q10 (data types) |
| blastRadius | Blast Radius | BLAST | q3 (user groups), q8 (user volume) |
| autonomy | Autonomy | AUTO | q21 (user awareness), q20 (decision scope) |
| comprehension | Comprehension | COMP | q19 (plain-language explanation) |
| maintenance | Maintenance | MAINT | q15, q16, q17, q18 |

### Security (0–3)

Derived from deployment surface (q5) with an authentication penalty (q6).

| Condition (q5) | Base Score |
|----------------|-----------:|
| `public-noauth` — public internet, no authentication | 3 |
| `public-auth` — public internet, requires authentication | 2 |
| `undetermined` — deployment not yet determined | 2 |
| `campus-vpn` — campus network or VPN only | 1 |
| `internal-server` or unset | 0 |

Penalty (additive, clamped to 3):

| Condition (q6) | Modifier |
|----------------|---------:|
| `no-auth` — no authentication required | +1 |
| `custom-auth` — custom or third-party authentication | +1 |

Final score: `min(base + penalty, 3)`.

### Accessibility (0–3)

Driven by user-visibility surface.

| Condition | Score |
|-----------|------:|
| q5 is `public-noauth` or `public-auth` | 3 |
| q1 is `internal-app` (and not public) | 2 |
| otherwise | 0 |

Rationale: accessibility obligations track the breadth of the user audience. Scripts, APIs, and data pipelines with no user interface receive 0.

### Data Sensitivity (0–3)

Driven by q10 (multi-select data types). If q9 is `no`, the dimension is forced to 0 regardless of q10.

| Data Type (q10 value) | Score |
|-----------------------|------:|
| `hipaa`, `irb`, `export`, `tribal` (any) | 3 |
| `ferpa`, `hr`, `payment`, `credentials`, `behavioral` (any, if no tier-3) | 2 |
| `internal` (if no tier-2 or tier-3) | 1 |
| only `public` or empty | 0 |

Escalation note: any tier-3 data type also triggers the "Regulated data" escalation condition (see `escalation-conditions.md`).

### Blast Radius (0–3)

Derived from q3 (multi-select user groups) with a volume bonus from q8.

| User Group (q3 value) | Base Score |
|-----------------------|-----------:|
| `public` or `external` (any) | 3 |
| `students` or `department` (if no public/external) | 2 |
| `team` only | 1 |
| `just-me` only | 0 |

Volume bonus (additive, clamped to 3):

| Condition (q8) | Modifier |
|----------------|---------:|
| `500+` — 500+ users or high-frequency | +1 |

### Autonomy (0–3)

Driven by user awareness (q21) and presence of substantive autonomy description (q20).

| Condition | Modifier |
|-----------|---------:|
| q21 = `no` (users unaware of AI) | +2 |
| q21 = `partial` | +1 |
| q20 present and length > 10 chars | +1 |

Final score: `min(sum, 3)`.

Note: the q20 heuristic treats a meaningful description as evidence that the tool influences real decisions. Very short or empty q20 answers contribute nothing.

### Comprehension (0–3)

Inversely derived from the length of the builder's plain-language explanation (q19). Lower comprehension effort yields a higher risk score.

| q19 Length (characters) | Score |
|-------------------------|------:|
| missing or < 20 | 3 |
| < 80 | 2 |
| < 200 | 1 |
| ≥ 200 | 0 |

Rationale: a builder who cannot describe a tool's behavior and failure modes in two-plus sentences is unlikely to recognize or mitigate its risks in production.

### Maintenance (0–3)

Sum of four independent signals, rounded to the nearest integer and clamped to `[0, 3]`.

| Field | Condition | Contribution |
|-------|-----------|-------------:|
| q15 | `no-vc` (no version control) | +1 |
| q16 | `nobody` or `stop` (no successor) | +1 |
| q17 | `third-party-dep` (third-party dependency) | +0.5 |
| q18 | `only-me` or `unknown` (single responder) | +0.5 |

Formula: `maintenance = clamp(round(sum), 0, 3)`.

Note: q15 = `no-vc` also triggers the "No version control" escalation condition.

## Weight Profiles

Each artifact type has a fixed weight profile. Weights are non-negative integers. The profile is selected by q1 (artifact type); if q1 is missing or invalid, the `other` profile is used.

### Full Weight Matrix

| Artifact Type | Sec | A11y | Data | Blast | Auto | Comp | Maint | Σ Weights | Max Weighted Score |
|---------------|----:|-----:|-----:|------:|-----:|-----:|------:|----------:|-------------------:|
| public-site | 4 | 4 | 3 | 3 | 1 | 2 | 3 | 20 | 60 |
| internal-app | 3 | 3 | 4 | 2 | 1 | 2 | 3 | 18 | 54 |
| script-api | 3 | 0 | 3 | 2 | 2 | 2 | 3 | 15 | 45 |
| ai-agent | 3 | 1 | 3 | 4 | 4 | 4 | 3 | 22 | 66 |
| data-pipeline | 3 | 0 | 4 | 2 | 2 | 2 | 3 | 16 | 48 |
| other | 3 | 2 | 3 | 2 | 1 | 2 | 3 | 16 | 48 |

### Profile Rationale

- **public-site**: Security and Accessibility dominate (×4) because a public-facing site is the maximum surface area for both.
- **internal-app**: Data Sensitivity leads (×4) — internal apps typically sit atop institutional records.
- **script-api**: Accessibility drops to 0 (no UI). Autonomy rises because scripts often run without human oversight.
- **ai-agent**: Blast Radius, Autonomy, and Comprehension all rise to 4 — agentic tools combine wide reach, independent decision-making, and opaque behavior.
- **data-pipeline**: Mirrors script-api but Data Sensitivity is 4.
- **other**: Balanced default profile.

## Weighted Percentage

Once scores and weights are known, the weighted percentage is:

```
weighted_pct = Σ(score_d × weight_d) / (3 × Σ weight_d)
```

where the sum runs over all seven dimensions `d`. The result is a value in `[0, 1]`.

### Worked Example 1: Internal Dashboard

Tool: internal-app serving departmental staff, FERPA data, SSO, version controlled, clear successor, active maintenance, builder can explain the tool in a paragraph.

Intake answers (relevant): `q1=internal-app`, `q3=[department]`, `q5=public-auth`, `q6=sso`, `q8=50-500`, `q9=yes`, `q10=[ferpa]`, `q15=campus-repo`, `q16=successor`, `q17=active`, `q18=team-runbooks`, `q19=250-char explanation`.

Dimension scores:

| Dimension | Derivation | Score |
|-----------|------------|------:|
| security | q5=public-auth (2) + q6=sso (+0) | 2 |
| accessibility | q5=public-auth (3) | 3 |
| dataSensitivity | q10 has ferpa (2) | 2 |
| blastRadius | q3=department (2) | 2 |
| autonomy | q21 absent, q20 absent | 0 |
| comprehension | q19 ≥ 200 chars | 0 |
| maintenance | q15/q16/q17/q18 all clean | 0 |

Internal-app weights: `[3, 3, 4, 2, 1, 2, 3]`, Σ = 18.

Weighted sum: `2×3 + 3×3 + 2×4 + 2×2 + 0×1 + 0×2 + 0×3 = 6 + 9 + 8 + 4 = 27`.

Max: `3 × 18 = 54`.

`weighted_pct = 27 / 54 = 0.500 → 50%` → Track 3.

Additionally: `q10` contains `ferpa` and `q5` is `public-auth`, which triggers the **FERPA + public-facing deployment** escalation, forcing Track 4 regardless of percentage.

### Worked Example 2: Simple Script

Tool: script-api, just the builder, no data, version controlled, well-documented.

Answers: `q1=script-api`, `q3=[just-me]`, `q5=internal-server`, `q6=sso`, `q9=no`, `q15=campus-repo`, `q16=documented`, `q17=occasional`, `q18=team-runbooks`, `q19=long explanation`.

Scores:

| Dimension | Score |
|-----------|------:|
| security | 0 |
| accessibility | 0 |
| dataSensitivity | 0 |
| blastRadius | 0 |
| autonomy | 0 |
| comprehension | 0 |
| maintenance | 0 |

Weighted sum: `0`. Weighted percentage: `0%` → Track 1. No escalations.

### Worked Example 3: Agentic Tool for Students

Tool: ai-agent that drafts advising emails for students, disclosed as AI.

Answers: `q1=ai-agent`, `q3=[students]`, `q5=public-auth`, `q6=sso`, `q9=yes`, `q10=[ferpa, internal]`, `q12=approved-dpa`, `q15=campus-repo`, `q16=documented`, `q17=active`, `q18=team-runbooks`, `q19=long explanation`, `q20=long description`, `q21=yes`.

Scores:

| Dimension | Derivation | Score |
|-----------|------------|------:|
| security | public-auth (2) + sso (+0) | 2 |
| accessibility | public-auth (3) | 3 |
| dataSensitivity | ferpa (2) | 2 |
| blastRadius | students (2) | 2 |
| autonomy | q21=yes (+0), q20>10 chars (+1) | 1 |
| comprehension | q19 ≥ 200 chars | 0 |
| maintenance | clean | 0 |

ai-agent weights: `[3, 1, 3, 4, 4, 4, 3]`, Σ = 22.

Weighted sum: `2×3 + 3×1 + 2×3 + 2×4 + 1×4 + 0×4 + 0×3 = 6 + 3 + 6 + 8 + 4 = 27`.

Max: `3 × 22 = 66`.

`weighted_pct = 27 / 66 = 0.409 → 40.9%` → Track 2.

Escalation check: FERPA present but q5 is `public-auth`. The FERPA-public escalation fires. The tool is forced to Track 4.

## Composition and Data Flow

1. The frontend renders the intake form and runs a live preview computation as the user types (`computeTrack` in `frontend/src/constants.js`).
2. On submit, `POST /intake` sends the raw 21 answers plus `artifactType` to the backend.
3. `backend/src/routes/intake.js` calls `computeTrack(answers, artifactType)` from `scoring.js` and persists the resulting `track`, `dimensionScores`, `weightedPct`, and `escalations`.
4. The backend result is authoritative. The frontend preview may lag if constants.js drifts; a passing `scoring.test.js` run proves parity.

## Display Constants

Display metadata lives in `frontend/src/constants.js`:

- `DIMENSION_LABELS` — human-readable names for each dimension key
- `DIMENSION_SHORT` — 3–5 character codes used in the sidebar score visualization
- `TRACK_COLORS` — WCAG AA contrast-tested color swatches (Track 1 `#14754A`, Track 2 `#5C4706`, Track 3 `#C05E1A`, Track 4 `#B22B27`)
- `TRACK_LABELS` — "Register & Go", "Self-Certify", "IT Review", "Formal Project"

## Cross-References

- Track routing thresholds, percentage math, and escalation override semantics: `track-routing.md`
- The seven escalation conditions, with question mappings: `escalation-conditions.md`
- HECVAT 4.15 self-assessment integration: `hecvat.md`
- Intake question catalog and field hints: `../user-guide/intake-form.md`
- API request/response for score computation: `../api/` (intake endpoints)

## Change Control

Any change to scoring rules, weight profiles, or routing thresholds is a framework-level governance change. The weight matrix MUST be updated in both `backend/src/scoring.js` and `frontend/src/constants.js`, and `backend/src/scoring.test.js` MUST be updated to reflect the new expected outputs. Do not publish a weight change as policy without (a) running the intake against existing tools to verify tier distribution and (b) obtaining CIO sign-off.
