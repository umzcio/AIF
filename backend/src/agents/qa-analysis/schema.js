/**
 * QA / Bug Detection JSON Schema
 *
 * Machine-readable JSON Schema for the OpenRouter response_format parameter.
 * Matches the output format defined in prompts.js OUTPUT_SCHEMA.
 */

export const QA_SCHEMA = {
  type: "object",
  required: ["findings", "summary"],
  additionalProperties: true,
  properties: {
    bugFindings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          title: { type: "string" },
          category: { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "warning", "info"] },
          file: { type: "string" },
          line: { type: "number" },
          detail: { type: "string" },
          evidence: { type: "string" },
          suggestedFix: { type: "string" },
          confidence: { type: "string" }
        }
      }
    },
    failureModeAnalysis: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          scenario: { type: "string" },
          trigger: { type: "string" },
          impact: { type: "string" },
          likelihood: { type: "string" },
          file: { type: "string" },
          line: { type: "number" },
          mitigation: { type: "string" }
        }
      }
    },
    codeSmells: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          title: { type: "string" },
          category: { type: "string" },
          file: { type: "string" },
          line: { type: "number" },
          detail: { type: "string" },
          suggestion: { type: "string" }
        }
      }
    },
    testCoverageGaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          area: { type: "string" },
          file: { type: "string" },
          risk: { type: "string" },
          suggestedTests: { type: "array", items: { type: "string" } }
        }
      }
    },
    scoringSignals: {
      type: "object",
      additionalProperties: true,
      properties: {
        maintenance: {
          type: "object",
          required: ["score", "reasoning"],
          additionalProperties: true,
          properties: {
            score: { type: "number", minimum: 0, maximum: 3 },
            reasoning: { type: "string" }
          }
        }
      }
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "category", "title", "detail", "evidence"],
        additionalProperties: true,
        properties: {
          severity: { type: "string", enum: ["critical", "high", "warning", "info"] },
          category: { type: "string" },
          title: { type: "string" },
          detail: { type: "string" },
          evidence: { type: "string" },
          remediation: { type: "string" }
        }
      }
    },
    sectionCoverage: {
      type: "object",
      additionalProperties: true,
      properties: {
        null_undefined: { type: "object", additionalProperties: true },
        error_handling: { type: "object", additionalProperties: true },
        async_concurrency: { type: "object", additionalProperties: true },
        edge_cases: { type: "object", additionalProperties: true },
        type_safety: { type: "object", additionalProperties: true },
        resource_management: { type: "object", additionalProperties: true },
        logic_errors: { type: "object", additionalProperties: true },
        api_contract: { type: "object", additionalProperties: true },
        state_management: { type: "object", additionalProperties: true },
        failure_modes: { type: "object", additionalProperties: true }
      }
    },
    filesReviewed: {
      type: "array",
      items: { type: "string" }
    },
    summary: { type: "string" }
  }
};

/**
 * Validate parsed output against required fields.
 * @param {object} parsed - Parsed JSON output from a model pass
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateOutput(parsed) {
  const errors = [];

  if (!parsed || typeof parsed !== "object") {
    return { valid: false, errors: ["Output is not an object"] };
  }

  // findings
  if (!Array.isArray(parsed.findings)) {
    errors.push("Missing or invalid 'findings' array");
  } else {
    for (let i = 0; i < parsed.findings.length; i++) {
      const f = parsed.findings[i];
      for (const field of ["severity", "category", "title", "detail", "evidence"]) {
        if (typeof f[field] !== "string") {
          errors.push(`findings[${i}].${field} is not a string`);
          break;
        }
      }
    }
  }

  // summary
  if (typeof parsed.summary !== "string") {
    errors.push("Missing or invalid 'summary' string");
  }

  return { valid: errors.length === 0, errors };
}
