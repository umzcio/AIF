# HECVAT 4.15 Integration

The AIF pipeline produces a pre-populated HECVAT 4 Lite self-assessment for every submitted tool as part of Agent 4 (Documentation). This document specifies what HECVAT is, which questions the automated pipeline answers, which require human input, and how the XLSX export against the official EDUCAUSE template works.

## Summary

- HECVAT is the Higher Education Community Vendor Assessment Toolkit from EDUCAUSE
- Version 4.15 is the current reference template; AIF tracks it exactly
- The "Lite" profile covers the 87 critical-importance questions (asterisked in the full questionnaire)
- Agent 4 answers approximately 65% of the 87 from code plus agent reports; the balance requires human input
- The output is produced as both JSON (`hecvat_assessment.json`) and an XLSX filled against the official EDUCAUSE template

## What HECVAT Is

HECVAT is a standardized security and privacy questionnaire maintained by EDUCAUSE, Internet2, and REN-ISAC. Higher education institutions use it to evaluate third-party tools and services. The official template (`hecvat415.xlsx`) lives in `/projects/AIF/hecvat415.xlsx` and is sourced from:

> https://www.educause.edu/-/media/files/educause/hecvat/hecvat415.xlsx

AIF applies HECVAT to itself and to tools reviewed by the portal. Because the portal is a _self-assessment_ context (the institution is building the tool, not buying it), the agent answers _about the tool under review_, not on behalf of a vendor.

Three HECVAT profiles exist:

| Profile | Scope | Use |
|---------|-------|-----|
| HECVAT Full | All questions (~400+) | Enterprise vendor review |
| HECVAT Lite | Critical-importance subset (87 questions) | Mid-tier or internal review |
| HECVAT On-Premise | Subset focused on on-prem deployment | On-prem vendor review |

AIF uses HECVAT Lite. The 87 critical questions are defined in `backend/src/agents/documentation/critical_questions.txt` and reflected in the HECVAT prompt at `backend/src/agents/documentation/hecvat-prompt.js`.

## Pipeline Integration

Agent 4 (Documentation) runs three passes in parallel, not sequentially. Gemini generates the USER_GUIDE and ADMIN_GUIDE; Claude Code CLI generates the COMPLIANCE_SUMMARY; GLM-5 completes the HECVAT self-assessment via a direct OpenRouter API call. HECVAT is not a Claude call.

```
Agent 4 (Documentation) — 3 parallel passes
  ├── Gemini            → USER_GUIDE.md, ADMIN_GUIDE.md (.docx via pandoc)
  ├── Claude Code CLI    → COMPLIANCE_SUMMARY.md (.docx via pandoc)
  └── GLM-5 (direct API) → HECVAT Self-Assessment → hecvat_assessment.json + hecvat_assessment.xlsx
```

The HECVAT pass reads:

- The bundled codebase — the same deterministic bundle passes 2-5 receive, subject to the 400K-character budget (the HECVAT pass runs on GLM-5 via direct API, not Claude CLI).
- Agent 1 (Code & Security) synthesis report.
- Agent 2 (Accessibility) synthesis report.
- Agent 3 (QA / Bug Detection) synthesis report.

## Question Categories

The 87 critical questions are organized into 24 assessment areas. The table below lists each area, the count of critical questions, and the typical automation posture (Automatable = answerable from code or agent reports; Mixed = partially; Human = requires human input):

| Area Code | Area | # Qs | Automation |
|-----------|------|-----:|------------|
| DOCU | Documentation (BCP/DRP) | 2 | Human |
| ITAC | IT Accessibility | 4 | Mixed |
| THRD | Third Party Assessment | 4 | Mixed |
| CONS | Consulting | 4 | Human |
| APPL | Application / Service Security | 7 | Automatable |
| AAAI | Authentication, Authorization, Accounting | 10 | Automatable |
| CHNG | Change Management | 3 | Mixed |
| DATA | Data | 8 | Automatable |
| DCTR | Datacenter | 2 | Human |
| FIDP | Firewall / IDS / IPS / Networking | 5 | Human |
| PPPR | Policies, Procedures, Processes | 3 | Mixed |
| VULN | Vulnerability Scanning | 3 | Mixed |
| HIPA | HIPAA | 4 | Human |
| PCID | PCI DSS | 3 | Human |
| PCOM | Privacy Company | 1 | Human |
| PTHP | Privacy Third Party | 1 | Human |
| PDAT | Privacy Data | 3 | Automatable |
| PRPO | Privacy Policies | 2 | Human |
| DPAI | Data Protection AI | 2 | Automatable |
| AIGN | AI Governance | 3 | Mixed |
| AIPL | AI Policies | 4 | Mixed |
| AISC | AI Security | 3 | Mixed |
| AIML | AI/ML | 2 | Mixed |
| AILM | AI LLM | 4 | Automatable |

## Status Values

For each question, Agent 4 assigns one of five status values:

| Status | Meaning | XLSX Cell Value |
|--------|---------|-----------------|
| `yes` | Requirement is met, with evidence | `Yes` |
| `no` | Requirement is NOT met, with evidence | `No` |
| `partial` | Partially met; gap explained in detail | `Partial` |
| `not_applicable` | Doesn't apply (e.g. HIPAA on a non-health tool) | `N/A` |
| `requires_human_input` | Cannot be determined from code | (blank — for human completion) |

The mapping is implemented in `backend/src/agents/documentation/xlsx-export.js` in `statusToAnswer()`.

## What the Agent Answers from Code

Approximately 57 of the 87 questions (≈65%) can be answered directly from code analysis, agent reports, or repository inspection. Representative examples:

### Answerable from Agent 1 (Code & Security) Synthesis

| Question | How |
|----------|-----|
| AAAI-01 (SSO support) | Agent 1 authentication findings |
| AAAI-07 (hardcoded passwords) | Agent 1 `hardcodedCredentials`, secrets findings |
| AAAI-08 (plaintext password storage) | Code scan for bcrypt/argon2 vs plaintext |
| DATA-02 (TLS in transit) | Agent 1 external services transport security |
| APPL-01 (RBAC/ABAC) | Role and permission check inspection |
| APPL-03 (currently supported software) | Agent 1 inventory (packages, versions, Docker base images) |
| THRD-02 (contractual language with third parties) | Agent 1 external services — identifies who receives data, flags contracts as required |
| DPAI-02 (data retention in AI processing) | Agent 1 AI usage (caching, training opt-out) |
| AILM-01 (limited LLM privileges) | Agent 1 agent security (agentic patterns, guardrails) |
| AILM-03 (human-in-the-loop on LLM actions) | Agent 1 agent security (approval workflows) |

### Answerable from Agent 2 (Accessibility) Synthesis

| Question | How |
|----------|-----|
| ITAC-08 (WCAG 2.2 AA substantial conformance) | Agent 2 scorecard — principle-level pass/fail counts |
| ITAC-09 (accessibility issue tracking process) | Issue-tracker configuration, feedback endpoints in code |

### Answerable from Repository Inspection

| Question | How |
|----------|-----|
| APPL-06 (SAST prior to release) | CI/CD config files, linting configs, SAST tool integrations |
| APPL-07 (software testing process) | Test directories, test configs, CI pipelines |
| CHNG-03 (configuration management) | Dockerfiles, IaC manifests, config inventories |
| VULN-01 (vulnerability scanning) | Snyk, Trivy, npm audit in CI |
| DATA-01 (publicly routable storage) | Docker networking, subnet configuration |
| DATA-03 (encryption at rest) | Database encryption configuration, encrypted volumes |
| AILM-04 (limit multi-plugin chaining) | Plugin/tool allowlist inspection |
| PDAT-01 (demographic data collection) | Schema inspection for demographic fields |
| PDAT-02 (biometric/genetic data) | Code scan for biometric APIs |
| AIPL-03 (AI kill switch) | Feature flag inspection |

## What Requires Human Input

Approximately 30 of the 87 questions (≈35%) are organizational, contractual, or procedural in nature and cannot be answered from code. Representative examples:

| Question | Why It Requires Human Input |
|----------|----------------------------|
| DOCU-01 (annually tested BCP) | Organizational policy and ownership |
| DOCU-02 (annually tested DRP) | Organizational policy and ownership |
| CONS-01–04 (consulting arrangements) | Contract-dependent |
| THRD-01 (third-party assessments) | Procurement and vendor management |
| THRD-03 (breach liability in contracts) | Legal review |
| AAAI-06 (eduGAIN federation participation) | Institutional identity office |
| AAAI-11 (log retention policy documentation) | Records management |
| CHNG-01 (institutional change notification) | Procurement and vendor management |
| DCTR-06, DCTR-10 (physical datacenter controls) | Facilities and operations |
| FIDP-01–05 (firewall, IDS, IPS policies) | Network security team |
| HIPA-01–04 (HIPAA workforce and BAAs) | Compliance office |
| PCID-01–03 (PCI DSS attestation) | Compliance office (N/A where no payments) |
| PCOM-01 (personal data breach history) | Privacy officer |
| PTHP-01 (third-party contractual compliance) | Legal review |
| PRPO-06 (privacy awareness training) | HR or compliance office |
| PRPO-12 (data sharing with law enforcement) | General counsel |
| AIGN-03 (responsible AI training completion) | Professional development records |

The output JSON lists each such question with `status: "requires_human_input"` and a null evidence field. The XLSX export leaves the Answer column blank for these rows so the human reviewer knows exactly what to complete.

## Output Schema

The JSON output is a single object written to `hecvat_assessment.json` in the run output directory:

```json
{
  "toolName": "Tool name",
  "assessmentType": "HECVAT 4 Lite (Critical Importance Questions)",
  "hecvatVersion": "4.15",
  "assessmentDate": "2026-04-16T00:00:00Z",
  "assessor": "AIF Agent 4 (automated pre-population)",
  "questions": [
    {
      "id": "AAAI-01",
      "status": "yes",
      "answer": "SSO is implemented via CAS against login.umt.edu.",
      "evidence": "backend/src/routes/auth.js:42"
    }
  ],
  "scoring": {
    "totalQuestions": 87,
    "answeredFromCode": 57,
    "requiresHumanInput": 30,
    "readiness": {
      "yes": 45,
      "no": 3,
      "partial": 6,
      "not_applicable": 3,
      "percentage": 82.8
    }
  },
  "nonNegotiableFailures": [
    {
      "id": "AAAI-07",
      "question": "Are there any passwords hard-coded into your systems or solutions?",
      "status": "no",
      "detail": "Hardcoded API key found in config.js:17",
      "remediation": "Rotate the key and migrate to environment variables."
    }
  ],
  "highRiskFindings": [
    {
      "id": "ITAC-08",
      "area": "IT Accessibility",
      "finding": "Agent 2 reports partial WCAG 2.2 AA conformance (Perceivable and Operable pass; Understandable and Robust partial)",
      "severity": "medium",
      "remediation": "Address the 12 open findings in Agent 2 report."
    }
  ],
  "summary": "Executive summary of HECVAT readiness, key gaps, and recommended next steps."
}
```

## Readiness Scoring

Within the assessment output, the `scoring.readiness.percentage` field measures readiness against answerable questions:

```
readiness% = (yes + not_applicable) / (total - requires_human_input) × 100
```

This excludes `requires_human_input` from the denominator so the score reflects the posture of what can be assessed automatically. A low readiness score signals many `no` and `partial` answers that require remediation before the tool can move through Track 3 or Track 4 review.

## Non-Negotiable Failures

Certain questions are flagged as non-negotiable. A `no` or `partial` on any of these is surfaced separately in the `nonNegotiableFailures` array:

| Question | Non-Negotiable Because |
|----------|------------------------|
| AAAI-01 (SSO) | Campus identity integration is mandatory |
| AAAI-07 (hardcoded passwords) | A secret in code is an active breach |
| DATA-02 (TLS in transit) | Unencrypted transport of institutional data is unacceptable |
| ITAC-08 (WCAG 2.2 AA) | Federal regulation requires conformance for public-facing tools |

These failures block approval at Track 3 and Track 4 regardless of readiness percentage.

## High-Risk Findings

`highRiskFindings` aggregates every `no` and `partial` across the 87 questions, categorized by severity (`critical`, `high`, `medium`). Critical severity typically maps to non-negotiable failures; high and medium capture remediable gaps. Each finding carries a remediation string suggested by the agent for reviewer consideration.

## XLSX Export

Once the JSON assessment is produced, `exportHecvatXlsx(assessment, outputPath, templatePath)` (in `backend/src/agents/documentation/xlsx-export.js`) produces a filled-in copy of the official EDUCAUSE template. The export:

1. Reads the template from `HECVAT_TEMPLATE_PATH` env var, defaulting to `/projects/AIF/hecvat415.xlsx`.
2. Scans columns for each question ID on the three relevant sheets:
   - **Institution Evaluation** — the primary sheet with most questions.
   - **Privacy** — contains PCOM, PTHP, PDAT, PRPO, DPAI questions.
   - **Privacy Analyst Evaluation** — privacy analyst-facing duplicate for cross-reference.
3. Writes the mapped status value to column C (Answer) and the detailed explanation to column D (Additional Information).
4. Leaves `requires_human_input` rows blank in the Answer column so the human knows exactly what to complete.
5. Logs the count of questions filled and any IDs not matched in the template (for diagnostic purposes when EDUCAUSE updates the template).

The output is a single XLSX file, byte-identical in structure to the EDUCAUSE template except for the populated Answer and Additional Information columns. A CISO or security reviewer can open the file in Excel and see a familiar HECVAT with the automated answers pre-filled.

## Template Management

The template file is authoritative. When EDUCAUSE publishes a new HECVAT version:

1. Download the new template from the EDUCAUSE URL to `/projects/AIF/hecvat415.xlsx` (or updated filename).
2. Compare the question set against `backend/src/agents/documentation/critical_questions.txt`.
3. Update `hecvat-prompt.js` to reflect added/removed/renamed questions.
4. Run the pipeline against a known test tool and verify the XLSX export correctly maps IDs to rows on all three sheets.
5. Update `hecvatVersion` in the output schema and the version string in this document.

The `buildIdRowMap(sheet)` function in `xlsx-export.js` scans column A for patterns matching `/^[A-Z]{2,4}-\d+$/`, so new question IDs following that convention will be auto-detected. IDs not matching that pattern require explicit handling.

## Output Location

In a pipeline run, HECVAT outputs are written to:

```
<run_dir>/agent4_documentation/
  ├── USER_GUIDE.md (.docx)
  ├── ADMIN_GUIDE.md (.docx)
  ├── COMPLIANCE_SUMMARY.md (.docx)
  ├── hecvat_assessment.json
  └── hecvat_assessment.xlsx
```

All six files are made available via the report download endpoints.

## Reviewer Workflow

At Track 3 and Track 4, reviewers are expected to:

1. Open `hecvat_assessment.xlsx`.
2. Complete every row marked blank (requires_human_input).
3. Override agent-provided answers where institutional knowledge supersedes the code analysis.
4. Address `nonNegotiableFailures` with remediation commitments before approval.
5. File the completed XLSX with the tool's governance record.

The filled template is the official HECVAT record for the tool and may be required for external audits, accreditation reviews, or vendor-like review of tools built for shared use.

## Cross-References

- Agent 4 implementation: `backend/src/agents/documentation/`
- HECVAT prompt (question catalog and rubric): `backend/src/agents/documentation/hecvat-prompt.js`
- XLSX export logic: `backend/src/agents/documentation/xlsx-export.js`
- Full critical question list with EDUCAUSE annotations: `backend/src/agents/documentation/critical_questions.txt`
- Scoring model (feeds HECVAT answerability): `scoring-model.md`
- Track routing (determines reviewer workflow): `track-routing.md`
- Escalation conditions (often correspond to non-negotiable failures): `escalation-conditions.md`
- Pipeline and agent architecture: `../architecture/`

## Change Control

Because HECVAT is a standardized industry questionnaire, local modification of questions is not permitted — the question set must remain faithful to the EDUCAUSE template. Local modifications are confined to:

- The rubric the agent uses to answer (CHECK and CITE directives in `hecvat-prompt.js`).
- The mapping between AIF agent reports and HECVAT question evidence.
- The XLSX column mappings if EDUCAUSE restructures the template.

Any change to the question set itself must wait on an EDUCAUSE template release and must be accompanied by a version bump in the output schema.
