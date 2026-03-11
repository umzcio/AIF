# Plan: Agent 1 Stack-Specific Sub-Prompt Enhancement

**Scope:** Enhancement to existing Agent 1 (Code & Security Analysis)
**Architecture change:** None — same 5 passes + synthesis, but synthesis gets stack-aware checklists
**Risk:** Low — additive change, no structural modifications

---

## 1. Problem

Today, all 5 models receive the same `ANALYSIS_PROMPT` regardless of whether the codebase is a React SPA, a Python data pipeline, a Java Spring Boot API, or a PostgreSQL-heavy application. The prompt is comprehensive but generic.

A React app and a Flask API both get asked about "entry points" and "authentication" — but the specific vulnerabilities, bug patterns, and best practices are completely different.

---

## 2. Approach: Stack-Aware Synthesis

**Don't change the 5-pass prompts.** The generic prompt works well for discovery. Instead, enhance the **synthesis phase** with stack-specific investigation checklists.

### Why Synthesis, Not Per-Pass?

1. **Phase 1 already identifies the tech stack.** After 5 passes, the synthesizer knows exactly what languages, frameworks, and databases are in play.
2. **Per-pass specialization would require routing logic** — detecting the stack before analysis runs, maintaining N prompt variants per framework, and losing the benefit of diverse model perspectives on the same prompt.
3. **Synthesis is where Claude reads code to resolve disputes.** Adding "also check these framework-specific patterns while you're reading code" is natural.

### How It Works

```
5 Models (same generic prompt)
        │
        ▼
   Synthesis Phase
        │
        ├── Phase 1: Merge (existing)
        ├── Phase 2: Resolve Disputes (existing)
        ├── Phase 3: Stack-Specific Deep Dive (NEW)
        │     ├── Detect stack from merged inventory
        │     ├── Inject relevant checklists
        │     └── Investigate each checklist item against codebase
        └── Phase 4: Output (existing, enhanced)
```

---

## 3. Stack-Specific Checklists

### Frontend: React / Vue / Angular / Svelte

```
REACT_CHECKLIST:
- [ ] dangerouslySetInnerHTML usage — is input sanitized before rendering?
- [ ] useEffect dependency arrays — missing deps causing stale closures?
- [ ] State updates in loops — batching issues?
- [ ] Uncontrolled re-renders — missing React.memo / useMemo on expensive components?
- [ ] Client-side routing — are protected routes actually checking auth state?
- [ ] localStorage/sessionStorage — sensitive data stored client-side?
- [ ] Environment variables — REACT_APP_* / VITE_* exposed to client bundle?
- [ ] CSP headers — Content-Security-Policy configured?
- [ ] Form handling — CSRF tokens present?
- [ ] Third-party scripts — loaded from CDN without SRI hashes?
```

### Backend: Express / Fastify / Koa (Node.js)

```
EXPRESS_CHECKLIST:
- [ ] Middleware ordering — does auth middleware run before route handlers?
- [ ] Body parser limits — is there a size limit on request bodies?
- [ ] CORS configuration — is it overly permissive (origin: '*')?
- [ ] Rate limiting — any rate limiting on auth endpoints?
- [ ] Error middleware — does the error handler leak stack traces in production?
- [ ] Helmet.js or equivalent — security headers set?
- [ ] Session configuration — secure, httpOnly, sameSite flags on cookies?
- [ ] File uploads — size limits, type validation, storage location?
- [ ] SQL/NoSQL queries — parameterized or using ORM safely?
- [ ] Child process spawning — shell injection via exec/spawn?
```

### Backend: Spring Boot / Java

```
SPRING_CHECKLIST:
- [ ] @RequestMapping without method restriction — allows all HTTP methods?
- [ ] @CrossOrigin — overly permissive CORS?
- [ ] Spring Security filter chain — order of filters correct?
- [ ] CSRF protection — disabled for APIs without alternative?
- [ ] Actuator endpoints — /actuator/** exposed without auth?
- [ ] Deserialization — Jackson polymorphic deserialization enabled?
- [ ] SQL injection — using JPA Criteria API or native queries with string concat?
- [ ] Logging — sensitive data in log statements?
- [ ] Bean validation — @Valid annotations on controller parameters?
- [ ] Properties files — secrets in application.yml checked into git?
```

### Backend: Django / Flask / FastAPI (Python)

```
PYTHON_WEB_CHECKLIST:
- [ ] DEBUG mode — is DEBUG=True possible in production?
- [ ] SECRET_KEY — hardcoded or from environment?
- [ ] ALLOWED_HOSTS (Django) — configured for production?
- [ ] SQL queries — raw SQL with string formatting?
- [ ] Template injection — Jinja2 with user-controlled templates?
- [ ] Pickle deserialization — loading untrusted pickled objects?
- [ ] File path handling — os.path.join with user input (path traversal)?
- [ ] subprocess calls — shell=True with user input?
- [ ] CORS (Flask-CORS / FastAPI CORSMiddleware) — permissive origins?
- [ ] Dependency versions — known CVEs in requirements.txt/pyproject.toml?
```

### Database: PostgreSQL

```
POSTGRES_CHECKLIST:
- [ ] String concatenation in queries — SQL injection risk?
- [ ] Connection pool configuration — max connections, idle timeout?
- [ ] Row-level security — enabled for multi-tenant data?
- [ ] Privilege escalation — app connecting as superuser?
- [ ] Prepared statements — are they used consistently?
- [ ] pg_hba.conf — if present, authentication method configured?
- [ ] SSL/TLS — sslmode=require in connection string?
- [ ] Migrations — do they run as separate restricted user?
- [ ] Backup credentials — separate from app credentials?
- [ ] Connection string — in environment variable or hardcoded?
```

### Database: MongoDB

```
MONGO_CHECKLIST:
- [ ] NoSQL injection — $where, $regex with user input?
- [ ] Authentication — mongod running with --auth?
- [ ] Connection string — credentials in code or environment?
- [ ] Field-level encryption — sensitive fields encrypted at rest?
- [ ] Aggregation pipelines — user input in $match stages?
- [ ] ObjectId guessing — sequential IDs allowing enumeration?
```

### AI/ML: OpenAI / Anthropic / LangChain

```
AI_CHECKLIST:
- [ ] Prompt injection — user input concatenated into system prompts?
- [ ] API key exposure — key in client-side code or git history?
- [ ] Token limits — max_tokens configured to prevent cost overrun?
- [ ] Response validation — LLM output parsed/validated before use?
- [ ] PII in prompts — user data sent to external AI without consent/notice?
- [ ] Model version pinning — using specific model version or "latest"?
- [ ] Rate limiting — backoff/retry on 429 responses?
- [ ] Logging — are full prompts/responses logged (cost + privacy)?
```

### Infrastructure: Docker / Kubernetes

```
DOCKER_CHECKLIST:
- [ ] Running as root — USER directive in Dockerfile?
- [ ] Base image — using specific tag or :latest?
- [ ] Secrets in build — ARG/ENV with sensitive values?
- [ ] .dockerignore — excludes .env, .git, node_modules?
- [ ] Health checks — HEALTHCHECK instruction present?
- [ ] Port exposure — unnecessary ports exposed?
- [ ] Volume mounts — host filesystem mounted read-write?
```

---

## 4. Implementation

### Files Modified

| File | Change |
|------|--------|
| `backend/src/agents/code-analysis/lenses.js` | Add `STACK_CHECKLISTS` object mapping framework names to checklist strings. Update `SYNTHESIS_PROMPT` to include Phase 3 instructions. |

That's it. **One file changed.**

### How the Synthesis Prompt Changes

Current synthesis prompt has 3 phases: Merge → Resolve Disputes → Output.

New synthesis prompt adds Phase 3 between disputes and output:

```
## PHASE 3: STACK-SPECIFIC DEEP DIVE

Based on the merged inventory, identify which stack-specific checklists apply.
For each applicable checklist:

1. Go through each checklist item
2. READ THE ACTUAL CODE to determine the answer
3. For each item that reveals an issue not already in the findings:
   - Add it to the findings array with:
     - severity: critical/warning/info
     - category: "stack_specific"
     - title: the checklist item
     - detail: what you found + file:line evidence
     - stackContext: which framework/technology this relates to

Do NOT add findings that duplicate existing findings from the merge phase.
Do NOT skip items — check every applicable one.

${APPLICABLE_CHECKLISTS}
```

### Dynamic Checklist Injection

The synthesis prompt builder reads the merged inventory from Phase 1 and injects only relevant checklists:

```javascript
function buildStackChecklists(mergedInventory) {
  const checklists = [];
  const { frameworks, languages } = mergedInventory;

  if (frameworks.some(f => /react/i.test(f)))
    checklists.push(STACK_CHECKLISTS.react);
  if (frameworks.some(f => /express|fastify|koa/i.test(f)))
    checklists.push(STACK_CHECKLISTS.express);
  if (frameworks.some(f => /spring/i.test(f)))
    checklists.push(STACK_CHECKLISTS.spring);
  if (frameworks.some(f => /django|flask|fastapi/i.test(f)))
    checklists.push(STACK_CHECKLISTS.python_web);
  if (frameworks.some(f => /postgres|pg/i.test(f)))
    checklists.push(STACK_CHECKLISTS.postgres);
  // ... etc

  return checklists.join("\n\n");
}
```

### Challenge: Synthesis Doesn't Know Inventory Until It Runs

The synthesis prompt needs to include the right checklists, but the inventory comes from the 5 passes which are input to synthesis. Two options:

**Option A: Two-phase synthesis** (recommended)
1. First Claude call: Merge + Resolve Disputes → produces merged inventory + findings
2. Read merged inventory, build stack checklist string
3. Second Claude call: Stack-specific deep dive using checklist + merged findings

**Option B: Include ALL checklists, let Claude select**
- Simpler but wastes prompt tokens
- Include all checklists with instruction: "Only investigate checklists matching the inventory"
- Risk: Claude might skip checklists or investigate irrelevant ones

**Recommendation: Option A.** The synthesis already runs as a single expensive Claude call. Splitting it into two calls adds ~$0.30 but gives precise checklist targeting. The first call produces structured JSON that can be programmatically parsed to select checklists.

---

## 5. Output Schema Changes

The existing synthesis output schema gains one new field in the findings:

```json
{
  "findings": [
    {
      "severity": "warning",
      "category": "stack_specific",
      "title": "Express CORS allows all origins",
      "detail": "cors({ origin: '*' }) in src/app.js:15 allows any domain to make API requests",
      "evidence": "src/app.js:15",
      "stackContext": "express",
      "reportedBy": ["synthesis_stack_check"],
      "convergenceCount": 1,
      "confidence": "confirmed"
    }
  ]
}
```

Existing findings from the 5-pass convergence are unchanged. Stack-specific findings are additive.

---

## 6. Maintainability

### Adding a New Stack Checklist

1. Add entry to `STACK_CHECKLISTS` object in `lenses.js`
2. Add detection rule in `buildStackChecklists()`
3. Done — no other files change

### Checklist Format

Plain text, not code. Each item is a yes/no question that Claude can answer by reading code. Keep items specific and actionable — "is CORS configured?" is too vague, "does cors() middleware use origin: '*'?" is checkable.

---

## 7. Timeline & Risk

| Aspect | Assessment |
|--------|------------|
| **Scope** | Small — one file modified, additive change |
| **Risk** | Low — doesn't change the 5-pass architecture or existing findings |
| **Cost increase** | ~$0.30 per run (one additional Claude call for stack deep dive) |
| **Time increase** | ~2-3 min per run (one additional Claude pass) |
| **Dependencies** | None — can be implemented independently of QA Agent |

---

## 8. Future: Per-Pass Stack Specialization (V2)

If the synthesis-phase approach proves valuable, a future enhancement could specialize the 5 per-pass prompts themselves:

- Detect stack from `package.json` / file extensions before running passes
- Append stack-specific sections to `ANALYSIS_PROMPT` for each pass
- All 5 models still get the same prompt (just enhanced for that stack)

This is more invasive and should only be done if the synthesis-phase approach shows clear value. Start simple.
