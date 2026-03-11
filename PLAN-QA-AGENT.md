# Plan: QA / Bug Detection Agent (Agent 3)

**Replaces:** HECVAT 4 Lite Self-Assessment
**Architecture:** Multi-model convergence (5 passes + synthesis), same as Agents 1 & 2
**Pipeline position:** Runs after Agents 1 & 2 complete (reads their outputs)

---

## 1. What This Agent Does

Finds **logic bugs, correctness issues, and quality problems** — the things Agent 1 doesn't look for. Agent 1 asks "is this secure?" The QA agent asks "does this actually work?"

### Analysis Categories

| # | Category | What It Catches |
|---|----------|-----------------|
| 1 | **Null/Undefined Handling** | Missing null checks, optional chaining gaps, unguarded property access |
| 2 | **Error Handling** | Swallowed exceptions, empty catch blocks, missing error propagation, uncaught promise rejections |
| 3 | **Async/Concurrency** | Missing await, race conditions, unhandled promise rejections, deadlock patterns, concurrent mutation |
| 4 | **Edge Cases** | Empty arrays/strings, boundary values, integer overflow, off-by-one errors, division by zero |
| 5 | **Type Safety** | Implicit coercion bugs, string/number confusion, incorrect comparisons (`==` vs `===`), type mismatches at boundaries |
| 6 | **Resource Management** | Unclosed connections, file handle leaks, missing cleanup in finally blocks, unbounded growth (arrays, maps, listeners) |
| 7 | **Logic Errors** | Inverted conditions, unreachable code, dead branches, incorrect operator precedence, copy-paste bugs |
| 8 | **API Contract Violations** | Return type mismatches, missing required fields, inconsistent error response shapes, undocumented side effects |
| 9 | **State Management** | Stale closures, mutation of shared state, inconsistent state transitions, missing state resets |
| 10 | **Failure Modes** | What happens when the database is down? When the API returns 500? When the disk is full? When the network times out? |

### What It Does NOT Do (Agent 1 already covers these)

- Security vulnerabilities (XSS, SQL injection, auth bypass)
- Secrets detection
- Data classification
- Compliance/policy evaluation
- Accessibility

### Key Difference From Agent 1

Agent 1 findings look like:
> **WARNING: SQL Injection** — User input concatenated into query without parameterization. `src/db.js:42`

QA Agent findings look like:
> **BUG: Unhandled null result** — `getUser()` returns null when user not found, but caller at `src/routes/profile.js:28` accesses `.name` without null check. Will throw TypeError in production.

---

## 2. Architecture

Same multi-model convergence pattern as Agents 1 & 2:

```
5 Models (parallel)          Synthesis (Claude)
┌─────────────────┐
│ GPT-5.4 (Codex) │──┐
│ Gemini 2.5 Pro  │──┤
│ Grok            │──┼──→  Merge + Dispute Resolution → synthesis.json
│ Kimi K2         │──┤
│ Qwen3 Coder     │──┘
└─────────────────┘
```

**Why multi-model for QA?** Logic bugs are subtle. One model might miss a race condition another catches. If 3/5 models independently flag the same null pointer bug, it's almost certainly real. If only 1 model flags it, it's worth investigating but might be a false positive.

### Convergence Rules (same as Agent 1)

- **3+ models report same bug** → CONFIRMED (high confidence)
- **1-2 models report bug** → POTENTIAL (needs verification)
- **Disagreement** → Synthesis reads code to determine truth
- **Unlike Agent 1:** No "single-reporter escalation" — bugs require convergence (unlike secrets, where one model finding a live key is sufficient)

---

## 3. Input/Output

### Inputs

1. **Full codebase** (same filesystem access as other agents)
2. **Agent 1 synthesis.json** — To avoid duplicate findings and to leverage the inventory (languages, frameworks, entry points, packages)
3. **Agent 2 synthesis.json** — To cross-reference UI component analysis

### Output Schema

```json
{
  "inventory": {
    "note": "Inherited from Agent 1 — not re-analyzed",
    "languages": ["from Agent 1"],
    "frameworks": ["from Agent 1"],
    "entryPoints": ["from Agent 1"]
  },

  "bugFindings": [
    {
      "id": "BUG-001",
      "severity": "critical | warning | info",
      "category": "null_handling | error_handling | async | edge_case | type_safety | resource_leak | logic_error | api_contract | state_management | failure_mode",
      "title": "Short description of the bug",
      "detail": "Full explanation: what's wrong, why it's wrong, what will happen in production",
      "evidence": "file:line",
      "codeSnippet": "The problematic code (2-5 lines)",
      "triggerCondition": "How to trigger this bug (e.g., 'when user ID is null', 'when API returns empty array')",
      "suggestedFix": "Brief description of how to fix it (not full code, just approach)",
      "affectedFlow": "Which user-facing flow this impacts (e.g., 'user registration', 'checkout')"
    }
  ],

  "failureModeAnalysis": [
    {
      "dependency": "PostgreSQL | Redis | External API | Filesystem",
      "failureScenario": "Connection refused | Timeout | Disk full | Rate limited",
      "currentBehavior": "What the code does now (e.g., 'crashes with unhandled exception')",
      "evidence": "file:line",
      "recommendation": "What it should do (e.g., 'return cached result', 'show error page')"
    }
  ],

  "codeSmells": [
    {
      "type": "dead_code | unreachable_branch | duplicated_logic | god_function | missing_abstraction",
      "location": "file:line",
      "detail": "Why this is a problem",
      "risk": "What could go wrong because of this"
    }
  ],

  "testCoverageGaps": [
    {
      "component": "Function or module name",
      "location": "file:line",
      "untestedScenario": "What's not tested (e.g., 'error path when DB connection fails')",
      "risk": "Why this matters"
    }
  ],

  "scoringSignals": {
    "bugDensity": { "score": 0, "reasoning": "0=clean, 1=minor issues, 2=significant bugs, 3=critical bugs in core flows" },
    "errorHandling": { "score": 0, "reasoning": "0=robust, 1=minor gaps, 2=significant gaps, 3=no error handling" },
    "resilience": { "score": 0, "reasoning": "0=handles all failures gracefully, 1=some gaps, 2=fragile, 3=will crash on first failure" },
    "codeQuality": { "score": 0, "reasoning": "0=clean, 1=minor smells, 2=significant issues, 3=unmaintainable" }
  },

  "findings": [
    {
      "severity": "critical | warning | info",
      "category": "string",
      "title": "string",
      "detail": "string",
      "evidence": "file:line"
    }
  ],

  "filesReviewed": ["string"],
  "summary": "2-3 sentence overview: top bugs found, overall code quality assessment, biggest risk areas"
}
```

### Output Directory

```
agent3_qa/
├── pass1.json          (GPT-5.4 analysis)
├── pass2.json          (Gemini analysis)
├── pass3.json          (Grok analysis)
├── pass4.json          (Kimi analysis)
├── pass5.json          (Qwen analysis)
├── synthesis.json      (merged findings)
└── _synthesis_input.txt
```

---

## 4. Files to Create / Modify

### New Files

| File | Purpose |
|------|---------|
| `backend/src/agents/qa-analysis/lenses.js` | QA_PROMPT, SYNTHESIS_PROMPT, PASSES, output schema |
| `backend/src/agents/qa-analysis/runner.js` | `runQAAnalysis()` — same pattern as code-analysis runner |

### Modified Files

| File | Change |
|------|--------|
| `backend/src/orchestrator/index.js` | Replace `runHecvatAssessment` import with `runQAAnalysis`. Update Agent 3 block to run QA instead of HECVAT. Update output directory from `agent3_hecvat` to `agent3_qa`. |
| `backend/src/pipeline/queue.js` | Update agent name from `"hecvat"` to `"qa-analysis"`. Update `passes_total` from 1 to 5 (multi-model). |
| `backend/src/agents/documentation/runner.js` | Update `collectAgentReports()` to read from `agent3_qa/synthesis.json` instead of `agent3_hecvat/hecvat_assessment.json`. |
| `backend/src/agents/documentation/prompts.js` | Update DOC_PROMPT to reference QA findings instead of HECVAT assessment. Add HECVAT generation instructions (moved from Agent 3). |

### Deleted Files (after HECVAT moves to docs)

| File | Reason |
|------|--------|
| `backend/src/agents/hecvat/runner.js` | Replaced by QA agent |
| `backend/src/agents/hecvat/prompts.js` | HECVAT prompt moves into documentation agent |
| `backend/src/agents/hecvat/critical_questions.txt` | Moves into documentation agent directory |
| `backend/src/agents/hecvat/xlsx-export.js` | Moves into documentation agent directory |

---

## 5. Pipeline Impact

### Before (Current)

```
Agent 1 (Code+Security) ──┐
                           ├──→ Agent 3 (HECVAT, 1 pass) ──→ Agent 4 (Docs, 1 pass)
Agent 2 (Accessibility)  ──┘
```

### After

```
Agent 1 (Code+Security) ──┐
                           ├──→ Agent 3 (QA, 5 passes + synthesis) ──→ Agent 4 (Docs + HECVAT, 1 pass)
Agent 2 (Accessibility)  ──┘
```

### Timing Impact

| | Before | After |
|---|--------|-------|
| Agent 3 | ~2 min (1 Claude pass) | ~15 min (5 passes + synthesis) |
| Agent 4 | ~3 min | ~5 min (slightly longer — generates HECVAT too) |
| **Total pipeline** | ~20 min | ~33 min |

### Cost Impact

| | Before | After |
|---|--------|-------|
| Agent 3 | ~$0.45 (1 Claude pass) | ~$1.13 (5 passes + synthesis) |
| Agent 4 | ~$0.45 | ~$0.60 (slightly more output) |
| **Total pipeline** | ~$2.50 | ~$3.33 |

---

## 6. HECVAT Migration to Documentation Agent

The HECVAT assessment doesn't disappear — it becomes an output artifact of Agent 4 (Documentation). The documentation agent already reads all prior agent outputs and generates compliance documents. HECVAT is a compliance document.

### What Moves

1. **HECVAT prompt** (87 questions + rubric) → embedded in documentation agent's prompt
2. **critical_questions.txt** → moved to `backend/src/agents/documentation/`
3. **xlsx-export.js** → moved to `backend/src/agents/documentation/`
4. **Output**: `hecvat_assessment.json` + `.xlsx` now written by Agent 4 alongside other docs

### Documentation Agent New Outputs

```
agent4_documentation/
├── documentation.json
├── USER_GUIDE.md / .docx
├── ADMIN_GUIDE.md / .docx
├── COMPLIANCE_SUMMARY.md / .docx
├── hecvat_assessment.json        ← NEW (moved from Agent 3)
└── hecvat_assessment.xlsx        ← NEW (moved from Agent 3)
```

---

## 7. Implementation Order

1. Create `backend/src/agents/qa-analysis/lenses.js` with QA_PROMPT, SYNTHESIS_PROMPT, schema
2. Create `backend/src/agents/qa-analysis/runner.js` modeled on code-analysis runner
3. Move HECVAT files into documentation agent directory
4. Update documentation agent prompt to include HECVAT generation
5. Update orchestrator to wire in QA agent at position 3
6. Update pipeline queue agent list and pass counts
7. Update documentation agent's `collectAgentReports()` to read QA output
8. Test pipeline end-to-end
9. Remove `backend/src/agents/hecvat/` directory

---

## 8. Open Questions

1. **Should Agent 3 (QA) also have codebase access, or only read Agent 1's output?**
   - Recommendation: Full codebase access. Agent 1's synthesis doesn't include every code path — the QA agent needs to read actual code to find logic bugs.

2. **Should QA findings feed into Agent 1's scoring signals?**
   - Recommendation: No. Keep agents independent. The documentation agent synthesizes everything.

3. **Should the QA agent run in parallel with Agents 1 & 2 (since it reads the codebase independently)?**
   - Recommendation: Run after Agents 1 & 2. Reading Agent 1's inventory avoids the QA agent wasting time re-discovering the tech stack. Agent 1's findings also help the QA agent avoid duplicate reports.

4. **Differential review for QA agent?**
   - Recommendation: Yes. Same pattern as Agents 1 & 2 — track prior findings across runs.
