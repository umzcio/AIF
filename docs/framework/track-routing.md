# Track Routing

Track routing converts the weighted percentage produced by the scoring model into one of four governance tracks, applying escalation overrides where categorical risks warrant mandatory Track 4. This document specifies the routing logic, threshold boundaries, and the interaction between percentage-based routing and escalation overrides as implemented in `backend/src/scoring.js` (`routeToTrack`).

## Summary

- Four tracks, numbered 1–4, corresponding to increasing governance intensity
- Percentage thresholds: < 22% (Track 1), 22–42% (Track 2), 42–65% (Track 3), ≥ 65% (Track 4)
- Any escalation condition forces Track 4, regardless of weighted percentage
- Track assignment determines review workflow; all tracks run the same five-model automated pipeline

## Track Overview

| Track | Label | Action | Human Review |
|------:|-------|--------|--------------|
| 1 | Register & Go | Register in institutional registry; acknowledge findings | None (auto-activates on pipeline completion) |
| 2 | Self-Certify | Complete self-assessment; owner signs off | Builder self-certifies |
| 3 | IT Review | Submit to IT/security review | Reviewer approval required |
| 4 | Formal Project | Formal IT project governance | Reviewer approval plus institutional sign-off |

The canonical labels used in the UI live in `frontend/src/constants.js` (`TRACK_LABELS`):

```
1 → "Register & Go"
2 → "Self-Certify"
3 → "IT Review"
4 → "Formal Project"
```

## Threshold Boundaries

Weighted percentages (`weighted_pct`) are expressed as fractions in `[0, 1]`. The routing function uses strict `>=` comparisons at each threshold:

| Condition | Track |
|-----------|------:|
| any escalation condition present | 4 |
| `weighted_pct >= 0.65` | 4 |
| `weighted_pct >= 0.42` | 3 |
| `weighted_pct >= 0.22` | 2 |
| `weighted_pct < 0.22` | 1 |

Exact boundary values:

| Boundary | Behavior |
|----------|----------|
| 22.0% | Track 2 (inclusive lower) |
| 42.0% | Track 3 (inclusive lower) |
| 65.0% | Track 4 (inclusive lower) |
| 21.99% | Track 1 |
| 41.99% | Track 2 |
| 64.99% | Track 3 |

## Routing Algorithm

The algorithm, transcribed from `routeToTrack()`:

```
function routeToTrack(weightedPct, hasEscalation):
    if hasEscalation:
        return 4
    if weightedPct >= 0.65:
        return 4
    if weightedPct >= 0.42:
        return 3
    if weightedPct >= 0.22:
        return 2
    return 1
```

Escalation override is evaluated first. If any of the seven escalation conditions (see `escalation-conditions.md`) holds, the tool routes to Track 4 and the weighted percentage is not examined. This makes escalation a categorical gate: percentage-based scoring cannot outweigh certain institutional risks.

## Percentage Computation Recap

The weighted percentage is defined in `scoring-model.md`:

```
weighted_pct = Σ(score_d × weight_d) / (3 × Σ weight_d)
```

where `d` ranges over the seven dimensions, `score_d ∈ [0, 3]`, and `weight_d` is taken from the artifact-type weight profile.

The maximum possible `weighted_pct` is 100%, achieved when every dimension scores 3 regardless of weight profile.

## Worked Examples

Each example lists the weighted sum, the weight-profile denominator, the resulting percentage, and the routing decision.

### Example A — Track 1

A one-person script-api tool with no data handling, version control, and a well-documented explanation.

| Dimension | Score | Weight | Contribution |
|-----------|------:|-------:|-------------:|
| security | 0 | 3 | 0 |
| accessibility | 0 | 0 | 0 |
| dataSensitivity | 0 | 3 | 0 |
| blastRadius | 0 | 2 | 0 |
| autonomy | 0 | 2 | 0 |
| comprehension | 0 | 2 | 0 |
| maintenance | 0 | 3 | 0 |

Σ contributions = 0. Denominator = 3 × 15 = 45. `weighted_pct = 0%`. Track 1.

### Example B — Track 2

An internal-app serving a department, internal institutional data, SSO, well-maintained, builder comprehension intact.

| Dimension | Score | Weight | Contribution |
|-----------|------:|-------:|-------------:|
| security | 2 | 3 | 6 |
| accessibility | 2 | 3 | 6 |
| dataSensitivity | 1 | 4 | 4 |
| blastRadius | 2 | 2 | 4 |
| autonomy | 0 | 1 | 0 |
| comprehension | 0 | 2 | 0 |
| maintenance | 0 | 3 | 0 |

Σ contributions = 20. Denominator = 3 × 18 = 54. `weighted_pct = 37.0%`. Track 2.

### Example C — Track 3

A public-site handling FERPA data with SSO and partial documentation; no public exposure of FERPA (q5 = `public-auth`, so FERPA escalation is evaluated separately).

| Dimension | Score | Weight | Contribution |
|-----------|------:|-------:|-------------:|
| security | 2 | 4 | 8 |
| accessibility | 3 | 4 | 12 |
| dataSensitivity | 2 | 3 | 6 |
| blastRadius | 3 | 3 | 9 |
| autonomy | 0 | 1 | 0 |
| comprehension | 1 | 2 | 2 |
| maintenance | 0 | 3 | 0 |

Σ contributions = 37. Denominator = 3 × 20 = 60. `weighted_pct = 61.7%`. By percentage alone, Track 3. However, FERPA + `public-auth` triggers the FERPA escalation, overriding to Track 4.

### Example D — Track 4 by Percentage

An ai-agent exposed to students, making decisions, with limited comprehension.

| Dimension | Score | Weight | Contribution |
|-----------|------:|-------:|-------------:|
| security | 2 | 3 | 6 |
| accessibility | 3 | 1 | 3 |
| dataSensitivity | 2 | 3 | 6 |
| blastRadius | 2 | 4 | 8 |
| autonomy | 3 | 4 | 12 |
| comprehension | 3 | 4 | 12 |
| maintenance | 0 | 3 | 0 |

Σ contributions = 47. Denominator = 3 × 22 = 66. `weighted_pct = 71.2%`. Track 4 by percentage.

### Example E — Track 4 by Escalation

A moderate-score tool (weighted 28%) that stores institutional data in a personal GitHub account. The "Institutional data in personal accounts" escalation condition fires and forces Track 4.

## Track Semantics and Review Workflow

Each track maps to a specific handling path enforced in `backend/src/routes/registry.js` and `backend/src/routes/review.js`.

### Track 1 — Register & Go

- Automated pipeline runs (all five models, all four agents).
- On pipeline completion, the tool auto-activates; status transitions directly to `active`.
- No human review is required. The builder acknowledges the generated findings.
- Intended for low-impact tools with no regulated data and limited audience.

### Track 2 — Self-Certify

- Automated pipeline runs.
- Builder reviews findings and completes the self-certification step in `ReviewPanel`.
- On self-certification, status transitions to `approved` then `active`.
- Department head sign-off is documented.

### Track 3 — IT Review

- Automated pipeline runs.
- A reviewer (role: reviewer or admin) must open the pipeline findings and either approve or request changes.
- Approval transitions status to `approved`; the tool then moves to `active`.
- Changes requested transitions to `changes_requested`; the builder resubmits which returns the tool to `under_review`.

### Track 4 — Formal Project

- Automated pipeline runs.
- The tool is flagged for formal IT project governance outside the portal workflow.
- The reviewer captures a decision note and references the IT project ticket.
- Institutional sign-off (security, privacy, legal, compliance) is tracked externally; the portal records the final decision.

## Track Overrides

Reviewers and admins can escalate or de-escalate a track with a documented reason:

- `POST /review/:id/track-override` accepts `{ track, reason }` and validates that the reason is a non-empty string.
- Track overrides are logged to the `audit_log` table with the original and new track values, actor user ID, and reason.
- Escalations from a lower track to Track 4 are always permitted. De-escalation from Track 4 is permitted only when no escalation condition currently applies, and only by admins.

## Pipeline Uniformity

All four tracks run the identical five-model agent pipeline:

- Agent 1 (Code & Security) — 5 passes, Claude synthesis
- Agent 2 (Accessibility) — 5 passes, Claude synthesis
- Agent 3 (QA / Bug Detection) — 5 passes, Claude synthesis
- Agent 4 (Documentation) — 1 Claude pass for docs, 1 Claude pass for HECVAT

The track does not determine analysis depth; it determines the human governance layer on top of the automated review. A Track 1 tool receives the same five-model code analysis as a Track 4 tool. This is a deliberate design decision: machine scrutiny is cheap enough to apply uniformly, so institutional attention can be spent where humans add value.

## Status State Machine

Track-relevant transitions (detailed in `backend/src/routes/registry.js` TRANSITIONS):

```
draft → pending → in_progress → under_review → approved → active
                                     ↓
                              changes_requested → under_review (resubmit)
```

- Track 1 skips `under_review` and auto-transitions from `in_progress` directly to `active` on pipeline completion.
- Track 2 transitions from `under_review` to `approved` via builder self-certification.
- Track 3 and Track 4 transitions from `under_review` to `approved` require reviewer or admin role.

## Cross-References

- Dimension scoring and weight profiles: `scoring-model.md`
- The seven escalation conditions that force Track 4: `escalation-conditions.md`
- HECVAT 4.15 self-assessment integration: `hecvat.md`
- Review workflow API: `../api/` (review endpoints)
- Registry status state machine: `../api/` (registry endpoints)

## Change Control

Threshold changes (22%, 42%, 65%) are framework-level governance changes. Updates must be reflected in `backend/src/scoring.js` `routeToTrack`, covered by unit tests in `backend/src/scoring.test.js`, and approved by the CIO. Track boundary adjustments should be validated against the historical distribution of submitted tools before publication as policy.
