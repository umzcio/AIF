# Contributing

AIF is developed by the CIO's office at the University of Montana and released under the MIT license. Contributions are welcome from other institutions, implementers, and developers. This document covers the expectations for pull requests, code style, and the non-negotiable rules that keep the framework portable and auditable.

## Before You Start

- Read the [README](../../README.md) for product context
- Read [architecture/overview.md](../architecture/overview.md) for system context
- Read [setup.md](setup.md) for the local development environment
- File an issue for any non-trivial change before writing code — it is much faster to align on approach than to rewrite a PR

## Scope of Contributions

Contributions fit into one of four buckets. The first two are broadly welcome; the second two require coordination first.

| Type | Examples | Process |
|------|----------|---------|
| **Fixes** | Bug fixes, security patches, test additions, documentation corrections | Open a PR directly |
| **Portability improvements** | New auth provider (OIDC, SAML), new SSO variant, institution-neutral refactors | Open a PR; coordinate for large changes |
| **Framework changes** | New intake questions, weight profile adjustments, new escalation conditions, new track boundaries | File an issue first — these have policy implications |
| **New agent** | Adding a pipeline agent (threat modelling, license audit, performance review) | File an issue first; see [extending-agents.md](extending-agents.md) |

## Pull Request Checklist

Before opening a PR, confirm:

- [ ] `cd backend && npm test` passes (currently 324 tests)
- [ ] `cd frontend && npm run build` succeeds
- [ ] `npm run test:providers` passes if you touched provider config
- [ ] No hardcoded institution values (use env vars + `src/config.js`)
- [ ] No secrets, API keys, or `.env` files committed
- [ ] New state-changing routes have a Zod schema in `src/validation.js`
- [ ] Database changes have a new migration file in `backend/migrations/`
- [ ] New env vars documented in `backend/.env.example`
- [ ] Commit messages describe the *why*, not just the *what*

CI runs the first two checks on every PR. The rest are reviewer-enforced.

## Commit Style

Commit messages are reviewed as part of the PR and preserved in the history. They should read like release notes.

### Format

```
<short subject — what changed, under 70 chars>

<optional body — why, with enough detail that a future reviewer
understands the decision without needing to read the diff>
```

Examples from the project history:

```
Migrate HECVAT pass off opencode — remove opencode entirely
Codebase audit: bug fixes, dead code removal, pluggable auth, public repo prep
Replace opencode with direct OpenRouter API for passes 2-5
Add two-layer architecture: deterministic tools + multi-model convergence
Fix path traversal in intake, add pipeline auth checks, guard hallucinated files
```

### Rules

- **Subject under 70 characters.** It has to fit in a GitHub list view.
- **Imperative mood.** "Add X", not "Added X" or "Adds X".
- **No Conventional Commits prefix.** We do not use `feat:` / `fix:` / `chore:`. The subject itself conveys intent.
- **One logical change per commit.** Split cross-cutting refactors into prepare + change commits.
- **No trailing period** in the subject.

### Co-Author Line

If a commit was written with Claude Code (or another AI assistant), add the co-author trailer:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

This is an honesty signal, not a legal requirement. The commit is still attributed to the developer who reviewed and landed it.

### Git Safety

- **Never force-push `main`.** The project's default branch is protected.
- **Never amend a pushed commit.** Create a new commit — history on shared branches is immutable.
- **Do not skip hooks** (`--no-verify`, `--no-gpg-sign`) without a documented reason.
- **Use specific paths** with `git add`. Avoid `git add -A` and `git add .` — they are the easiest way to commit an `.env` file by accident.

## Branching

- `main` is the default branch and must always be releasable.
- Feature branches use a short, descriptive slug: `oidc-provider`, `fix-intake-path-traversal`, `add-license-agent`.
- Rebase before merging. The project keeps a linear history where practical.
- Squash commits only if the intermediate commits are incoherent on their own. Prefer clean, self-contained commits over one giant squash.

## Code Style

### Backend

- **ESM only.** `"type": "module"` in `package.json`. No CommonJS.
- **No ORM.** Raw parameterised SQL through `pg`. Use `$1`, `$2` placeholders; never template-literal interpolate user input.
- **No classes for route logic.** Prefer functional handlers. Classes are fine for shared infrastructure (e.g. a job queue).
- **Structured logging.** Import `log` from `src/logger.js`; use `.child({ context })` for scoped loggers. Do not `console.log` in anything that runs in production.
- **No side effects at import time** except for env-var validation in auth providers (see existing pattern).
- **Async/await over promise chains.** `.then()` is acceptable for short one-liners; anything longer should be `await`ed.

### Frontend

- **One component per file.** Component filename matches export.
- **Hooks over classes.** Never use React class components.
- **Use the `C` constant for colours.** Never hardcode hex values in JSX or inline styles.
- **Inline styles for component-specific layout; CSS classes for reusable patterns.**
- **WCAG 2.2 AA is non-negotiable.** Every new interactive element must be keyboard-reachable, have a visible focus indicator, meet 4.5:1 contrast, and carry an accessible name.
- **Hash routing only.** The app runs behind a reverse proxy at a subpath. Do not add `react-router-dom` or any pushState router.

### File Formatting

- 2-space indentation (backend and frontend)
- Unix line endings
- UTF-8 encoding
- Trailing newline at end of file
- Semicolons (JavaScript)

There is no Prettier or ESLint config committed. Match the surrounding code. Reviewers enforce consistency.

## What Must Not Break

These properties are load-bearing for the framework. PRs that break any of them will be rejected regardless of how clever the code is.

### Scoring Parity

The frontend (`frontend/src/constants.js`) and backend (`backend/src/scoring.js`) weight matrices must match dimension-for-dimension. The frontend does a preview computation; the backend recomputes authoritatively on submit. If they drift, users see one score and the database stores another.

`scoring.test.js` enforces parity. Never weaken that test.

### Institution-Neutral Defaults

No hardcoded references to the University of Montana, UM, login.umt.edu, `.umontana.edu`, or any other UM-specific value in source code. These belong in env vars:

- `INSTITUTION_NAME`
- `INSTITUTION_DOMAIN`
- `CAS_BASE_URL`
- `FRONTEND_URL`
- `ADMIN_NETIDS`

The `um-standards/` directory is an exception — it contains UM-specific reference material and is gitignored.

### Uniform Pipeline

Every track runs all four agents and all five model passes. Do not introduce "lightweight" or "skip" paths based on track. Track determines governance (who must approve) not analysis depth. This is a framework-level design decision, not a performance knob.

### Route Validation

Every state-changing route (POST, PUT, PATCH, DELETE) must have a Zod schema applied via the `validate()` middleware in `src/validation.js`. Routes without validation will be caught in review.

### Database Migrations

Every schema change needs a new migration file:

```bash
touch backend/migrations/NNN_descriptive_name.sql
```

Migrations are append-only. Never edit a migration that has already been merged — add a new one that corrects the drift.

Migrations must be idempotent:

```sql
CREATE TABLE IF NOT EXISTS ...
ALTER TABLE x ADD COLUMN IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
```

See `backend/migrations/` for examples.

### No New Dependencies Without Justification

Every added dependency is a future CVE to track and a future migration to perform. If you can solve the problem in ~50 lines of vendored code, do so. Dependencies we actively lean on (Express, pg, jose, zod, helmet) are chosen for stability and single-purpose scope.

Adding a dependency should be called out explicitly in the PR description with a justification.

## PR Process

### Opening

1. Fork the repo (external contributors) or create a branch (internal contributors)
2. Open the PR against `main`
3. Use the PR template (if present) — otherwise include:
   - **What changed** — two or three sentences
   - **Why** — the problem being solved
   - **Test plan** — what you ran to verify (e.g. "ran `npm test`, started the dev server, submitted a new intake")
   - **Breaking changes** — any env-var changes, migration requirements, or API shape changes

### Review

- Reviewers will focus on: correctness, security, test coverage, commit hygiene, and portability
- Code style is a lower bar — we match the surrounding code rather than prescribing rigid rules
- Architecture concerns may come up. If a reviewer suggests a different approach, that is usually faster to discuss in the PR than to rewrite after merge
- Expect at least one round of revisions on non-trivial PRs

### Merging

- Reviewer merges after approval
- Prefer rebase-and-merge for small, clean branches
- Use squash-and-merge only when intermediate commits are incoherent
- Delete the branch after merge

## Security

### Reporting Vulnerabilities

Do not file security issues in public. Email the maintainer privately. Include:

- Steps to reproduce
- Impact assessment
- Suggested remediation if you have one

A coordinated disclosure window will be set before any public fix is pushed.

### Security-Relevant Areas

Pay extra attention in PRs that touch:

- `src/auth/**` — authentication and session handling
- `src/routes/auth.js` — JWT issuance and validation
- `src/routes/pipeline.js` — URL validation, archive extraction, git clone
- `src/utils/extract.js` — path traversal protection
- `src/agents/shared/cli.js` — subprocess execution, env filtering
- Any DB query — SQL injection via string concatenation

The self-scan of the portal's own codebase (run via `node src/index.js .`) is a useful review tool — it catches many regressions before a human reviewer sees them.

## Documentation

Documentation lives in `docs/` under subject-matter directories. If your change affects user-facing behaviour, update the relevant doc in the same PR. Unsure which doc to update? Ask in the PR — a reviewer will point you to the right file.

Auto-generated documentation (intake forms, the framework PDF) is not hand-edited. Update the source (`um-ai-built-tool-intake.docx` for the policy doc, `frontend/src/components/FrameworkDoc.jsx` for the portal reference).

## License

AIF is MIT-licensed. By submitting a PR you agree that your contribution is released under the same licence. See `LICENSE` in the repository root.

## Getting Help

- **General questions**: file a GitHub issue with the `question` label
- **Framework interpretation**: read the framework policy document or ask in an issue
- **Architecture questions**: read `docs/architecture/` first; then ask
- **Bug reports**: file an issue with reproduction steps and expected vs. actual behaviour

## Related Reference

- [setup.md](setup.md) — local development environment
- [testing.md](testing.md) — test strategy and patterns
- [extending-agents.md](extending-agents.md) — add a new agent
- [adding-auth-provider.md](adding-auth-provider.md) — implement OIDC or SAML
- [architecture/overview.md](../architecture/overview.md) — system design
