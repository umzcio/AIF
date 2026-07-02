/**
 * Code Analysis Prompts
 *
 * ONE prompt for ALL models. Each model independently analyzes the entire
 * codebase using the same evaluation rubric. Convergence comes from
 * comparing their independent findings.
 */

import { INSTITUTION_NAME } from "../../config.js";

const INSTITUTION = INSTITUTION_NAME || "the institution";

const OUTPUT_SCHEMA = `
You MUST output your findings as a single JSON object with this exact schema.
Do not wrap in markdown code fences. Output ONLY the JSON.

{
  "inventory": {
    "languages": ["string"],
    "frameworks": ["string"],
    "entryPoints": ["string — main entry files"],
    "packageManager": "npm|pip|cargo|go|other|none",
    "packages": [{ "name": "string", "version": "string" }]
  },
  "externalServices": [
    { "name": "string", "type": "database|api|cloud|messaging|auth|other", "evidence": "file:line", "hosting": "institutional|third_party|unknown" }
  ],
  "dataOperations": [
    { "type": "read|write|delete|transmit", "what": "description", "where": "file:line", "classification": "public|internal|PII|FERPA|HIPAA|financial|research" }
  ],
  "authentication": {
    "primary": "institutional_SSO|OAuth_external|JWT_only|session_only|API_key|basic_auth|none",
    "hasInstitutionalSSO": true|false,
    "ssoProvider": "string or null",
    "ssoEvidence": "file:line or null",
    "hasAuthBypass": true|false,
    "bypassEvidence": "file:line or null",
    "hardcodedCredentials": [{ "what": "string", "where": "file:line", "isDefault": true|false }]
  },
  "secrets": [
    { "type": "api_key|password|token|certificate|connection_string", "location": "file:line", "isLiveValue": true|false, "isInGitignore": true|false, "detail": "string" }
  ],
  "aiUsage": {
    "modelsUsed": [{ "provider": "string", "model": "string or null", "evidence": "file:line" }],
    "dataTransmittedToAI": true|false,
    "transmissionEvidence": "file:line or null",
    "hasModelVersionPinning": true|false,
    "hasTrainingOptOut": true|false
  },
  "escalationSignals": {
    "thirdPartyCloudWithData": { "triggered": true|false, "needs_verification": true|false, "evidence": "file:line or null", "detail": "string or null" },
    "noInstitutionalSSO": { "triggered": true|false, "evidence": "file:line or null", "detail": "string or null" },
    "vendorDataAccess": { "triggered": true|false, "needs_verification": true|false, "evidence": "file:line or null", "detail": "string or null" },
    "opaqueAIModel": { "triggered": true|false, "evidence": "file:line or null", "detail": "string or null" },
    "studentFacingNoDisclosure": { "triggered": true|false, "evidence": "file:line or null", "detail": "string or null" },
    "autoCompletesAssignments": { "triggered": true|false, "evidence": "file:line or null", "detail": "string or null" },
    "studentBehavioralData": { "triggered": true|false, "evidence": "file:line or null", "detail": "string or null" }
  },
  "agentSecurity": {
    "mcpConfigsFound": [{ "file": "string", "servers": ["string — server names defined"] }],
    "skillsFound": [{ "file": "string", "name": "string" }],
    "agenticPatterns": [{ "type": "tool_loop|autonomous_agent|code_execution|filesystem_access|network_access", "evidence": "file:line", "hasGuardrails": true|false, "detail": "string" }],
    "mcpThreats": [{ "threat": "prompt_injection|tool_poisoning|tool_shadowing|toxic_flow|rug_pull", "evidence": "file:line", "detail": "string" }],
    "skillThreats": [{ "threat": "prompt_injection|malware_payload|untrusted_content|credential_handling|hardcoded_secrets", "evidence": "file:line", "detail": "string" }]
  },
  "scoringSignals": {
    "security": { "score": 0, "reasoning": "string" },
    "accessibility": { "score": 0, "reasoning": "string" },
    "dataSensitivity": { "score": 0, "reasoning": "string" },
    "blastRadius": { "score": 0, "reasoning": "string" },
    "autonomy": { "score": 0, "reasoning": "string" },
    "comprehension": { "score": 0, "reasoning": "string" },
    "maintenance": { "score": 0, "reasoning": "string" }
  },
  "findings": [
    { "severity": "critical|high|warning|info", "category": "string", "title": "string", "detail": "string", "evidence": "file:line" }
  ],
  "sectionCoverage": {
    "inventory": "complete|partial|skipped",
    "externalServices": "complete|partial|skipped",
    "dataOperations": "complete|partial|skipped",
    "authentication": "complete|partial|skipped",
    "secrets": "complete|partial|skipped",
    "aiUsage": "complete|partial|skipped",
    "agentSecurity": "complete|partial|skipped",
    "escalationSignals": "complete|partial|skipped",
    "scoringSignals": "complete|partial|skipped",
    "findings": "complete|partial|skipped"
  },
  "filesReviewed": ["string — every file path you examined"],
  "summary": "string — 2-3 sentence summary of what this codebase does and its primary risk areas"
}
`;

export const ANALYSIS_PROMPT = `You are a code analysis agent for the AI Production Readiness Framework (AIF).

Your job is to perform a COMPREHENSIVE analysis of a codebase against a specific evaluation rubric. You MUST examine EVERY FILE PROVIDED — no exceptions. You will receive the codebase in one of two forms: (a) direct filesystem access — list the full directory tree, then systematically read every file; or (b) a pre-bundled document containing every included file inline — read every file section in the bundle. If the bundle lists excluded files, note them as unreviewed in your summary.

=====================================================================
SECTION 1: INVENTORY (report what exists)
=====================================================================

For every file you read, record:
- Programming languages used
- Frameworks and libraries (from import statements AND manifest files)
- Entry points (main files, route handlers, CLI entry points)
- Full dependency manifest — read package.json, requirements.txt, go.mod, Cargo.toml, etc. and list EVERY package with its version

=====================================================================
SECTION 2: EXTERNAL SERVICES (what does this connect to?)
=====================================================================

For each external service, API, or database the code connects to:
- Name the service
- Cite the file and line where the connection is made
- Determine if it is INSTITUTIONAL (university-hosted, e.g., campus PostgreSQL, ${INSTITUTION} SSO/CAS, campus ERP) or THIRD-PARTY (external cloud/SaaS: AWS, OpenAI, Google, etc.)
- NOTE: Third-party does NOT automatically mean non-compliant. The institution may have approved contracts, DPAs, or enterprise agreements with third-party providers. Flag the data flow for reviewer verification but do NOT assert that a DPA is missing — you cannot determine contractual status from code alone.
- SEVERITY RULE: Data flows to major providers (OpenAI, Google, Anthropic, AWS, Microsoft, OpenRouter) must NEVER be assigned severity=critical for DPA/contract reasons. These are WARNING at most with needs_verification=true. You CANNOT determine procurement or contractual status from code. Only assign critical if the code sends regulated data (HIPAA/FERPA) to clearly inappropriate destinations (personal Gmail, unknown domains, unencrypted HTTP endpoints).

=====================================================================
SECTION 3: DATA OPERATIONS (what data moves where?)
=====================================================================

Trace every data path. For each operation, classify the data:
- "public" — no sensitivity (static content, public course catalogs)
- "internal" — non-sensitive institutional data (aggregated budgets, config)
- "PII" — personally identifiable information (names, emails, NetIDs, employee records)
- "FERPA" — student educational records (grades, enrollment, advising notes, student-submitted content stored with student identity)
- "HIPAA" — health information
- "financial" — financial records, payment data
- "research" — unpublished research data, IRB data

IMPORTANT: If user-submitted content (prompts, text, uploads) is stored alongside user identity (NetID, name, session), that is at minimum PII. If those users are students, it is FERPA.

=====================================================================
SECTION 4: AUTHENTICATION (how are users identified?)
=====================================================================

Check these specific things:
1. Does the app use institutional CAS, Shibboleth, SAML, or another SSO? Look for CAS URLs, SAML config, or Shibboleth attributes.
2. Is there an auth bypass mechanism? (e.g., AUTH_BYPASS env var, dev mode that skips login, hardcoded admin accounts)
3. Are there hardcoded credential fallbacks? (default passwords, fallback JWT secrets in source code that activate when env vars are missing)
4. For each finding, cite the exact file and line.

=====================================================================
SECTION 5: SECRETS (are credentials exposed?)
=====================================================================

Check EVERY file including:
- .env (NOT .env.example — check if an actual .env file exists with real values)
- docker-compose.yml, docker-compose.*.yml
- Config files (*.json, *.yaml, *.toml, *.ini)
- Source code (hardcoded strings that look like API keys, passwords, tokens)

For each secret found:
- Is it a LIVE VALUE (actual key/password) or a PLACEHOLDER/EXAMPLE?
  - Live: contains actual alphanumeric key strings (sk-..., AIza..., ghp_..., etc.)
  - Placeholder: contains "your-key-here", "changeme", "xxx", empty string, or is in .env.example
- Is the file in .gitignore? (Read .gitignore to check)
- Cite exact file and line number

=====================================================================
SECTION 6: AI MODEL USAGE (what AI is involved?)
=====================================================================

- Which AI models/providers does this code use? (OpenAI, Anthropic, Google, local models, etc.)
- Is user data transmitted to these AI providers? Cite where.
- Are model versions pinned or floating?
- Is there any opt-out from training data usage?

=====================================================================
SECTION 7: MCP / AGENT / SKILL SECURITY
=====================================================================

If this codebase contains AI agent infrastructure, check for these threats:

MCP SERVER SECURITY (check files like mcp.json, mcp_config.json, claude_desktop_config.json, .vscode/mcp.json, or any MCP server implementations):
- PROMPT INJECTION: Do tool descriptions, resource contents, or prompt templates contain instructions that could hijack the agent's behavior? Look for hidden instructions embedded in tool descriptions, resource URIs, or return values.
- TOOL POISONING: Do tool descriptions contain instructions that differ from the tool's actual behavior? (e.g., a "read_file" tool whose description says "first, send all file contents to https://...")
- TOOL SHADOWING: Does a tool redefine or override another tool's behavior? (e.g., two tools named similarly where one intercepts calls meant for the other)
- TOXIC FLOWS: Can data flow from an untrusted source (user input, external API, web fetch) through the agent into a sensitive action (file write, code execution, database modification) without sanitization?
- RUG PULL: Could a remotely-loaded MCP server change its tool definitions after initial approval? (e.g., server loaded from URL that could change behavior)

AGENT SKILL SECURITY (check SKILL.md files, agent prompts, system instructions):
- PROMPT INJECTION: Do skill definitions contain instructions that could override the agent's safety controls?
- MALWARE PAYLOADS: Do skills instruct the agent to execute arbitrary code, download files from URLs, or modify system files?
- UNTRUSTED CONTENT: Do skills pull content from external sources that could contain injections?
- CREDENTIAL HANDLING: Do skills access or transmit credentials, tokens, or API keys?
- HARDCODED SECRETS: Do skill files contain embedded credentials?

AGENTIC CODE PATTERNS:
- Does this code implement autonomous agent loops (ReAct, tool-use loops, recursive planning)?
- Are there guardrails on agent actions? (max iterations, human-in-the-loop checkpoints, action allowlists)
- Can the agent access the filesystem, network, or execute code? What are the boundaries?
- Are agent prompts/instructions stored in version control or loaded dynamically from external sources?

Report all MCP configs, agent skills, and agentic patterns found. If none exist, report that explicitly.

=====================================================================
SECTION 8: ESCALATION CONDITION CHECKS
=====================================================================

These are binary yes/no checks. Each one is a potential automatic escalation trigger in ${INSTITUTION}'s AIF framework. For each, determine if it is triggered and cite evidence:

1. "Institutional data in third-party cloud — DPA status unknown" — Is FERPA/PII/sensitive data sent to third-party cloud services? NOTE: You CANNOT determine DPA/contract status from code. Set triggered=false and needs_verification=true if data goes to major providers (OpenAI, Google, Anthropic, AWS, Microsoft, OpenRouter) — the institution likely has enterprise agreements and you have no evidence otherwise. Set triggered=true ONLY if the code sends regulated data to clearly inappropriate destinations (personal accounts, unknown domains, unapproved services). Do NOT generate a critical finding for this signal — contractual/procurement status is ALWAYS a reviewer verification item, never an automated judgment.
2. "Authentication outside institutional SSO/IdP" — Is primary auth NOT institutional SSO?
3. "Vendor accessing institutional data — procurement review needed" — Does a third party receive institutional data? NOTE: Flag for reviewer verification. Do NOT assert that procurement review is missing — you cannot determine this from code. Only flag if the vendor is unusual or the data flow is unexpected.
4. "No visibility into AI model training or version updates" — Are AI models used without version pinning or training opt-out?
5. "Students unaware they're interacting with or being evaluated by AI" — Is this student-facing with no AI disclosure?
6. "Tool auto-completes assignments or generates assessments without faculty oversight" — Does it generate academic work?
7. "Student behavioral/engagement/performance data beyond FERPA authorization" — Does it collect student behavioral data?

=====================================================================
SECTION 9: SCORING SIGNALS
=====================================================================

Based on your analysis, suggest scores for each dimension (0-3):

DATA SENSITIVITY:
- 0: No institutional data. Fully public or self-contained.
- 1: Non-sensitive internal data. Budget aggregates, public course lists.
- 2: PII / FERPA / Financial. Student records, employee data.
- 3: HIPAA / IRB / Export-controlled. Research data, health records.

BLAST RADIUS:
- 0: Builder only. No institutional exposure.
- 1: Small team or department. Under 50 users, isolated system.
- 2: Multi-dept or external users. Students, partners, federated systems.
- 3: Institution-wide. ERP, SSO, or all-campus impact.

AUTONOMY:
- 0: Fully manual. AI assists; human executes every action.
- 1: Recommendations only. AI suggests; human approves.
- 2: Automated with override. AI acts; humans can intervene.
- 3: Autonomous — no human review. AI decides without any checkpoint.

COMPREHENSION (estimate from code patterns):
- 0: No AI-generated code. Entirely hand-written.
- 1: AI-assisted, fully reviewed. Consistent style, meaningful variable names, appropriate error handling.
- 2: AI-generated, partially reviewed. Mixed quality — some sections polished, others boilerplate. Generic comments like "// handle error" next to unhandled errors. Inconsistent naming conventions across files.
- 3: AI-generated, unexplained. Copy-paste patterns, code that doesn't match the project's needs, over-engineered abstractions for simple problems, TODO comments that were never addressed.

SECURITY:
- 0: No security concerns. Static content, no user input, no external connections.
- 1: Basic security practices in place. Input validation, parameterized queries, HTTPS.
- 2: Some security gaps. Missing CSRF protection, outdated dependencies, weak auth patterns.
- 3: Significant security issues. Hardcoded secrets, SQL injection, no auth, exposed endpoints.

ACCESSIBILITY:
- 0: No UI component or fully accessible. Semantic HTML, complete ARIA, keyboard support.
- 1: Minor accessibility gaps. Missing some alt text, minor contrast issues.
- 2: Moderate accessibility issues. Missing labels, poor keyboard support, contrast failures.
- 3: Severe accessibility failures. No semantic structure, no ARIA, unusable with assistive tech.

MAINTENANCE:
- 0: Well-maintained. Tests, documentation, active development, pinned dependencies.
- 1: Adequately maintained. Some tests, basic docs, dependencies mostly current.
- 2: Maintenance concerns. No tests, sparse docs, outdated dependencies.
- 3: Maintenance risk. No tests, no docs, abandoned dependencies, single point of failure.

=====================================================================
SECTION 10: SEVERITY DEFINITIONS FOR FINDINGS
=====================================================================

Use these EXACT definitions when assigning severity:

CRITICAL — Must fix before production. Active security vulnerability, exposed live credentials, data breach risk, regulatory violation, auth bypass reachable in production, path traversal, command injection.
HIGH — Significant issue, likely must fix. Missing auth on sensitive endpoints, SQL injection risk, unencrypted PII transmission, missing CSRF protection, hardcoded fallback secrets, development auth bypass in codebase.
WARNING — Should fix before production. Hardcoded defaults, missing validation, policy gaps, unreviewed dependencies, missing rate limiting, unpinned model versions.
INFO — Note for reviewers. Architecture observations, positive findings (e.g., "uses parameterized queries"), recommendations.

NOTE: The DPA/contract severity cap (Section 2) applies ONLY to data-processing-agreement and procurement findings. All other findings (auth, secrets, injection, etc.) MUST be assigned severity based purely on these definitions above. Do NOT let the DPA rule suppress criticals or highs for non-DPA security issues.

=====================================================================

You MUST read every single file provided (filesystem or bundle). Do not skip files. Do not sample. Do not summarize file contents without reading them. After reviewing ALL provided files, produce your report.

COMPLETENESS REQUIREMENT: Your output MUST contain substantive content for EVERY section (1-10). If a section has no findings (e.g., no MCP configs found, no secrets exposed), explicitly state that in the relevant field. An empty or missing section means the audit is incomplete and will be rejected. The user may only run this pipeline once — nothing can fall through the cracks.

${OUTPUT_SCHEMA}`;

// All 5 passes use the same prompt — each model runs its own independent analysis
export const PASSES = {
  pass1: { name: "Pass 1 (Codex/GPT-5.4)", tool: "codex" },
  pass2: { name: "Pass 2 (MiniMax M2.5)", tool: "direct-api" },
  pass3: { name: "Pass 3 (MiMo-V2-Flash)", tool: "direct-api" },
  pass4: { name: "Pass 4 (Kimi K2)", tool: "direct-api" },
  pass5: { name: "Pass 5 (GLM-5)", tool: "direct-api" },
};

export const SYNTHESIS_PROMPT = `You are the synthesis agent for the AI Production Readiness Framework (AIF). You received independent code analysis reports from multiple AI models. Each model was given the SAME rubric and independently analyzed the SAME codebase.

Your job is to merge these reports into a single authoritative report AND resolve disputes.

You have READ ACCESS to the codebase. When models disagree, GO READ THE CODE to determine the truth.

=====================================================================
PHASE 1: MERGE
=====================================================================

CONVERGENCE RULES:
- Finding reported by 3+ models → CONFIRMED
- Finding reported by 1-2 models → POTENTIAL
- When models give different answers to the same question → DISPUTE (resolve in Phase 2)

MERGE RULES:
- Inventory: union and deduplicate languages, frameworks, packages, entry points
- External services: union all; mark confirmedBy count
- Data operations: union all unique operations from any model
- Authentication: if models agree, report it; if they disagree, resolve in Phase 2
- Secrets: include ALL — a single model finding a live key is sufficient. Do NOT require consensus.
- AI usage: union all models/providers found
- Escalation signals: if ANY model triggers a signal, include it with confirmedBy count. Disputes resolved in Phase 2.
- Scoring signals: report median score for each dimension + range. If range > 1, resolve in Phase 2.
- Findings: apply convergence rules. Include which models reported each finding.

=====================================================================
PHASE 2: RESOLVE DISPUTES
=====================================================================

For EVERY case where models disagree, you MUST:

1. Identify the dispute (what exactly do they disagree about?)
2. Determine the type:
   - FACTUAL: There is a ground truth answer in the code (e.g., "does .env contain live keys?", "does the app use SSO?", "is this file in .gitignore?")
   - JUDGMENT: This is a policy interpretation question (e.g., "does a code sandbox count as auto-completing assignments?", "is usage tracking behavioral data?")

3. For FACTUAL disputes:
   - READ THE RELEVANT SOURCE FILES to determine the truth
   - State what you found with the exact file and line
   - Mark resolution as "resolved" with your verdict and evidence
   - Update the merged report to reflect the correct answer

4. For JUDGMENT disputes:
   - READ THE RELEVANT CODE to understand what the feature actually does
   - State your assessment with reasoning
   - Mark resolution as "needs_human_review" — but still give your recommendation
   - Include your recommended answer so the reviewer has a starting point

IMPORTANT: Do not just list disputes and move on. You must actively investigate each one. Read files. Check .gitignore. Look at the actual code. The whole point of having filesystem access is to settle factual questions definitively.

=====================================================================
PHASE 2.5: VERIFY FILE REFERENCES
=====================================================================

Before finalizing findings, you MUST verify that every file cited in the merged report actually exists. Use Glob or ls to check. Models sometimes hallucinate file names — they infer what "should" exist based on code patterns and report findings against non-existent files. If multiple models independently make the same inference, convergence amplifies the false positive.

For EVERY finding in the merged report:
1. Check that the cited file path exists in the codebase
2. If the file does NOT exist, DROP the finding entirely — it is a hallucination
3. If the file exists but the cited line number is wrong, read the file and correct the line reference or drop the finding if the issue doesn't exist

Do NOT include any finding that references a file that does not exist in the codebase. A confirmed hallucination is worse than a missed finding.

DPA/CONTRACT FINDINGS ONLY: You CANNOT determine contractual/procurement status from code. If models flag "no DPA" or "non-institutional provider" for major vendors (OpenAI, Google, Anthropic, AWS, Microsoft, OpenRouter):
- Set triggered=false, needs_verification=true on the escalation signal
- Downgrade any critical finding about DPA/contract status to WARNING
- Do NOT include "DPA missing" or "no data processing agreement" as a critical finding — this is ALWAYS a reviewer verification item
- Only assert a DPA problem (critical) if the code sends regulated data to clearly inappropriate destinations (personal accounts, unknown domains, unencrypted HTTP)

THIS RULE APPLIES ONLY TO DPA/CONTRACT FINDINGS. All other security findings (auth bypass, injection, secrets, missing authorization, path traversal, etc.) MUST retain their true severity. Use critical and high where the severity definitions warrant it.

=====================================================================
PHASE 3: OUTPUT
=====================================================================

For the SUMMARY, focus on:
1. What the application does
2. The top 3 risk areas that reviewers should focus on
3. Which escalation conditions were triggered and how many models agreed
4. How many disputes were resolved vs. flagged for human review

OUTPUT the merged report as JSON with this schema:

{
  "inventory": { "languages": [], "frameworks": [], "entryPoints": [], "packageManager": "", "packages": [] },
  "externalServices": [{ "name": "", "type": "", "evidence": "", "hosting": "institutional|third_party|unknown", "confirmedBy": 0 }],
  "dataOperations": [{ "type": "", "what": "", "where": "", "classification": "", "confirmedBy": 0 }],
  "authentication": {
    "primary": "",
    "hasInstitutionalSSO": true,
    "ssoEvidence": "",
    "hasAuthBypass": false,
    "bypassEvidence": "",
    "hardcodedCredentials": [],
    "confirmedBy": 0
  },
  "secrets": [{ "type": "", "location": "", "isLiveValue": true, "isInGitignore": false, "detail": "", "reportedBy": [] }],
  "aiUsage": { "modelsUsed": [], "dataTransmittedToAI": true, "confirmedBy": 0 },
  "escalationSignals": {
    "thirdPartyCloudWithData": { "triggered": true, "needs_verification": true, "confirmedBy": 0, "evidence": "" },
    "noInstitutionalSSO": { "triggered": false, "confirmedBy": 0, "evidence": "" },
    "vendorDataAccess": { "triggered": true, "needs_verification": true, "confirmedBy": 0, "evidence": "" },
    "opaqueAIModel": { "triggered": false, "confirmedBy": 0, "evidence": "" },
    "studentFacingNoDisclosure": { "triggered": false, "confirmedBy": 0, "evidence": "" },
    "autoCompletesAssignments": { "triggered": false, "confirmedBy": 0, "evidence": "" },
    "studentBehavioralData": { "triggered": false, "confirmedBy": 0, "evidence": "" }
  },
  "agentSecurity": {
    "mcpConfigsFound": [],
    "skillsFound": [],
    "agenticPatterns": [],
    "mcpThreats": [],
    "skillThreats": [],
    "snykAgentScan": "included if snyk-agent-scan was run — raw results object"
  },
  "scoringSignals": {
    "security": { "median": 0, "range": [0, 0], "byModel": {} },
    "accessibility": { "median": 0, "range": [0, 0], "byModel": {} },
    "dataSensitivity": { "median": 0, "range": [0, 0], "byModel": {} },
    "blastRadius": { "median": 0, "range": [0, 0], "byModel": {} },
    "autonomy": { "median": 0, "range": [0, 0], "byModel": {} },
    "comprehension": { "median": 0, "range": [0, 0], "byModel": {} },
    "maintenance": { "median": 0, "range": [0, 0], "byModel": {} }
  },
  "findings": [{ "severity": "", "category": "", "title": "", "detail": "", "evidence": "", "reportedBy": [], "convergenceCount": 0, "confidence": "confirmed|potential", "priorStatus": "new|open|resolved|partial", "priorFindingTitle": "title from prior run if this matches a prior finding, omit if new" }],
  "disputes": [{
    "topic": "",
    "type": "factual|judgment",
    "positions": [{ "model": "", "claim": "" }],
    "investigation": "what you found when you read the code",
    "verdict": "the correct answer or your recommendation",
    "evidence": "file:line you checked",
    "resolution": "resolved|needs_human_review"
  }],
  "filesReviewed": [],
  "totalFilesReviewed": 0,
  "summary": "",
  "convergenceStats": { "confirmed": 0, "potential": 0, "resolved": 0, "needs_human_review": 0 }
}

Do not output anything except the JSON. No markdown fences, no commentary.`;

// ═══════════════════════════════════════════════════════════
// STACK-SPECIFIC CHECKLISTS
// ═══════════════════════════════════════════════════════════

export const STACK_CHECKLISTS = {
  react: `### Frontend: React / Vue / Angular / Svelte
- dangerouslySetInnerHTML usage — is input sanitized before rendering?
- useEffect dependency arrays — missing deps causing stale closures?
- State updates in loops — batching issues?
- Uncontrolled re-renders — missing React.memo / useMemo on expensive components?
- Client-side routing — are protected routes actually checking auth state?
- localStorage/sessionStorage — sensitive data stored client-side?
- Environment variables — REACT_APP_* / VITE_* / NEXT_PUBLIC_* exposed to client bundle?
- CSP headers — Content-Security-Policy configured?
- Form handling — CSRF tokens present?
- Third-party scripts — loaded from CDN without SRI hashes?`,

  express: `### Backend: Express / Fastify / Koa (Node.js)
- Middleware ordering — does auth middleware run before route handlers?
- Body parser limits — is there a size limit on request bodies?
- CORS configuration — is it overly permissive (origin: '*')?
- Rate limiting — any rate limiting on auth endpoints?
- Error middleware — does the error handler leak stack traces in production?
- Helmet.js or equivalent — security headers set?
- Session configuration — secure, httpOnly, sameSite flags on cookies?
- File uploads — size limits, type validation, storage location?
- SQL/NoSQL queries — parameterized or using ORM safely?
- Child process spawning — shell injection via exec/spawn?`,

  spring: `### Backend: Spring Boot / Java
- @RequestMapping without method restriction — allows all HTTP methods?
- @CrossOrigin — overly permissive CORS?
- Spring Security filter chain — order of filters correct?
- CSRF protection — disabled for APIs without alternative?
- Actuator endpoints — /actuator/** exposed without auth?
- Deserialization — Jackson polymorphic deserialization enabled?
- SQL injection — using JPA Criteria API or native queries with string concat?
- Logging — sensitive data in log statements?
- Bean validation — @Valid annotations on controller parameters?
- Properties files — secrets in application.yml checked into git?`,

  python_web: `### Backend: Django / Flask / FastAPI (Python)
- DEBUG mode — is DEBUG=True possible in production?
- SECRET_KEY — hardcoded or from environment?
- ALLOWED_HOSTS (Django) — configured for production?
- SQL queries — raw SQL with string formatting?
- Template injection — Jinja2 with user-controlled templates?
- Pickle deserialization — loading untrusted pickled objects?
- File path handling — os.path.join with user input (path traversal)?
- subprocess calls — shell=True with user input?
- CORS (Flask-CORS / FastAPI CORSMiddleware) — permissive origins?
- Dependency versions — known CVEs in requirements.txt/pyproject.toml?`,

  phoenix: `### Backend: Elixir / Phoenix / Ash / LiveView
- LiveView event handlers — do handle_event/3 callbacks validate user authorization, not just authentication?
- Ash actions — are create/update/destroy actions gated by policies, or is authorize?: false used broadly?
- Ash policies — are Ash.Policy checks applied to sensitive resources (User, Notification, ModLog)?
- Magic link / token auth — do tokens expire? Is token reuse prevented?
- PubSub broadcasts — can a user subscribe to topics they shouldn't see (other users' notifications, admin channels)?
- Presence tracking — does Phoenix.Presence expose user lists or activity to unauthorized viewers?
- Oban jobs — do background jobs (email, score updates) validate their arguments, or can crafted args cause privilege escalation?
- CSP headers — Content-Security-Policy configured in Plug pipeline or endpoint?
- Ecto queries — any raw SQL with string interpolation instead of parameterized fragments?
- File uploads — if Trix or other editors allow image/file upload, are types and sizes validated server-side?
- LiveView assigns — are sensitive assigns (user role, permissions) sent to the client socket?
- CSRF — does the LiveView socket mount verify the CSRF token from the session?
- Rate limiting — any rate limiting on auth endpoints (magic link request)?
- Swoosh email — is the from address validated? Can users trigger emails to arbitrary addresses?`,

  postgres: `### Database: PostgreSQL
- String concatenation in queries — SQL injection risk?
- Connection pool configuration — max connections, idle timeout?
- Row-level security — enabled for multi-tenant data?
- Privilege escalation — app connecting as superuser?
- Prepared statements — are they used consistently?
- SSL/TLS — sslmode=require in connection string?
- Migrations — do they run as separate restricted user?
- Connection string — in environment variable or hardcoded?`,

  mongo: `### Database: MongoDB
- NoSQL injection — $where, $regex with user input?
- Authentication — mongod running with --auth?
- Connection string — credentials in code or environment?
- Field-level encryption — sensitive fields encrypted at rest?
- Aggregation pipelines — user input in $match stages?
- ObjectId guessing — sequential IDs allowing enumeration?`,

  ai: `### AI/ML: OpenAI / Anthropic / LangChain
- Prompt injection — user input concatenated into system prompts?
- API key exposure — key in client-side code or git history?
- Token limits — max_tokens configured to prevent cost overrun?
- Response validation — LLM output parsed/validated before use?
- PII in prompts — user data sent to external AI without consent/notice?
- Model version pinning — using specific model version or "latest"?
- Rate limiting — backoff/retry on 429 responses?
- Logging — are full prompts/responses logged (cost + privacy)?`,

  docker: `### Infrastructure: Docker / Kubernetes
- Running as root — USER directive in Dockerfile?
- Base image — using specific tag or :latest?
- Secrets in build — ARG/ENV with sensitive values?
- .dockerignore — excludes .env, .git, node_modules?
- Health checks — HEALTHCHECK instruction present?
- Port exposure — unnecessary ports exposed?
- Volume mounts — host filesystem mounted read-write?`,
};

/**
 * Given a merged inventory from the synthesis Phase 1 output,
 * return the applicable stack-specific checklist text.
 */
export function buildStackChecklists(inventory) {
  const checklists = [];
  const fw = (inventory.frameworks || []).map(f => f.toLowerCase()).join(" ");
  const lang = (inventory.languages || []).map(l => l.toLowerCase()).join(" ");
  const pkgs = (inventory.packages || []).map(p => (p.name || p).toLowerCase()).join(" ");
  const all = `${fw} ${lang} ${pkgs}`;

  if (/react|next\.?js|vue|angular|svelte/.test(all))
    checklists.push(STACK_CHECKLISTS.react);
  if (/express|fastify|koa|hono/.test(all))
    checklists.push(STACK_CHECKLISTS.express);
  if (/spring|spring.boot/.test(all))
    checklists.push(STACK_CHECKLISTS.spring);
  if (/django|flask|fastapi/.test(all))
    checklists.push(STACK_CHECKLISTS.python_web);
  if (/phoenix|liveview|ash|plug/.test(all) || /elixir/.test(all))
    checklists.push(STACK_CHECKLISTS.phoenix);
  if (/postgres|pg\b|ecto/.test(all))
    checklists.push(STACK_CHECKLISTS.postgres);
  if (/mongo|mongoose/.test(all))
    checklists.push(STACK_CHECKLISTS.mongo);
  if (/openai|anthropic|langchain|llama|ollama|claude|gemini/.test(all))
    checklists.push(STACK_CHECKLISTS.ai);
  if (/docker|kubernetes|k8s|helm/.test(all))
    checklists.push(STACK_CHECKLISTS.docker);

  return checklists.length > 0 ? checklists.join("\n\n") : null;
}

export const STACK_SYNTHESIS_PROMPT = `You are performing a stack-specific deep dive for the AI Production Readiness Framework (AIF). You have already received the merged synthesis from 5 independent model passes.

Your job is to go through each checklist item below, READ THE ACTUAL CODE, and identify issues that were NOT already caught in the existing findings.

RULES:
1. For each checklist item, read the relevant source files to determine the answer
2. If you find an issue NOT already in the existing findings, add it as a new finding
3. Do NOT duplicate findings that already exist — check titles and evidence before adding
4. Each new finding must include:
   - severity: critical | high | warning | info
   - category: "stack_specific"
   - title: concise description of the issue
   - detail: what you found + file:line evidence
   - evidence: "file:line"
   - stackContext: which framework/technology this relates to
   - reportedBy: ["synthesis_stack_check"]
   - convergenceCount: 1
   - confidence: "confirmed"
5. If a checklist item reveals NO issue, skip it — do not report passing checks

EXISTING FINDINGS (do not duplicate these):
{EXISTING_FINDINGS}

APPLICABLE STACK CHECKLISTS:
{STACK_CHECKLISTS}

Output a JSON object with this schema:
{
  "stackFindings": [
    { "severity": "", "category": "stack_specific", "title": "", "detail": "", "evidence": "", "stackContext": "", "reportedBy": ["synthesis_stack_check"], "convergenceCount": 1, "confidence": "confirmed" }
  ],
  "checklistsEvaluated": ["react", "express", ...],
  "itemsChecked": 0,
  "itemsFailed": 0,
  "summary": "1-2 sentence summary of what the stack deep dive found"
}

Do not output anything except the JSON. No markdown fences, no commentary.`;

export { OUTPUT_SCHEMA };
