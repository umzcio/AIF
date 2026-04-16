# Scoring Model

Every submission is scored across seven dimensions, each from 0 to 3. Scores are multiplied by artifact-type-specific weights and summed into a weighted percentage that routes the tool to one of four tracks. This page explains each dimension in plain language; the [Framework Reference](../framework/scoring-model.md) carries the authoritative specification.

## The Seven Dimensions

| Dimension | Label | What It Measures |
|-----------|-------|------------------|
| Security | SEC | Attack surface: authentication, public exposure, credential handling. |
| Accessibility | A11Y | WCAG 2.2 AA compliance posture. |
| Data Sensitivity | DATA | Regulatory classification of the data being touched. |
| Blast Radius | BLAST | How many people are affected if the tool fails or is compromised. |
| Autonomy | AUTO | How independently the tool makes decisions without human review. |
| Comprehension | COMP | How well the builder understands the code they submitted. |
| Maintenance | MAINT | Sustainability: version control, succession, responsiveness. |

## Security

**Drivers: Q5 (deployment), Q6 (authentication).**

- 0 — Internal server, no public surface.
- 1 — Accessible only on campus network or VPN.
- 2 — Public internet with authentication.
- 3 — Public internet, no authentication.

Custom or absent authentication (Q6) adds +1, capped at 3.

## Accessibility

**Drivers: Q5, Q1.**

- 0 — No UI, or exempt artifact type.
- 2 — Internal web app.
- 3 — Public-facing website or web app.

A public-facing deployment means WCAG 2.2 AA review is mandatory regardless of other answers. The Accessibility agent audits automatically during the pipeline.

## Data Sensitivity

**Drivers: Q9, Q10.**

- 0 — No data handled.
- 1 — Internal institutional data.
- 2 — FERPA student records, HR/payroll, payment information, credentials, or behavioral data.
- 3 — HIPAA, IRB research, export-controlled/CUI, or tribal data.

A score of 3 in this dimension also triggers the "Regulated data" [escalation](../framework/escalation-conditions.md), forcing Track 4.

## Blast Radius

**Drivers: Q3 (audience), Q8 (user count).**

- 0 — Just the builder.
- 1 — Immediate team.
- 2 — Department or students.
- 3 — General public or external partners.

If Q8 indicates 500+ users, the score increases by 1 (capped at 3).

## Autonomy

**Drivers: Q20 (decisions), Q21 (user disclosure).**

- 0 — Fully manual, human in the loop for every decision.
- 1-2 — Partial autonomy or users only partially aware they are interacting with AI.
- 3 — Autonomous decisions, users unaware.

Substantive free-text in Q20 describing decisions adds +1. Q21 = `no` adds +2. Q21 = `partial` adds +1.

## Comprehension

**Driver: Q19 (plain-language explanation).**

The form measures the length of the builder's plain-language explanation as a proxy for comprehension. Short or missing explanations score high (more risk):

- 0 — Explanation of 200 characters or more.
- 1 — 80-199 characters.
- 2 — 20-79 characters.
- 3 — Fewer than 20 characters, or no explanation at all.

This is a deliberate proxy, not a substitute for reviewer judgment. A reviewer can override the track if the explanation is long but vacuous.

## Maintenance

**Drivers: Q15, Q16, Q17, Q18.**

Maintenance accumulates risk points rather than mapping to a single answer:

| Signal | Added Risk |
|--------|------------|
| Q15 = `no-vc` (no version control) | +1 |
| Q16 = `nobody` or `stop` (no succession) | +1 |
| Q17 = `third-party-dep` (reliance on third party) | +0.5 |
| Q18 = `only-me` or `unknown` (no documented responder) | +0.5 |

Accumulated points are rounded to the nearest integer and capped at 3.

## Weight Profiles by Artifact Type

Dimensions are weighted differently depending on what was built. The table below shows the weight applied to each dimension for each artifact type (Q1):

| Dimension | public-site | internal-app | script-api | ai-agent | data-pipeline | other |
|-----------|:-----------:|:------------:|:----------:|:--------:|:-------------:|:-----:|
| Security | 4 | 3 | 3 | 3 | 3 | 3 |
| Accessibility | 4 | 3 | 0 | 1 | 0 | 2 |
| Data Sensitivity | 3 | 4 | 3 | 3 | 4 | 3 |
| Blast Radius | 3 | 2 | 2 | 4 | 2 | 2 |
| Autonomy | 1 | 1 | 2 | 4 | 2 | 1 |
| Comprehension | 2 | 2 | 2 | 4 | 2 | 2 |
| Maintenance | 3 | 3 | 3 | 3 | 3 | 3 |

Example: An AI agent weights Autonomy, Blast Radius, and Comprehension at 4 because AI agents act independently and can affect many users. A data pipeline weights Accessibility at 0 because it has no UI.

## Weighted Percentage

The weighted percentage is computed as:

```text
sum(score * weight) / (3 * sum(weight))
```

Multiplied by 100 for display.

A public site with the worst possible answers produces a weighted percentage of 100%. A tool scoring 0 on every dimension produces 0%.

## Track Assignment

| Weighted % | Track |
|------------|-------|
| < 22% | Track 1 — Register & Go |
| 22% - 41.9% | Track 2 — Self-Certify |
| 42% - 64.9% | Track 3 — IT Review |
| >= 65% | Track 4 — Formal Project |

See [Tracks](tracks.md) for what happens in each.

## Escalation Overrides

Seven conditions force Track 4 regardless of weighted percentage:

1. Regulated data (HIPAA, IRB, export-controlled, tribal).
2. FERPA data in a public-facing deployment.
3. Institutional data in personal accounts.
4. AI model without an approved DPA.
5. Custom authentication instead of campus SSO.
6. No version control.
7. Students unaware they are interacting with AI.

See [Framework Reference: Escalation Conditions](../framework/escalation-conditions.md) for the detailed rationale behind each.

## Preview vs. Authoritative Score

The intake form's sidebar shows a preview score computed in the browser. This is a display convenience. When the builder submits, the backend re-runs the same scoring logic against the raw answers and stores the authoritative result. The two should agree in normal conditions. If they diverge (due to out-of-date frontend code, for example), the backend value governs.

## Related Reading

- [Tracks](tracks.md) — what each score range means for next steps.
- [Intake Form](intake-form.md) — where the answers come from.
- [Framework Reference: Scoring Model](../framework/scoring-model.md) — full specification.
- [Framework Reference: Escalation Conditions](../framework/escalation-conditions.md) — override rules.
