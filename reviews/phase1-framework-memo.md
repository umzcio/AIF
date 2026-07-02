# PHASE 1: Framework Evaluation Memo

Agent: FRAMEWORK-EVALUATOR
Scope: AIF governance framework, scoring model, escalation conditions, pipeline design, review process, portability
Sources read in full: README.md; docs/framework/{scoring-model,track-routing,escalation-conditions,hecvat}.md; docs/institutional-adoption/{porting,customization,compliance-mapping}.md; backend/src/scoring.js + scoring.test.js; backend/src/routes/{intake,review,pipeline,analytics}.js; backend/src/pipeline/queue.js; backend/src/orchestrator/direct-api.js; backend/src/agents/shared/{direct-api,codebase-bundle}.js; backend/src/agents/code-analysis/lenses.js; backend/src/agents/qa-analysis/prompts.js; backend/src/agents/documentation/{prompts,runner}.js; backend/src/agents/accessibility/prompts.js (schema section); backend/src/{config,validation}.js; backend/src/auth/middleware.js; frontend/src/components/IntakeForm.jsx; frontend/src/constants.js.

---

## Framework Verdict

**Viable with conditions.**

Proportional, risk-tiered governance with automated scoring is the right model for the problem AIF targets: hundreds of AI-built tools that traditional change management cannot triage, at an institution that cannot afford to review all of them and cannot afford to review none of them. The core design decisions are sound: uniform machine analysis with human attention scaled by track, categorical escalations that cannot be averaged away, an authoritative backend scorer with a preview-only frontend copy, and a test suite that enforces parity. The docs are unusually honest about what is stubbed and what is hardcoded. But the framework currently has two structural holes that undermine its own thesis. First, the entire routing decision rests on 21 self-reported answers, and the pipeline, which independently derives the exact signals needed to check those answers (SSO usage, data classifications, AI disclosure), never compares its findings to the intake or affects the track. Second, the enforcement layer leaks: the pipeline-run API accepts a builder-supplied track that drives Track 1 auto-activation, and six scoring-critical questions marked REQUIRED in the UI are never actually enforced, so the escalation conditions can be skipped by leaving questions blank. Add a scoring model where the conditional intake form silently assigns maximum Comprehension risk to every non-AI tool and where choosing the "ai-agent" artifact type lowers your track for identical answers, and the framework's honest-builder outcomes are wrong in realistic cases and its dishonest-builder outcomes are trivially gameable. All of this is fixable without redesign, which is why the verdict is viable-with-conditions rather than structurally flawed.

---

## 1. Core Viability

**Steelman.** The framework does the two things governance frameworks usually fail at. It gives builders an immediate, transparent answer (live scoring sidebar, per-question escalation warnings in `IntakeForm.jsx`), and it makes the cheap thing (machine analysis) uniform while scaling the expensive thing (human review) by risk. Escalations as categorical overrides are correct: no weighted average should launder HIPAA data. The audit trail, notifications, and state machine make decisions inspectable. Cost per review is actually tracked (`MODEL_COST_USD`, `pipeline_metrics.estimated_cost_usd`, `queue.js:43-51,450-465`), which most governance tooling cannot claim.

**Attack: self-report integrity.** Routing is 100% self-report. The pipeline produces the material to check it: Agent 1's output schema includes `escalationSignals.noInstitutionalSSO`, `escalationSignals.studentFacingNoDisclosure`, `dataOperations[].classification` (FERPA/HIPAA/PII), and per-dimension `scoringSignals` (`lenses.js:47-70`). None of it is consumed. `grep -rn scoringSignals frontend/src backend/src/routes backend/src/pipeline` returns no consumer: not compared to intake answers, not shown against the intake scores, not used to recompute the track. A builder who answers "no PII" while the code queries a student table sails through, and on Track 1 the tool auto-activates with zero human contact (`queue.js:325`). This is the framework's single largest structural gap. The fix is not a new research problem: a contradiction detector that diffs Agent 1's escalation signals and data classifications against q6/q10/q21 and blocks auto-activation on mismatch is a report-processing step, not a new agent pass. See FW-02.

**Attack: gaming and drift.** Intake answers are immutable after the draft stage. No route updates `intake_answers` post-submission (`toolEditSchema` in `validation.js:67-73` allows only name/description; `registry.js` never touches `intake_answers`), so `changes_requested -> under_review` resubmission never re-scores. There is no periodic re-attestation, no change detection on active tools, and no re-scoring hook on re-upload. A Track 1 tool that grows FERPA features stays Track 1 forever unless a reviewer notices manually. `escalation-conditions.md:144` claims "if intake answers change on resubmission, a new version of the record is created"; no versioning mechanism exists anywhere in the code. Differential review of findings between runs exists (`queue.js:222-243`) and is genuinely good, but it diffs pipeline findings, not risk posture.

---

## 2. Scoring Model Soundness

**Docs vs code.** `scoring.js` implements `docs/framework/scoring-model.md` faithfully: every dimension rule, the weight matrix, the formula, and the 22/42/65 thresholds match line for line, and `scoring.test.js` pins the boundaries and frontend/backend parity. The divergences are between the documented model and the intake form that feeds it, and inside the docs themselves. Full enumeration:

1. `scoring-model.md:204` (worked example 2) assumes a script-api tool answers q19 with a long explanation. The form never shows q19/q20/q21 unless `q1 === "ai-agent"` or q12 indicates external AI (`IntakeForm.jsx:308-316,529`). The documented intake is unreachable through the UI. Consequence: FW-04.
2. `scoring-model.md` and `escalation-conditions.md` describe q19-q21 as general drivers of Comprehension/Autonomy; in practice those dimensions are only measurable for AI-classified tools. Undocumented.
3. `escalation-conditions.md:144` says escalations persist to `tools.escalations`; the column is `escalation_conditions` (`migrations/001_init.sql:31`). Trivial, folded into FW-15.
4. `escalation-conditions.md:144` claims record versioning on resubmission; none exists (FW-15).
5. Everything else (security/accessibility/data/blast/autonomy/comprehension/maintenance rules, weights, thresholds, escalation predicates) matches exactly. Credit where due.

**Dimension independence.** Three of seven dimensions are substantially the same variable. q5 (deployment surface) sets the Security base (`scoring.js:25-28`) and fully determines Accessibility (`scoring.js:31-32`), and public deployment almost always co-occurs with q3 public/external, which sets Blast Radius 3. For a public-site those are the three heaviest weights (4+4+3 of 20): a single fact, "it is on the internet," contributes up to 30 of 60 weighted points. Accessibility here measures exposure obligation, not the artifact's actual accessibility. Meanwhile Autonomy is mostly a disclosure measure: q21 (do users know it is AI) contributes up to +2 of its 3 points (`scoring.js:46-47`), and the only genuine autonomy signal is `q20.length > 10` (`scoring.js:48`), which fires on any substantive answer including "None, a human reviews every output." Comprehension and Maintenance are genuinely independent. The model works despite the correlation because exposure is a legitimate risk driver, but the seven-dimension framing overstates the information content: it is closer to four independent variables.

**Worked examples under real weights (all arithmetic from `scoring.js:8-15`).**

High-risk AI agent (sanity check, matches `track-routing.md` example D): scores [2,3,2,2,3,3,0], ai-agent weights [3,1,3,4,4,4,3]: 6+3+6+8+12+12+0 = 47/66 = 71.2%, Track 4. Correct and feels right.

Low-risk public site: static departmental site, public-noauth (sec 3, a11y 3), q3 public (blast 3), q9=no (data 0), no AI so comprehension is forced to 3 (see FW-04), maintenance 0: 3x4+3x4+0+3x3+0+3x2+0 = 39/60 = 65.0%, Track 4 by percentage. A static brochure site with no data and no auth surface lands in Formal Project governance. Remove the phantom comprehension 3 and it is 33/60 = 55%, Track 3, still arguably heavy for a brochure but defensible. The comprehension artifact pushes an entire class of harmless public sites over the 65% line.

Boundary flip 1 (comprehension asked vs not asked): internal-app, campus-vpn, SSO, internal data, department users, clean maintenance. Scores [1,2,1,2,0,comp,0], weights [3,3,4,2,1,2,3]: with comp=3 (form never asked q19): 23/54 = 42.6%, Track 3. With comp=0 (same builder, given the chance to answer): 17/54 = 31.5%, Track 2. The track is flipped by a question the form refuses to show. Not defensible. FW-04.

Boundary flip 2 (artifact type choice): public-auth app with an embedded LLM feature, SSO, internal data, department users, q21=yes, q20 short, q19 long. Scores [2,3,1,2,0,0,0]. As internal-app: 6+9+4+4 = 23/54 = 42.6%, Track 3. As ai-agent: 6+3+3+8 = 20/66 = 30.3%, Track 2. Declaring your tool an AI agent, the highest-risk category in the framework's own rhetoric, lowers its track for identical answers. Not defensible. FW-05.

Boundary flip 3 (prose length): ai-agent, students, public-auth, internal data, disclosed, q20 answered, maintenance clean. With q19 at 200+ chars: 24/66 = 36.4%, Track 2. Same tool, q19 at 150 chars: 28/66 = 42.4%, Track 3. Fifty characters of prose is a governance boundary, and the direction is perverse for gaming: padding q19 with AI-generated filler de-escalates, and shortening q20 to under 11 characters removes an autonomy point. Character count is the weakest possible proxy for comprehension and it is the single most gameable input in the model.

**Thresholds.** 22/42/65 appear in `scoring.js:89-95`, both routing docs, and `porting.md:184` with zero stated rationale anywhere: no comment, no derivation, no calibration data. `track-routing.md:231` requires validating threshold changes against "the historical distribution of submitted tools" but no tooling or published distribution exists. They are arbitrary and should be labeled provisional until calibrated against the real submission corpus. FW-13.

---

## 3. Escalation Conditions

The seven conditions (`scoring.js:63-74`) are the strongest part of the model: cheap to evaluate, hard to argue with, surfaced to the builder before submission. Coverage and precision issues:

**Missing escalators.**
- Payment data: q10 `payment` scores Data Sensitivity 2 and triggers nothing. A tool taking credit cards routes on percentage alone. PCI DSS exposure is exactly the kind of categorical risk the escalation list exists for.
- Credentials data: q10 `credentials` (auth credentials/identity) likewise scores 2 with no escalation. A tool storing other people's passwords is not a weighted-average problem.
- Automated consequential decisions about individuals: q20 is free text and feeds nothing but a length check. An agent that autonomously changes grades, with q21=yes and a DPA, never escalates. The framework's own Agent 1 prompt checks "auto-completes assignments or generates assessments without faculty oversight" (`lenses.js:206`) but the intake cannot express it.
- Third-party AI with data retention/training: q12 only distinguishes DPA presence. A provider with a DPA that trains on inputs is invisible.
- All of these are reviewer responsibilities per `escalation-conditions.md:129`, which is honest, but for Track 1-2 tools no reviewer ever looks.

**Over-blunt conditions.**
- FERPA + `public-auth` (condition 2). `public-auth` means internet-reachable behind auth, which describes essentially every modern SSO web app. The result: any FERPA tool that is a normal SSO-protected web app is Track 4, always. Track 3 (IT Review) is unreachable for the single most common category of student-data tools. The framework's own worked example (`scoring-model.md:224-246`) shows a disclosed, DPA-approved, SSO-protected, version-controlled advising tool scoring 40.9% and being forced into Formal Project governance. That contradicts the proportionality principle the framework is named for. Escalating `public-noauth` FERPA is right; `public-auth` + SSO should floor at Track 3, not 4. FW-06.
- No version control (condition 6) forces Formal Project governance on a tool whose only defect is no git repo. The doc's rationale ("produces a documented conversation") is a justification for blocking, not for Track 4 specifically; a hard submission gate ("create a repo, then submit") reaches the same outcome without consuming formal-governance capacity.
- Custom auth (condition 5) as unconditional Track 4 is defensible for institutional data but fires equally for a tool with no institutional data at all (the check reads only q6).

**Precision defects.** `checkEscalations` ignores q9: a builder who selects HIPAA under q10, then flips q9 to "no data" (the form hides but retains q10 in state, `IntakeForm.jsx:272-277`), gets Data Sensitivity forced to 0 (`scoring.js:38`) while the Regulated Data escalation still fires. Fail-safe direction, but the same record then asserts "handles no data" and "handles HIPAA" simultaneously. The exploitable direction is worse: because q10/q11/q12/q21 are never enforced (FW-03), the escalations that depend on them are skippable by omission.

---

## 4. Pipeline Design

**Position on 5-identical-prompts.** The convergence claim is weaker than advertised and the cost is real (~$2.50-3.00/run at the constants in `queue.js:43-51`, most of it the 4x Claude synthesis). Passes 2-5 are not independent observers: they receive the identical 400K-char bundle, the identical prompt, the identical JSON schema, at temperature 0 (`direct-api.js:127-132`). They differ only in weights. Convergence therefore measures inter-model agreement on one fixed, possibly truncated view of the codebase, and shared blind spots (excluded files, bundle ordering, schema-shaped attention) are correlated across 4 of 5 votes. Worse, the prompts lie to those models: `QA_PROMPT` says "You have full filesystem access — read any file you need" (`qa-analysis/prompts.js:91`) and `ANALYSIS_PROMPT` says "Start by listing the full directory tree" (`lenses.js:93`) when passes 2-5 have no filesystem. The file is even named `lenses.js` and contains no lenses: `PASSES` at `lenses.js:279-285` assigns the same prompt to all five. Recommendation: keep pass 1 (Codex, filesystem) as the explorer, cut to three API models, and give each a differentiated lens (data-flow/secrets, auth/authz, correctness/error paths) with convergence redefined as "flagged by 2+ lenses or verified by synthesis." Same or lower cost, genuinely decorrelated coverage, and the lenses.js name becomes true. This is a redesign of the marquee feature and should be validated against pilot data before switching.

**Synthesis as arbiter.** The dispute-resolution design (factual vs judgment disputes, mandatory file verification, hallucination dropping, `lenses.js:287-428`) is genuinely well thought out. Two problems. First, synthesis is a hard single point of failure: `runAgentDirect` awaits `runCLIWithRetry("claude", ...)` with no try/catch (`orchestrator/direct-api.js:211-214`), so if Claude fails twice, the whole run fails even with 5/5 completed passes sitting on disk. Second, nothing checks Claude: synthesis output is `extractJSON`'d and written straight through (`orchestrator/direct-api.js:215-222`), never validated against a schema, and on Track 1 it feeds auto-activation with no human. When Claude-the-synthesizer is wrong, the system has no mechanism to notice. Additionally, synthesis input truncates every pass report to 15,000 chars (`orchestrator/direct-api.js:154-180`), so on verbose reports the arbiter counts convergence over amputated JSON. FW-10.

**Failure modes, traced in code.**
- Provider error mid-pipeline: handled well. Passes run under `Promise.allSettled` (`orchestrator/direct-api.js:62`), direct passes fall through 3 response_format attempts (`direct-api.js:123-293`), Codex gets 1 retry, and synthesis proceeds with a partial caveat if at least one pass survives. But the floor is 1, not 4: `if (passCount === 0) throw` (`orchestrator/direct-api.js:151`). README:181 says "if 4/5 passes succeed, pipeline continues," implying a quorum that does not exist. A "multi-model convergence" report built from one model still routes a Track 1 tool to auto-activation, flagged only by `partial_analysis` metadata nothing acts on. FW-15/FW-11.
- Bundle over-limit: deterministic and graceful mechanically (`codebase-bundle.js:210-259`): manifests and configs always included, source largest-first until budget, excluded list appended to the bundle and written to `_bundle_manifest.json`. But governance-wise it is silent: `truncated: true` sets no flag on the synthesis, the report, or the run. Findings in excluded files are visible only to pass 1, so they mathematically cannot reach the 3-model "confirmed" tier. "Every file must be reviewed — no exceptions" (`lenses.js:93`) is false for 4 of 5 reviewers on any codebase over 400K chars. FW-11.
- No-code submission: intake allows submitting with neither upload nor URL (`intake.js:139-241` has no codebase requirement). `enqueue` does not check either; `processNext` throws "Codebase not found" (`queue.js:208-210`), the run fails, and retries burn toward the dead letter queue. Safe but not graceful, and on non-cancel failure the tool status is left stuck at `in_progress` (revert to pending only happens `if (isCancelled)`, `queue.js:391-396`).
- Cost tracking: exists and is surfaced (`/analytics/overview` cost block, trends). Estimates are static per-pass constants even though actual token usage is captured per response (`direct-api.js:186-195`) and discarded for costing. Adequate for the adoption question; easy to make real.

---

## 5. Review and Decision Process

**Track 2 self-certify is currently liability theater.** `POST /review/:toolId/self-certify` (`review.js:172-220`) takes no body. There is no attestation text, no requirement that the builder opened the report, no acknowledgment of specific findings, and no captured statement of what was certified. The audit row says only "Builder self-certified findings." `track-routing.md:173` claims "Department head sign-off is documented"; nothing in the code collects or stores any sign-off. The one-click version produces an audit record, which has some deterrence value, but as assurance it certifies nothing. Also, the guard at `review.js:179` only restricts builders, so any reviewer can "self"-certify someone else's Track 2 tool; harmless in effect (it is equivalent to approval) but wrong in provenance since `review_decision` reads `self_certified`.

**Reviewer capacity is not modeled anywhere.** The review queue exists (`review.js:11-22`, ordered by `updated_at`), notifications fan out to every reviewer and admin on every Track 2-4 completion (`queue.js:355-373`), and that is the entire capacity story. No SLA, no assignment, no aging metric. A framework that routes correctly but queues indefinitely fails silently, and this one cannot even see the queue aging.

**Analytics cannot answer median time-to-decision per track.** Verified: `analytics.js` (all 271 lines) queries only `pipeline_runs`, `pass_results`, `pipeline_metrics`; it never touches `tools.review_decided_at`, which `review.js:38-41` faithfully populates. `admin.js` has no decision-timing query either. The raw data for time-to-decision (pipeline `completed_at` as review-start proxy, `review_decided_at` as end, `track` on the tool) is all in the database; no endpoint computes it. FW-14.

---

## 6. Portability

The claim in `porting.md:5` ("carries no UM-specific code... adopting AIF is a configuration task, not a fork") is close to true for infrastructure and knowingly false for governance, and the docs mostly admit it.

Actually configurable via env (`config.js`, verified): institution identity, base path, auth provider selection, CAS endpoints, admin list, SMTP, output/codebase dirs, git host allowlist, HECVAT template path. Auth is genuinely pluggable with two production providers (CAS, header) and two stubs (OIDC, SAML), and `porting.md:73-80` labels the stubs plainly. Since most non-CAS institutions are on Entra/SAML, the identity story covers fewer real institutions than the five-provider table suggests, but header-auth behind Shibboleth is a legitimate bridge.

Not configurable without code changes: the 21 questions, weight profiles, thresholds, escalation list, status machine. `customization.md` classifies all of this correctly as tier-2 source edits with test enforcement. That is an honest and reasonable line; governance policy should require change control.

Undisclosed UM residue: the Agent 1 prompt hardcodes "UM CAS, Banner" (`lenses.js:112`) and "the UM framework" (`lenses.js:199`) into every pass of every adopting institution's pipeline; the `INSTITUTION_NAME` config never reaches the prompts. `customization.md:177-188`'s "known hardcoded values" table lists email colors and product strings but misses these.

Honest distance rating: infrastructure portability 9/10, identity portability 6/10 (stubs), governance portability 6/10 (fork-level edits, correctly documented), pipeline prompt portability 7/10 (UM strings baked in). Aggregate: the claim is 80% true and the remaining 20% is mostly documented. Better than typical.

---

## Findings

```
ID: FW-01
Title: Builder-supplied track on pipeline run bypasses review and auto-activates the tool
Severity: Critical
Location: backend/src/routes/pipeline.js:50-61, backend/src/validation.js:62-65, backend/src/pipeline/queue.js:78-97,325
Category: Framework concern — governance bypass / broken access control (CWE-285)
Evidence: pipeline.js:50 `router.post("/:toolId/run", requireOwnerOrRole("admin"), validate(pipelineRunSchema), ...)` then `enqueue(toolId, track, null, mode)`. validation.js:63 `track: z.number().int().min(1).max(4).optional()`. queue.js:83 `const runTrack = track || tool.track;` and queue.js:325 `const newStatus = next.track === 1 ? "active" : "under_review";`
Why it matters: The tool owner (any builder) can POST {"track":1} for their Track 3/4 tool; the run records track 1 and on completion the tool status is set directly to active, skipping reviewer approval entirely. The framework's central enforcement promise (Tracks 3-4 require human approval) is defeated by one request parameter.
Fix: Remove `track` from pipelineRunSchema, or accept it only for users with reviewer/admin role and log an audit entry; derive auto-activation from tools.track, not from the run row.
Confidence: Confirmed
```

```
ID: FW-02
Title: Pipeline never cross-checks intake answers and never influences the track; scoringSignals and escalationSignals are produced and discarded
Severity: Critical
Location: backend/src/agents/code-analysis/lenses.js:47-70,196-207; backend/src/pipeline/queue.js:311-336; framework/docs
Category: Framework concern — self-report integrity
Evidence: lenses.js:62-70 defines per-dimension `scoringSignals` and lenses.js:47-54 defines `escalationSignals` including `noInstitutionalSSO` and `studentFacingNoDisclosure`. Search across backend/src/routes, backend/src/pipeline, and frontend/src for `scoringSignals` returns zero consumers (verified via grep; only agents/* and resume-pipeline.js reference it). queue.js completion path (lines 322-336) writes run status and tool status only; tools.track is never recomputed or compared.
Why it matters: Routing is 100% self-report. A builder who answers "no PII" and "campus SSO" while the code queries student tables with custom auth is routed to Track 1 and auto-activated with no human contact, even though Agent 1's own report contains the contradicting evidence. This undermines the framework's core claim of enforcement.
Fix: Add a post-synthesis contradiction step: map Agent 1 escalationSignals/dataOperations/authentication to intake answers (q6, q10, q21); on contradiction, block auto-activation, set status under_review, notify reviewers, and display an intake-vs-code diff on the report. The signals already exist; this is report processing, not a new agent.
Confidence: Confirmed
```

```
ID: FW-03
Title: Six scoring-critical questions marked REQUIRED are never enforced, and the backend accepts unvalidated intake answers; escalations are skippable by omission
Severity: Major
Location: frontend/src/components/IntakeForm.jsx:14,342-358; backend/src/routes/intake.js:28-42,139-241
Category: Framework concern — input validation / gaming vector
Evidence: IntakeForm.jsx:14 `const REQUIRED_QUESTIONS = ["q1","q2","q3","q4","q5","q6","q7","q9","q14","q15","q16","q17","q18"];` omits q10, q11, q12, q19, q20, q21 even though the corresponding <Q> components render `req` (e.g. lines 488, 494, 498, 531-539). intake.js parseBody (lines 28-42) JSON.parses intakeAnswers with no schema; no Zod schema exists for intake in validation.js.
Why it matters: A builder answers q9=yes and leaves q10/q11/q12 blank: dataSensitivity computes 0 and the Regulated Data, Personal Accounts, and Missing DPA escalations cannot fire. Leaving q21 blank suppresses the Students-unaware escalation. The escalation layer, the framework's hard floor, is optional in practice.
Fix: Add q10-q12 (when q9=yes) and q19-q21 (when AI-classified) to REQUIRED_QUESTIONS, and add a backend Zod schema validating answer keys and enum values on submit, rejecting q9=yes with empty q10/q11/q12.
Confidence: Confirmed
```

```
ID: FW-04
Title: Comprehension auto-scores 3 (maximum risk) for every non-AI tool because q19 is only rendered for AI-classified submissions; flips tracks for honest builders
Severity: Major
Location: frontend/src/components/IntakeForm.jsx:308-316,529-541; backend/src/scoring.js:50; docs/framework/scoring-model.md:200-218
Category: Framework concern — scoring model defect / doc-form divergence
Evidence: IntakeForm.jsx:308 `const showAI = a.q1 === "ai-agent" || a.q12 === "approved-dpa" || ...` gates q19-q21 (line 529). scoring.js:50 `if (!a.q19 || a.q19.length < 20) s.comprehension = 3;`. scoring-model.md worked example 2 assumes a script-api tool answered q19 ("q19=long explanation"), which the form never asks.
Why it matters: Worked math: internal-app, campus-vpn, SSO, internal data, department users, clean maintenance scores 23/54 = 42.6% (Track 3) with the phantom comprehension 3, versus 17/54 = 31.5% (Track 2) if the builder were allowed to answer q19. The governance tier of every non-AI tool is inflated by a question it cannot see, and the docs' own examples are unreachable through the UI.
Fix: Either always ask q19 (it is a comprehension question, not an AI question), or score comprehension as 0-weight when the question was not presented. Update scoring-model.md examples to match.
Confidence: Confirmed
```

```
ID: FW-05
Title: Choosing the "ai-agent" artifact type lowers the track versus "internal-app" for identical answers; weight-profile denominators invert the intended risk ordering
Severity: Major
Location: backend/src/scoring.js:8-15,78-95
Category: Framework concern — scoring model defect / gaming vector
Evidence: WEIGHT_PROFILES: internal-app sums to 18 (max 54), ai-agent to 22 (max 66) with accessibility weight 1 vs 3. Worked math for a public-auth SSO app with internal data, department users, disclosed AI, comprehension 0 (scores [2,3,1,2,0,0,0]): internal-app 23/54 = 42.6% -> Track 3; ai-agent 20/66 = 30.3% -> Track 2.
Why it matters: Both classifications are honest descriptions of an internal web app with an LLM feature. Self-identifying as the framework's highest-rhetoric-risk category reduces scrutiny by a full track. Builders will discover this; the artifact-type question becomes a gaming surface.
Fix: Add an invariant test: for any fixed answer set, computeWeightedPercentage(ai-agent) >= computeWeightedPercentage of less risky types minus a tolerance, and rebalance profiles (raise ai-agent accessibility weight or normalize denominators) until it passes.
Confidence: Confirmed
```

```
ID: FW-06
Title: FERPA + public-auth escalation forces Track 4 on every internet-reachable SSO-protected student-data app, making Track 3 unreachable for the most common student-data tool class
Severity: Major
Location: backend/src/scoring.js:67; docs/framework/escalation-conditions.md:48-57; docs/framework/scoring-model.md:224-246
Category: Framework concern — escalation over-breadth vs proportionality principle
Evidence: scoring.js:67 `if (dt.includes("ferpa") && (a.q5 === "public-noauth" || a.q5 === "public-auth")) e.push("FERPA + public-facing deployment");`. The form defines public-auth as "Public internet — requires auth" (IntakeForm.jsx:465), which describes standard SSO web deployment. scoring-model.md example 3: disclosed, DPA-approved, SSO, version-controlled advising tool scores 40.9% and is forced to Track 4.
Why it matters: Nearly every modern campus web app is internet-reachable behind SSO. The rule collapses the framework's proportionality for FERPA tools: Track 3 (IT Review), the tier designed for exactly these tools, cannot be reached. Predictable outcomes: reviewers rubber-stamp Track 4s or builders stop selecting ferpa on q10.
Fix: Keep public-noauth + FERPA as Track 4. For public-auth + FERPA with q6=sso, floor the route at Track 3 instead of forcing Track 4.
Confidence: Confirmed
```

```
ID: FW-07
Title: Track 2 self-certification records no attestation and the documented department-head sign-off does not exist
Severity: Major
Location: backend/src/routes/review.js:172-220; docs/framework/track-routing.md:170-173
Category: Framework concern — assurance gap / doc-code divergence
Evidence: review.js:172 `router.post("/:toolId/self-certify", async (req, res) => {` accepts no body; the note inserted is the fixed string 'Builder self-certified findings' (line 193). track-routing.md:173: "Department head sign-off is documented."
Why it matters: Self-certification is the entire human control for Track 2. As built it is one unauthenticated-by-content click: no statement of what was reviewed, no findings acknowledgment, no sign-off identity. If a Track 2 tool causes an incident, the record proves only that a button was pressed.
Fix: Require a request body: attestation text, confirmation checkbox set (findings reviewed, escalations understood), optional supervisor identity; store it in review_notes.metadata. Gate the endpoint on the builder having fetched the report at least once.
Confidence: Confirmed
```

```
ID: FW-08
Title: Track override lacks the constraints the docs promise: any reviewer can de-escalate Track 4, with no escalation-condition check
Severity: Major
Location: backend/src/routes/review.js:74-111; backend/src/validation.js:22-25; docs/framework/track-routing.md:190-194
Category: Framework concern — doc-code divergence / authorization gap
Evidence: review.js:74 `router.post("/:toolId/track-override", requireRole("reviewer", "admin"), validate(trackOverrideSchema), ...)` updates tools.track with no other checks. track-routing.md:194: "De-escalation from Track 4 is permitted only when no escalation condition currently applies, and only by admins."
Why it matters: A reviewer can move a HIPAA-escalated tool from Track 4 to Track 1 with a one-line reason. The categorical guarantee of escalation conditions ("percentage-based scoring cannot outweigh certain institutional risks") is soft in code even though the docs present it as hard.
Fix: In the override handler, reject newTrack < 4 when tools.escalation_conditions is non-empty unless req.user.role === "admin", matching the documented rule; test it.
Confidence: Confirmed
```

```
ID: FW-09
Title: HECVAT assessment runs on GLM-5 with an empty codebase, while docs claim Claude Code CLI with full filesystem access
Severity: Major
Location: backend/src/agents/documentation/runner.js:237-249; docs/framework/hecvat.md:33-46
Category: Framework concern — doc-code divergence / evidence quality
Evidence: runner.js:241 `const result = await runDirectPass(DIRECT_MODELS.pass5, hecvatFullPrompt, "", outputDir, ...)` — the codeBundle argument is the empty string. hecvat.md:41-44: "The HECVAT pass reads: The full codebase (via Claude Code CLI with filesystem access)."
Why it matters: hecvat.md claims ~57 of 87 questions are answerable "from code analysis... or repository inspection" (e.g. APPL-06 SAST configs, CHNG-03 config management, DATA-03 encryption at rest). The model answering them sees no code at all, only the three prior agent synthesis JSONs. Answers for repository-inspection questions are inferences presented as code-derived evidence in an official compliance artifact.
Fix: Pass the existing codebase bundle as the codeBundle argument (it is already built once per run in the orchestrator), or run HECVAT on Claude CLI as documented; otherwise rewrite hecvat.md to state the actual evidence basis.
Confidence: Confirmed
```

```
ID: FW-10
Title: Synthesis is an unchecked single point of failure: no fallback when Claude fails, no schema validation of its output, and pass reports truncated to 15K chars before arbitration
Severity: Major
Location: backend/src/orchestrator/direct-api.js:153-222
Category: Framework concern — pipeline reliability / unvalidated arbiter
Evidence: Line 211 `const synthesisResult = await runCLIWithRetry("claude", fullSynthesisPrompt, ...)` has no try/catch, so a synthesis failure fails the agent and the run even with 5/5 passes complete. Line 215 `let synthesized = extractJSON(synthesisResult.output);` is the only validation before the result is persisted and (Track 1) auto-activates the tool. Lines 156-175: `const MAX_PASS_CHARS = 15000; ... content = content.slice(0, MAX_PASS_CHARS)`.
Why it matters: The arbiter that resolves all disputes and assigns all confidence tiers is itself unreviewed: malformed or wrong synthesis flows straight into reports and Track 1 activation. Convergence counting over reports amputated mid-JSON miscounts agreement precisely on the verbose (finding-heavy) runs where accuracy matters most.
Fix: Wrap synthesis in try/catch and fall back to a deterministic merge (union findings with reportedBy counts) marked "synthesis_failed"; validate synthesis output against the agent's schema.js before persisting; summarize per-pass findings instead of hard character slicing.
Confidence: Confirmed
```

```
ID: FW-11
Title: Bundle truncation silently degrades 4 of 5 passes; excluded-file findings can never reach the confirmed tier and no coverage flag reaches the report
Severity: Major
Location: backend/src/agents/shared/codebase-bundle.js:4,210-259; backend/src/orchestrator/direct-api.js:311-321; backend/src/agents/code-analysis/lenses.js:93,272
Category: Framework concern — coverage integrity vs "every file reviewed" claim
Evidence: codebase-bundle.js:4 `const DEFAULT_MAX_CHARS = 400_000;` with excluded files listed but omitted (lines 240-258). Orchestrator writes _bundle_manifest.json with `truncated` (lines 316-319) but nothing downstream reads it; no partial/coverage marker is set on synthesis or the run. lenses.js:272 instructs every model "You MUST read every single file. Do not skip files."
Why it matters: On any codebase over 400K chars, findings in excluded files are visible only to pass 1 (Codex), so the 3-of-5 convergence rule caps them at "potential" forever; the report presents full-coverage confidence tiers computed over partial coverage, and reviewers have no signal that this happened.
Fix: When bundle.truncated, set partial_analysis and a coverage percentage on the synthesis metadata and surface it in Report.jsx; longer term, shard excluded files across passes 2-5 so every file is seen by at least two models.
Confidence: Confirmed
```

```
ID: FW-12
Title: Intake form escalation warnings assert rules that do not exist or misstate real ones
Severity: Minor
Location: frontend/src/components/IntakeForm.jsx:463-464,512; backend/src/scoring.js:63-74
Category: Framework concern — UI/policy divergence
Evidence: IntakeForm.jsx:464 shows on q5 `"Public-facing + non-public data = Track 4"`; checkEscalations has no such condition (public-noauth + internal data does not escalate). IntakeForm.jsx:512 shows on q15 `"No version control — blocks approval at Track 2+"`; the actual behavior is an unconditional Track 4 escalation (scoring.js:71).
Why it matters: The live-warning system exists so builders understand routing before submission (escalation-conditions.md:150-157). Here it teaches them two wrong rules: one threat that will not happen and one consequence far milder than the real one.
Fix: Make the q5 warning conditional on the real FERPA rule (ferpa selected AND public deployment) and reword q15 to "No version control = automatic Track 4."
Confidence: Confirmed
```

```
ID: FW-13
Title: Track thresholds 22/42/65 have no stated rationale and no calibration path
Severity: Minor
Location: backend/src/scoring.js:89-95; docs/framework/track-routing.md:30-52,229-231; docs/institutional-adoption/porting.md:184
Category: Framework concern — unsupported policy constants
Evidence: scoring.js:89-95 contains the three constants with no comment. track-routing.md:231 requires that boundary changes "be validated against the historical distribution of submitted tools" but no distribution, dataset, or tooling exists anywhere in the repo or docs.
Why it matters: These numbers decide who gets human review. Adopting institutions are told to ratify them (porting.md:184) with no evidence they produce a sane tier distribution; the change-control doc demands calibration data the project has never produced.
Fix: Label the thresholds provisional in track-routing.md; add an admin analytics query showing the weighted-percentage distribution of real submissions per track so calibration is possible after the pilot.
Confidence: Confirmed
```

```
ID: FW-14
Title: Analytics cannot answer median time-to-decision per track; review latency and reviewer capacity are invisible
Severity: Minor
Location: backend/src/routes/analytics.js:1-271; backend/src/routes/review.js:38-41
Category: Framework concern — missing operational metric
Evidence: analytics.js queries only pipeline_runs, pass_results, and pipeline_metrics; no query in analytics.js or admin.js references tools.review_decided_at, which review.js:38-41 populates on every decision.
Why it matters: The framework's failure mode in practice is not misrouting but queueing: Tracks 3-4 that route correctly and then wait weeks. The portal cannot report decision latency per track, queue aging, or per-reviewer throughput, so nobody will see the backlog forming.
Fix: Add GET /analytics/review: median/p90 of (review_decided_at - pipeline completed_at) grouped by track, plus current under_review counts and ages. All source columns already exist.
Confidence: Confirmed
```

```
ID: FW-15
Title: Documentation contradicts itself and the code on partial-results quorum, HECVAT counts and categories, resubmission versioning, and the escalations column
Severity: Minor
Location: README.md:181; backend/src/orchestrator/direct-api.js:151; docs/institutional-adoption/compliance-mapping.md:164-172; docs/framework/hecvat.md:50-95,136; docs/framework/escalation-conditions.md:144; backend/migrations/001_init.sql:31
Category: Framework concern — doc-code and doc-doc divergences
Evidence: README:181 "if 4/5 passes succeed, pipeline continues" vs direct-api.js:151 `if (passCount === 0) throw` (floor is 1). compliance-mapping.md says "~35 answerable / ~21 N/A / ~31 human" and lists area codes BCPL, DBAS, DRPL, FIPS, HECV, PHYS, QUAL, SYST; hecvat.md says 57 answerable / 30 human and lists a different area table (DOCU, ITAC, ... AILM). escalation-conditions.md:144 claims "a new version of the record is created" on resubmission and names the field `tools.escalations`; no versioning exists and the column is `escalation_conditions` (001_init.sql:31).
Why it matters: These are the documents compliance officers and adopting institutions are told to rely on. Each contradiction is small; together they erode exactly the trust a governance product sells, and the 4/5-vs-1/5 quorum difference materially misstates the confidence floor behind Track 1 auto-activation.
Fix: Reconcile compliance-mapping.md's HECVAT section with hecvat.md; state the real 1-pass floor (or implement a real quorum); delete the versioning claim or implement versioning; correct the column name.
Confidence: Confirmed
```

---

## Ranked Improvements

Ordered by risk reduction per unit effort. Effort: S (<1 day), M (days), L (weeks).

1. **Remove or role-gate the `track` parameter on pipeline runs** (S) — closes FW-01, the direct governance bypass. One schema change plus one test.
2. **Enforce the six phantom-required questions and add a backend intake Zod schema** (S) — closes FW-03; escalations stop being skippable by omission.
3. **Fix the comprehension/q19 conditional** (S) — always ask q19, or zero-weight comprehension when unasked. Closes FW-04 and de-inflates every non-AI tool's score.
4. **Intake-vs-code contradiction check** (M) — post-synthesis diff of Agent 1 escalationSignals/dataOperations/authentication against q6/q10/q21; contradictions block auto-activation and page reviewers. Closes FW-02 and is the feature that makes AIF citable: no comparable framework verifies self-reports against the artifact.
5. **Gate Track 1 auto-activation on zero confirmed critical findings and no truncated/partial analysis** (S) — currently `queue.js:325` activates unconditionally; also satisfies track-routing.md's unimplemented "builder acknowledges findings."
6. **Rebalance weight profiles with an ordering invariant test** (M) — closes FW-05; add a test asserting the ai-agent profile never yields a lower percentage than internal-app/other for identical scores.
7. **Track 2 attestation payload** (S/M) — required body with findings-reviewed confirmation and attestation text; closes FW-07.
8. **Enforce documented track-override rules** (S) — admin-only de-escalation from Track 4, blocked while escalations apply; closes FW-08.
9. **Feed the codebase bundle to the HECVAT pass** (S) — the bundle is already built once per run; pass it instead of `""`. Closes FW-09.
10. **Synthesis fallback + schema validation of synthesis output** (M) — deterministic merge on Claude failure, schema.js validation before persist; closes FW-10.
11. **Coverage honesty for truncated bundles** (S for the flag, L for sharding excluded files across passes) — closes FW-11.
12. **Split the FERPA escalation** (S) — public-noauth stays Track 4; public-auth+SSO floors at Track 3. Closes FW-06 and restores proportionality for the largest real tool class.
13. **Re-scoring on resubmission and drift control** (M/L) — allow intake edits in changes_requested with authoritative recompute and record versioning (as escalation-conditions.md already promises); add annual re-attestation for active Track 1-2 tools.
14. **Time-to-decision analytics** (S) — closes FW-14; the columns already exist.
15. **Differentiated lenses experiment** (L) — replace 4 identical API passes with 3 lens-specialized passes; compare confirmed-finding yield and cost against the current roster on pilot data before switching. Also fix the prompts that falsely tell API models they have filesystem access (`qa-analysis/prompts.js:91`, `lenses.js:93`).
16. **Threshold calibration + publication** (S docs, M data) — provisional label now, distribution dashboard after pilot; closes FW-13 and is the second thing that makes the framework citable.
17. **Structured q20 + new escalators** (M) — convert q20 from free text to a decision-scope enum (none / recommends / acts-with-override / autonomous) feeding autonomy directly; add payment-data and autonomous-consequential-decision escalations.
18. **Real cost from token usage** (S) — usage is already captured per response in direct-api.js; multiply by per-model rates instead of flat constants.
19. **Templatize institution references in agent prompts** (S) — replace "UM CAS, Banner" and "the UM framework" in lenses.js with config-driven strings; add to customization.md's hardcoded-values table.
20. **Map dimensions to NIST AI RMF subcategories in the intake UI** (S) — compliance-mapping.md already has the mapping; surfacing it per-question is cheap grant-credibility.

---

## What Is Well-Designed

- **The escalation architecture.** Categorical overrides evaluated after scoring, reported with provenance even when the percentage alone would route Track 4, surfaced live to builders per-question before submission. This is the right shape; the defects are in individual predicates, not the mechanism.
- **Scoring implementation discipline.** `scoring.js` matches its spec document line for line; `scoring.test.js` pins every boundary (0.2199/0.22, 0.4199/0.42, 0.6499/0.65), enforces frontend/backend weight parity, and covers the escalation matrix exhaustively including negative cases. Backend recompute as the single source of truth, with the frontend explicitly labeled preview-only, is exactly right.
- **The synthesis prompt design.** Factual-vs-judgment dispute taxonomy, mandatory file-existence verification with hallucination dropping ("a confirmed hallucination is worse than a missed finding"), and the DPA severity cap that prevents models from asserting contractual facts they cannot know (`lenses.js:114,351-357`). That last rule shows unusual epistemic care for an LLM pipeline.
- **Failure containment in the pass layer.** Promise.allSettled per pass, 3-tier response_format fallback, per-pass metrics with error categorization, AbortController propagation for cancel, dead-letter queue, and startup recovery of orphaned runs. The plumbing is production-grade.
- **Cost visibility.** Per-run estimated cost, per-model timing percentiles, and trend series exist and are admin-visible. Most governance tools cannot state their own cost per review; this one can.
- **Honest portability docs.** porting.md and customization.md accurately classify what is env-configurable, what is a source edit, and what is stubbed, including a self-maintained "known hardcoded values" table. The gap between claim and code is smaller and better documented than typical.
- **Deterministic bundling.** Alphabetical ordering, manifest-first prioritization, explicit excluded-file listing, and a written bundle manifest per run make pass inputs reproducible and auditable, which is the precondition for ever debugging convergence.
