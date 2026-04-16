# Escalation Conditions

Escalation conditions are categorical risk triggers that force a tool into Track 4 regardless of its weighted percentage score. They exist because certain institutional risks (regulated data, unauthorized vendor access, missing version control) cannot be safely averaged out through dimensional weighting. This document specifies all seven escalation conditions, their intake-question sources, the rationale for each, and the order of evaluation as implemented in `backend/src/scoring.js` (`checkEscalations`).

## Summary

- Seven distinct escalation conditions
- Any single matching condition forces Track 4
- Evaluated after dimension scoring, before track routing
- Escalations are reported to the builder in the live sidebar and persisted on the submission record
- All escalations are visible to reviewers and retained in the audit log

## Authoritative Source

The canonical implementation lives in `backend/src/scoring.js` in the `checkEscalations(answers)` function. The frontend (`frontend/src/constants.js`) maintains a preview-only duplicate that is tested for parity against the backend.

## Condition Table

| # | Label | Trigger (Intake Answers) | Escalation Text Returned |
|--:|-------|--------------------------|---------------------------|
| 1 | Regulated data | q10 includes any of `hipaa`, `irb`, `export`, `tribal` | "Regulated data (HIPAA/IRB/Export/Tribal)" |
| 2 | FERPA + public-facing | q10 includes `ferpa` AND q5 is `public-noauth` or `public-auth` | "FERPA + public-facing deployment" |
| 3 | Personal accounts | q11 includes `personal` | "Institutional data in personal accounts" |
| 4 | Missing DPA | q12 is `no-dpa` or `unknown-dpa` | "AI model without approved DPA" |
| 5 | Custom auth | q6 is `custom-auth` | "Auth outside campus SSO" |
| 6 | No version control | q15 is `no-vc` | "No version control" |
| 7 | Students unaware of AI | q21 is `no` AND q3 includes `students` | "Students unaware of AI" |

The order above reflects the evaluation order in `checkEscalations()`. Order is not semantically meaningful — a tool may trigger multiple escalations, all of which are returned and stored.

## Condition Details

Each section below documents the condition's intake trigger, normative rationale, and institutional policy alignment.

### 1. Regulated Data (HIPAA / IRB / Export / Tribal)

**Trigger**: `q10` contains any of `hipaa`, `irb`, `export`, or `tribal`.

**Rationale**: Four categories of regulated data have statutory, contractual, or ethical handling requirements that exceed what dimensional scoring can express:

- **HIPAA** — Protected Health Information is governed by 45 CFR §164 and requires specific technical, administrative, and physical safeguards plus executed Business Associate Agreements.
- **IRB** — Human-subjects research data is governed by the institutional IRB protocol and may be subject to consent-scope restrictions that prohibit secondary use.
- **Export-controlled / CUI** — Data subject to EAR or ITAR requires validated access controls for US-person-only handling, plus may trigger DoD CUI requirements.
- **Tribal / indigenous** — Data concerning or originating with tribal nations invokes the principles of tribal data sovereignty (OCAP, CARE, etc.) and may require explicit tribal council approval.

Track 4 routing forces these tools into a formal IT project where legal, privacy, and compliance offices participate in review.

### 2. FERPA in Public-Facing Deployment

**Trigger**: `q10` contains `ferpa` AND `q5` is `public-noauth` or `public-auth`.

**Rationale**: The Family Educational Rights and Privacy Act (20 USC §1232g) restricts disclosure of student educational records. A public-facing deployment (either unauthenticated or authenticated but internet-reachable) materially increases the risk of inadvertent disclosure — cache leakage, indexing, misconfigured access controls, or social engineering — even when access controls are intended to prevent it.

Note the specificity: FERPA in a campus-VPN-only tool does not trigger escalation on this condition alone (it may still score Track 3 by percentage), but FERPA plus public accessibility is categorically unacceptable without formal project governance.

Public-auth (requires authentication but is internet-accessible) is included because FERPA access control failures disproportionately originate from internet-facing endpoints regardless of auth posture.

### 3. Institutional Data in Personal Accounts

**Trigger**: `q11` contains `personal`.

**Rationale**: Storing institutional data in a builder's personal cloud storage, personal GitHub account, personal spreadsheets, or personal AI-provider accounts creates four specific risks:

- No contractual control over the data custodian (no DPA, no BAA).
- No institutional ability to revoke access on employee separation.
- No guarantee of geographic or jurisdictional residency.
- No audit trail of access or modifications under institutional control.

This condition is narrowly scoped to the explicit `personal` selection on q11. Selecting `approved-third` (third-party with DPA) or `unknown-third` (third-party, DPA unknown — this raises a separate DPA concern) does not trigger this condition.

Policy alignment: most institutional data governance policies prohibit personal-account storage of institutional data as a standalone rule; this escalation exists to catch tools that have already made that choice.

### 4. AI Model Without Approved DPA

**Trigger**: `q12` is `no-dpa` or `unknown-dpa`.

**Rationale**: Sending institutional data to an external AI provider without a vetted Data Processing Agreement creates material risk across all seven dimensions simultaneously — the data leaves institutional control, the provider's downstream retention, training use, sub-processor list, and breach-notification obligations are all unknown or unsupported.

`no-dpa` means the builder knows a DPA is absent. `unknown-dpa` means the builder does not know whether a DPA is in place. Both route to Track 4 because in both cases the institution lacks contractual protection.

`approved-dpa` (q12) does not trigger escalation on this condition. It may still interact with other conditions — e.g. an approved-DPA tool still triggers Condition 2 if it exposes FERPA data publicly.

### 5. Authentication Outside Campus SSO

**Trigger**: `q6` is `custom-auth`.

**Rationale**: Custom or third-party authentication mechanisms bypass the institutional identity provider, meaning:

- Credentials are not centrally revocable on separation or compromise.
- MFA, session policies, and password rules are not enforced by the IdP.
- There is no audit trail in the institutional log aggregation.
- Account lifecycle (creation, deprovisioning) operates outside HR-integrated flows.

The `no-auth` answer on q6 does not trigger this escalation directly, but is independently penalized in the Security dimension (+1) and may push the tool toward Track 4 on percentage alone.

The `not-implemented` answer is treated as not-yet-decided; builders are directed to implement SSO or justify the alternative before submitting.

### 6. No Version Control

**Trigger**: `q15` is `no-vc`.

**Rationale**: The absence of version control blocks every downstream governance requirement:

- No reproducible build artifact for security review.
- No change audit trail.
- No rollback capability on incident.
- No inheritance path on owner departure.
- No peer review or code signing.

This is a minimum bar for any tool above Track 1. The framework escalates it to Track 4 rather than merely rejecting the submission because the escalation produces a documented conversation with IT rather than a silent rejection — the builder learns precisely what needs to change and where the campus code repositories are.

The three acceptable version-control answers (`campus-repo`, `personal-repo`, `dept-repo`) all satisfy the minimum. Personal repositories may be flagged by reviewers for a recommended migration to institutional infrastructure but do not trigger escalation on this condition alone (they may interact with Condition 3 if institutional data is also stored in the personal repo).

### 7. Students Unaware of AI

**Trigger**: `q21` is `no` AND `q3` contains `students`.

**Rationale**: Pedagogical ethics require that students know when they are interacting with AI. This draws from the EDUCAUSE AI Ethical Guidelines (2025), specifically the **Respect for Autonomy** principle: affected persons must know a tool exists, understand what it does, and retain meaningful agency over their relationship with it.

Deploying an AI system into a student-facing workflow without disclosure:

- Deprives students of informed consent regarding the system evaluating, grading, or advising them.
- Undermines faculty oversight of pedagogy.
- May create academic-integrity asymmetries (some students know an AI is involved; others don't).
- May conflict with accreditor expectations regarding transparent assessment.

The compound trigger (`q21=no` AND `q3` includes `students`) is deliberately narrow. A tool where students are not users (q3 omits `students`) does not trigger this condition even if q21 is `no`. A tool where students know they're interacting with AI (`q21=yes` or `q21=partial`) does not trigger this condition. A tool with no direct user interaction (`q21=na`) does not trigger.

Pedagogy-adjacent escalations that are NOT encoded as automated conditions but are documented in `FrameworkDoc` include: "Deployed in a course without faculty awareness", "Could compromise academic integrity without faculty oversight", and "Student behavioral/performance data beyond FERPA authorization". These are reviewer responsibilities during Track 3 and Track 4 review.

## Evaluation and Reporting

### Order of Operations

1. `computeDimensionScores(answers)` produces the seven scores.
2. `checkEscalations(answers)` produces an array of triggered escalation labels (may be empty, may contain one or many).
3. `computeWeightedPercentage(scores, artifactType)` produces the percentage.
4. `routeToTrack(weightedPct, escalations.length > 0)` applies the override: any non-empty escalation array forces Track 4.

All steps run for every submission. Escalations are recorded even when the weighted percentage alone would have routed to Track 4 — the provenance of the Track 4 decision is preserved in the record.

### Persistence

On intake submission (`POST /intake`), the escalation array is persisted on the `tools.escalations` field as a JSON array of human-readable strings. The record is immutable after submission; if intake answers change on resubmission, a new version of the record is created.

### Audit Trail

Every Track 4 routing (whether by percentage or by escalation) is logged to the `audit_log` table with the triggering conditions, dimension scores, weighted percentage, and actor (builder at submission; reviewer/admin on track override). This enables audit of whether escalations are firing as designed over time.

## Frontend Surfacing

The intake form (`frontend/src/components/IntakeForm.jsx`) surfaces escalation triggers in two ways:

- **Per-question warnings** — when a builder selects an answer that would trigger an escalation (e.g. FERPA + public-facing, no version control), an inline warning appears beneath that question explaining the routing consequence.
- **Live sidebar** — the live scoring sidebar lists all currently-triggered escalations with warning icons. This lets builders see the cumulative effect of their answers before submission.

The explicit surfacing is intentional: the framework prefers that builders understand why they're being routed to Track 4 in time to reconsider design choices (e.g. use campus SSO, add a DPA) rather than discovering the routing decision after submission.

## Cross-References

- Dimension scoring rules: `scoring-model.md`
- Track routing and boundaries: `track-routing.md`
- HECVAT self-assessment integration: `hecvat.md`
- Intake question catalog: `../user-guide/intake-form.md`
- Review workflow and track overrides: `../api/` (review endpoints)

## Change Control

Adding, removing, or modifying an escalation condition is a high-impact framework change. It affects the historical interpretation of existing Track 4 records. Changes must be:

- Mirrored in `backend/src/scoring.js` `checkEscalations()` and `frontend/src/constants.js` `checkEscalations()`.
- Covered by new test cases in `backend/src/scoring.test.js`.
- Accompanied by a migration plan for existing records whose routing may have relied on the prior definition.
- Approved by the CIO office and, for conditions touching pedagogy or student data, by faculty senate and the institutional registrar.
