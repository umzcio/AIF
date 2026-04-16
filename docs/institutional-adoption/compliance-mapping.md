# Compliance Framework Mapping

## Summary

AIF implements technical and procedural controls that align with six widely adopted compliance and risk-management frameworks: the NIST AI Risk Management Framework, the NIST Cybersecurity Framework version 2.0, the Web Content Accessibility Guidelines version 2.2 at Level AA, the EDUCAUSE Higher Education Community Vendor Assessment Toolkit version 4.15, the OWASP Top 10, and the data-handling obligations imposed by HIPAA and FERPA. The portal does not claim certification under any of these frameworks — certification is an institutional activity — but it produces evidence artifacts (scored intake records, convergent agent findings, audit logs, pre-filled HECVAT workbooks) that accelerate certification and ongoing compliance review. This document maps AIF's implemented controls to each framework's canonical functions or principles and is intended for compliance officers, information-security officers, and audit staff evaluating AIF as a governance instrument.

## Mapping at a glance

| Framework | AIF coverage | Primary artifacts |
|-----------|--------------|-------------------|
| NIST AI RMF | GOVERN, MAP, MEASURE, MANAGE | Registry, intake form, pipeline findings, review workflow |
| NIST CSF 2.0 | IDENTIFY, PROTECT, DETECT, RESPOND | Registry, RBAC, Semgrep/Snyk scans, audit log |
| WCAG 2.2 Level AA | Portal itself conforms; Agent 2 audits submitted tools | `jsx-a11y` ESLint, Agent 2 multi-model audit |
| HECVAT 4.15 | ~65 % of 87 critical questions pre-filled from code analysis | XLSX export matching the official EDUCAUSE template |
| OWASP Top 10 | Agent 1 + Semgrep OWASP ruleset | Code & Security agent findings |
| HIPAA / FERPA | Escalation conditions force Track 4 | Intake scoring + escalation detection |

## NIST AI Risk Management Framework

The NIST AI RMF organizes AI governance into four functions: GOVERN, MAP, MEASURE, and MANAGE. AIF implements activities in each function.

### GOVERN

| RMF subcategory | AIF implementation |
|----------------|--------------------|
| GOVERN 1.1 — Policies, processes, procedures | The framework document, intake process, and scoring rubric are the institutional policy; the portal enforces them at intake time. |
| GOVERN 1.2 — Characteristics of trustworthy AI | The seven scoring dimensions operationalize trustworthy-AI attributes (security, accessibility, autonomy, comprehension). |
| GOVERN 1.4 — Risk management process | Track 1–4 routing encodes a documented, repeatable risk-triage process. |
| GOVERN 2.1 — Roles and responsibilities | Three-role RBAC (builder, reviewer, admin) with middleware enforcement in `backend/src/auth/middleware.js`. |
| GOVERN 3.1 — Diverse perspectives | Five independent models analyze every submission; divergent findings surface automatically during synthesis. |
| GOVERN 4.3 — Accountable oversight | Every status change, review decision, track override, and administrative action is written to `audit_log` with actor identity, timestamp, and source IP. |
| GOVERN 5.1 — Third-party resources | HECVAT 4.15 output documents vendor and third-party dependencies. |
| GOVERN 6.1 — Continuous improvement | The `/analytics/*` admin endpoints track pipeline cost, per-model performance, and trends over time. |

### MAP

| RMF subcategory | AIF implementation |
|----------------|--------------------|
| MAP 1.1 — Context and intended use | Intake questions 1–4 capture artifact type, users, and scope. |
| MAP 2.1 — AI system categorization | Six artifact types (`public-site`, `internal-app`, `script-api`, `ai-agent`, `data-pipeline`, `other`) each carry a distinct weight profile. |
| MAP 2.2 — Components and dependencies | Agent 1 inventory section enumerates languages, frameworks, entry points, and every dependency from the package manifest. |
| MAP 3.1 — Benefits and risks | The intake form captures both intended benefit (question 2) and risk signals (questions 5–21). |
| MAP 4.1 — Third-party considerations | Agent 1 external-services section identifies institutional vs. third-party destinations and flags for reviewer verification. |
| MAP 5.1 — Impacts on individuals | Dimensions Blast Radius and Data Sensitivity capture population and data scope; escalation conditions protect regulated classes (FERPA, HIPAA, IRB). |

### MEASURE

| RMF subcategory | AIF implementation |
|----------------|--------------------|
| MEASURE 1.1 — Test, evaluation, verification | The four-agent pipeline performs static analysis, accessibility audit, QA/bug detection, and documentation generation on every submission. |
| MEASURE 2.1 — Test set representativeness | Agent 1 section 10 reviews test coverage against code inventory; Agent 3 identifies test-coverage gaps. |
| MEASURE 2.7 — Security and resilience | Semgrep OWASP Top 10 rules, `npm audit` / `pip-audit` dependency CVEs, secrets detection, authentication-pattern analysis. |
| MEASURE 2.8 — Transparency and accountability | Confidence tiers (`tool-verified`, `confirmed`, `potential`) label every finding. |
| MEASURE 2.9 — Explainability and interpretability | Agent 4 generates User Guide, Admin Guide, and Compliance Summary so non-builders can understand tool behavior. |
| MEASURE 2.10 — Privacy risk | Data-operations section traces every read/write/transmit and classifies by sensitivity (public, internal, PII, FERPA, HIPAA, financial, research). |
| MEASURE 2.11 — Fairness and bias | Flagged as a gap — AIF does not currently run targeted bias evaluation; a reviewer checklist item is the current mitigation. |
| MEASURE 3.1 — Monitoring | `/analytics/trends` provides time-series metrics on run duration, success rate, parse failures, and cost. |
| MEASURE 4.1 — Feedback | Review comment threads, review decisions, track overrides. |

### MANAGE

| RMF subcategory | AIF implementation |
|----------------|--------------------|
| MANAGE 1.1 — Prioritization | Weighted-percentage track routing prioritizes reviewer attention on higher-risk submissions. |
| MANAGE 1.2 — Risk response | Track 1 auto-activates; Track 2 allows builder self-certification; Tracks 3–4 require reviewer approval. |
| MANAGE 1.3 — Response types | Approve, request changes, escalate, de-escalate, suspend, retire — all with documented reason and audit trail. |
| MANAGE 2.1 — Resource allocation | Per-run cost telemetry in `MODEL_COST_USD` and analytics dashboard informs pipeline budget. |
| MANAGE 3.1 — Communications | In-app and email notifications on pipeline completion, review-needed events, and status changes. |
| MANAGE 4.1 — Post-deployment monitoring | Registry status state machine supports `suspended` and `retired` states for live-tool incidents. |

## NIST Cybersecurity Framework 2.0

### IDENTIFY

| CSF category | AIF implementation |
|--------------|--------------------|
| ID.AM-1 — Asset inventory (physical and virtual) | The Registry is the canonical inventory of AI-built tools. |
| ID.AM-2 — Software platforms and applications | Registry entries include artifact type, owner, track, status. |
| ID.AM-3 — External information systems | Agent 1 external-services section enumerates third-party dependencies. |
| ID.AM-5 — Prioritization based on classification and criticality | Seven-dimension scoring and track routing implement criticality-based prioritization. |
| ID.RA-1 — Asset vulnerabilities identified | Agent 1 secrets detection, OWASP Top 10 findings, dependency CVEs. |
| ID.RA-5 — Threats, vulnerabilities, likelihoods, and impacts used to determine risk | Dimension scores feed weighted-percentage risk calculation. |
| ID.GV-1 — Organizational cybersecurity policy | Framework document codifies policy; intake form encodes it. |

### PROTECT

| CSF category | AIF implementation |
|--------------|--------------------|
| PR.AA-1 — Identities and credentials managed | Pluggable SSO providers (CAS, OIDC, SAML, header). |
| PR.AA-3 — Users authenticated | JWT cookies with institutional SSO; bypass provider blocked in production. |
| PR.AA-5 — Access permissions and authorizations | RBAC middleware: `requireRole`, `requireOwnerOrRole`. |
| PR.DS-1 — Data-at-rest protected | PostgreSQL encryption is an infrastructure-layer responsibility; AIF writes no sensitive data plaintext to the filesystem. |
| PR.DS-2 — Data-in-transit protected | HTTPS enforcement in `validateUrl` for git clones; JWT cookies marked `Secure` and `HttpOnly`; Helmet HSTS header. |
| PR.PS-1 — Secure configuration | Helmet CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy; CSRF double-submit cookie; 1 MB body limit; 30/15-minute auth rate limit, 120/minute API rate limit. |
| PR.PS-2 — Software is managed | Container is non-root, log rotation, resource limits. |
| PR.PS-6 — Secure software development | Subprocess calls use `execFileSync` with array arguments (no shell); `filteredEnv` isolates API keys per CLI tool; path-traversal protection on archive extraction. |
| PR.IR-1 — Network integrity | Optional `GIT_ALLOWED_HOSTS` allowlist restricts `git clone` targets. |

### DETECT

| CSF category | AIF implementation |
|--------------|--------------------|
| DE.CM-1 — Networks monitored | Pipeline telemetry in `pass_results` and `pipeline_metrics`. |
| DE.CM-9 — External service provider activity monitored | Per-model success rate, parse-failure rate, and cost tracked in analytics. |
| DE.AE-2 — Detected events analyzed | Five-model convergence surfaces events that a single scanner would miss. |
| DE.AE-3 — Event data aggregated | Findings from Semgrep, ESLint, `npm audit`, Snyk, and five AI passes aggregated into a single report. |
| DE.AE-4 — Event impact determined | Severity labels (`critical`, `high`, `warning`, `info`) applied to every finding. |

### RESPOND

| CSF category | AIF implementation |
|--------------|--------------------|
| RS.MA-1 — Incident response plan executed | Reviewer workflow: approve, request changes, escalate. |
| RS.MA-3 — Incidents categorized | Status state machine: `under_review`, `changes_requested`, `suspended`. |
| RS.AN-3 — Forensics performed | Audit log preserves actor, timestamp, IP, and change detail for every action. |
| RS.CO-2 — Incidents reported | In-app and email notifications on status changes, review-needed events. |

### RECOVER

AIF's RECOVER coverage is limited by design — the portal is not a recovery system. The following controls support recovery activities:

- Audit log and `pass_results` retain historical state for post-incident reconstruction.
- Database migrations are versioned and idempotent; a restore-and-replay recovery pattern is supported.
- Retention policy (90-day pass results, 30-day notifications) ensures investigations can complete before data ages out.

Infrastructure-layer backup, restore, and disaster-recovery controls are the institution's responsibility.

## WCAG 2.2 Level AA

The portal itself and the tools it reviews are both in scope.

### Portal conformance

The portal is built to conform to WCAG 2.2 Level AA. Evidence:

| Control | Implementation |
|---------|----------------|
| 1.4.3 Contrast (Minimum) | Track and severity palettes in `frontend/src/constants.js` selected for 4.5 : 1 ratios; `--border-interactive` at 3.2 : 1 for form inputs. |
| 1.4.11 Non-text Contrast | 3 : 1 ratios on interactive boundaries verified during WCAG remediation pass. |
| 2.1.1 Keyboard | All interactive elements reachable via keyboard; `FileTreeNode`, `FindingCard` carry explicit key handlers. |
| 2.4.3 Focus Order | Focus-to-first-error on intake-form submit; modal focus trap in `Toast.jsx` confirmation dialogs. |
| 2.4.7 Focus Visible | Visible focus indicator applied via `:focus-visible` CSS selectors. |
| 3.3.1 Error Identification | Per-field validation with `aria-invalid` and inline error messages. |
| 3.3.2 Labels or Instructions | `<label>` elements throughout; `htmlFor`/`id` pairing on notification email input with `autocomplete="email"`. |
| 4.1.2 Name, Role, Value | ARIA roles (`radio`, `checkbox`, `switch`, `radiogroup`, `group`) applied to custom form components. |
| 4.1.3 Status Messages | `aria-live="polite"` on `SaveIndicator`, upload-progress surface, notification dropdown. |

### Submitted-tool audit

Agent 2 (Accessibility) audits every submitted codebase against all WCAG 2.2 Level A and AA success criteria. The audit combines deterministic and AI-based evaluation:

| Tool | Coverage |
|------|----------|
| `eslint-plugin-jsx-a11y` | 34 static rules: alt text, label association, ARIA misuse, keyboard semantics, roles. |
| Five-model AI audit | Every success criterion reviewed for pass / fail / warning / not-applicable with file-line evidence. |
| Claude synthesis | Dispute resolution across the five passes; Claude has filesystem access for verification. |

Output includes a WCAG checklist, ARIA audit, keyboard-access review, color-contrast review, semantic-structure review, forms review, images/media review, dynamic-content review, modal/dialog review, and responsive-design review.

## EDUCAUSE HECVAT 4.15

AIF generates a pre-populated HECVAT 4.15 Lite self-assessment workbook (`hecvat_assessment.json` and `hecvat_assessment.xlsx`) for every submitted tool. The 87 critical-importance questions from the official EDUCAUSE template are each evaluated against the codebase and prior agent findings.

| Disposition | Approximate count | Source |
|-------------|-------------------|--------|
| Answerable from code analysis | ~35 | Agent 4 HECVAT Claude pass reads Agent 1 and Agent 2 findings plus filesystem. |
| Not applicable (e.g., consulting-specific) | ~21 | Marked N/A with justification. |
| Requires human input (contractual, organizational) | ~31 | Marked `REQUIRES_HUMAN_INPUT` so reviewers know what remains. |

The XLSX export matches the official EDUCAUSE template column structure so the assessment can be submitted directly to the institution's HECVAT review workflow. Reviewers typically complete the remaining ~35 % in under an hour given the pre-filled context.

Question categories covered: Documentation (DOCU), IT Accessibility (ITAC), Third-Party Assessment (THRD), Consulting (CONS), Application / Service Security (APPS), Authentication, Authorization, and Accounting (AAAI), Business Continuity (BCPL), Change Management (CHNG), Data (DATA), Database Security (DBAS), Disaster Recovery (DRPL), Firewall / IDS / IPS (FIPS), HECVAT Profile (HECV), Physical Security (PHYS), Policies and Procedures (PPRO), Privacy (PRIV), Qualifications (QUAL), Systems Management (SYST), and Vulnerability Scanning (VULN).

## OWASP Top 10

The OWASP Top 10 (2021) is enforced by Agent 1 through Semgrep's OWASP ruleset and the multi-model Code & Security prompt.

| OWASP category | AIF detection |
|----------------|---------------|
| A01 Broken Access Control | Authentication-section analysis checks for auth bypass, role confusion, and missing authorization checks. |
| A02 Cryptographic Failures | Secrets scanning, hardcoded-credential detection, encryption-pattern review. |
| A03 Injection | Semgrep SQLi, XSS, command-injection, and SSRF rules; AI review of query construction. |
| A04 Insecure Design | Architectural review in Agent 1 section 2 (External Services) and section 3 (Data Operations). |
| A05 Security Misconfiguration | Configuration-file review in Agent 1 section 5 (Secrets) and section 4 (Authentication). |
| A06 Vulnerable and Outdated Components | `npm audit`, `pip-audit`, and dependency-manifest review in Agent 1 section 1 (Inventory). |
| A07 Identification and Authentication Failures | Authentication flow review; custom-auth detection triggers escalation. |
| A08 Software and Data Integrity Failures | Subprocess-safety review; path-traversal review; MCP/skill integrity check via Snyk. |
| A09 Security Logging and Monitoring Failures | Logging review in Agent 3 QA audit. |
| A10 Server-Side Request Forgery | Semgrep SSRF rules; external-services destination review. |

## HIPAA and FERPA

AIF does not handle protected health information or student educational records directly — it reviews tools that may. The framework prevents such tools from deploying without formal review by forcing Track 4 when regulated-data signals are present.

| Regulation | AIF handling |
|------------|--------------|
| HIPAA | Intake question 10 captures HIPAA data classification; any positive answer triggers Track 4 escalation. Data-operations section of Agent 1 classifies every data path. |
| FERPA | Intake question 10 captures FERPA data classification. FERPA + public-facing deployment (question 5) triggers a distinct escalation condition regardless of overall score. |
| Export-controlled / IRB / tribal data | Treated with the same Track 4 escalation as HIPAA. |
| Third-party data sharing | Intake question 12 captures DPA status; missing or unknown DPA triggers escalation. |

The Code & Security agent applies specific guidance (`lenses.js` Section 2) that data flows to major providers (OpenAI, Google, Anthropic, AWS, Microsoft, OpenRouter) are not assigned `critical` severity for DPA reasons alone — procurement status cannot be determined from code — but are flagged with `needs_verification=true` for reviewer follow-up. Only flows of regulated data to clearly inappropriate destinations (personal email, unknown domains, unencrypted HTTP) are escalated to `critical`.

## Evidence artifacts

Every submission produces a defined set of evidence artifacts that support external audit:

| Artifact | Format | Purpose |
|----------|--------|---------|
| Intake record | PostgreSQL row | Business case, scope, risk profile, scored dimensions |
| Pipeline findings | JSON + UI report | Multi-model convergent findings with confidence tier, severity, and file-line evidence |
| Compliance Summary | `.docx` | Human-readable compliance narrative |
| User Guide | `.docx` | Documentation of tool behavior |
| Admin Guide | `.docx` | Documentation of operational responsibilities |
| HECVAT 4.15 Lite | `.xlsx` + `.json` | EDUCAUSE-standard vendor/self-assessment |
| Audit log entries | PostgreSQL rows | Every status change, review decision, track override, admin action |
| Pipeline metrics | PostgreSQL rows | Duration, cost, pass success/failure, parse-error categorization |

All artifacts are exportable and all are retained per the institution's configured retention policy.

## Gaps and known limitations

These frameworks and controls are not covered by AIF and remain the institution's responsibility:

- Live-runtime monitoring of deployed tools (AIF evaluates pre-deployment; operational monitoring is separate)
- Fairness and bias evaluation of AI models beyond structural review
- Penetration testing (AIF performs static analysis only)
- Supply-chain attestation beyond dependency CVE scanning
- Recovery time objective and recovery point objective attestations
- SOC 2 Type II or ISO 27001 control mapping at the infrastructure layer

Institutions seeking coverage of these areas should integrate AIF with their existing programs rather than treat it as a complete substitute.

## Where to go next

- [porting.md](porting.md) — adoption procedure for a new institution
- [customization.md](customization.md) — what can be changed to reflect local policy
- [framework/](../framework/) — the governance model AIF enforces
- [admin-guide/overview.md](../admin-guide/overview.md) — operational responsibilities
