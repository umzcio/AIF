/**
 * Code Analysis JSON Schema
 *
 * Machine-readable JSON Schema for the OpenRouter response_format parameter.
 * Matches the output format defined in lenses.js OUTPUT_SCHEMA.
 */

export const CODE_ANALYSIS_SCHEMA = {
  type: "object",
  required: ["inventory", "findings", "scoringSignals", "summary"],
  additionalProperties: true,
  properties: {
    inventory: {
      type: "object",
      required: ["languages", "frameworks", "entryPoints", "packageManager", "packages"],
      additionalProperties: true,
      properties: {
        languages: { type: "array", items: { type: "string" } },
        frameworks: { type: "array", items: { type: "string" } },
        entryPoints: { type: "array", items: { type: "string" } },
        packageManager: { type: "string" },
        packages: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "version"],
            additionalProperties: true,
            properties: {
              name: { type: "string" },
              version: { type: "string" }
            }
          }
        }
      }
    },
    externalServices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          name: { type: "string" },
          type: { type: "string" },
          evidence: { type: "string" },
          hosting: { type: "string" }
        }
      }
    },
    dataOperations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          type: { type: "string" },
          what: { type: "string" },
          where: { type: "string" },
          classification: { type: "string" }
        }
      }
    },
    authentication: {
      type: "object",
      additionalProperties: true,
      properties: {
        primary: { type: "string" },
        hasInstitutionalSSO: { type: "boolean" },
        ssoProvider: { type: ["string", "null"] },
        ssoEvidence: { type: ["string", "null"] },
        hasAuthBypass: { type: "boolean" },
        bypassEvidence: { type: ["string", "null"] },
        hardcodedCredentials: { type: "array", items: { type: "object", additionalProperties: true } }
      }
    },
    secrets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          type: { type: "string" },
          location: { type: "string" },
          isLiveValue: { type: "boolean" },
          isInGitignore: { type: "boolean" },
          detail: { type: "string" }
        }
      }
    },
    aiUsage: {
      type: "object",
      additionalProperties: true,
      properties: {
        modelsUsed: { type: "array", items: { type: "object", additionalProperties: true } },
        dataTransmittedToAI: { type: "boolean" },
        transmissionEvidence: { type: ["string", "null"] },
        hasModelVersionPinning: { type: "boolean" },
        hasTrainingOptOut: { type: "boolean" }
      }
    },
    escalationSignals: {
      type: "object",
      additionalProperties: true,
      properties: {
        thirdPartyCloudWithData: { type: "object", additionalProperties: true },
        noInstitutionalSSO: { type: "object", additionalProperties: true },
        vendorDataAccess: { type: "object", additionalProperties: true },
        opaqueAIModel: { type: "object", additionalProperties: true },
        studentFacingNoDisclosure: { type: "object", additionalProperties: true },
        autoCompletesAssignments: { type: "object", additionalProperties: true },
        studentBehavioralData: { type: "object", additionalProperties: true }
      }
    },
    agentSecurity: {
      type: "object",
      additionalProperties: true,
      properties: {
        mcpConfigsFound: { type: "array", items: { type: "object", additionalProperties: true } },
        skillsFound: { type: "array", items: { type: "object", additionalProperties: true } },
        agenticPatterns: { type: "array", items: { type: "object", additionalProperties: true } },
        mcpThreats: { type: "array", items: { type: "object", additionalProperties: true } },
        skillThreats: { type: "array", items: { type: "object", additionalProperties: true } }
      }
    },
    scoringSignals: {
      type: "object",
      required: ["security", "accessibility", "dataSensitivity", "blastRadius", "autonomy", "comprehension", "maintenance"],
      additionalProperties: true,
      properties: {
        security: {
          type: "object",
          required: ["score", "reasoning"],
          additionalProperties: true,
          properties: {
            score: { type: "number", minimum: 0, maximum: 3 },
            reasoning: { type: "string" }
          }
        },
        accessibility: {
          type: "object",
          required: ["score", "reasoning"],
          additionalProperties: true,
          properties: {
            score: { type: "number", minimum: 0, maximum: 3 },
            reasoning: { type: "string" }
          }
        },
        dataSensitivity: {
          type: "object",
          required: ["score", "reasoning"],
          additionalProperties: true,
          properties: {
            score: { type: "number", minimum: 0, maximum: 3 },
            reasoning: { type: "string" }
          }
        },
        blastRadius: {
          type: "object",
          required: ["score", "reasoning"],
          additionalProperties: true,
          properties: {
            score: { type: "number", minimum: 0, maximum: 3 },
            reasoning: { type: "string" }
          }
        },
        autonomy: {
          type: "object",
          required: ["score", "reasoning"],
          additionalProperties: true,
          properties: {
            score: { type: "number", minimum: 0, maximum: 3 },
            reasoning: { type: "string" }
          }
        },
        comprehension: {
          type: "object",
          required: ["score", "reasoning"],
          additionalProperties: true,
          properties: {
            score: { type: "number", minimum: 0, maximum: 3 },
            reasoning: { type: "string" }
          }
        },
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
          evidence: { type: "string" }
        }
      }
    },
    sectionCoverage: {
      type: "object",
      additionalProperties: true
    },
    filesReviewed: {
      type: "array",
      items: { type: "string" }
    },
    summary: { type: "string" }
  }
};

const SCORING_DIMENSIONS = [
  "security", "accessibility", "dataSensitivity",
  "blastRadius", "autonomy", "comprehension", "maintenance"
];

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

  // inventory
  if (!parsed.inventory || typeof parsed.inventory !== "object") {
    errors.push("Missing or invalid 'inventory' object");
  } else {
    for (const field of ["languages", "frameworks", "entryPoints", "packages"]) {
      if (!Array.isArray(parsed.inventory[field])) {
        errors.push(`inventory.${field} is not an array`);
      }
    }
    if (typeof parsed.inventory.packageManager !== "string") {
      errors.push("inventory.packageManager is not a string");
    }
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
          break; // one error per finding is enough
        }
      }
    }
  }

  // scoringSignals
  if (!parsed.scoringSignals || typeof parsed.scoringSignals !== "object") {
    errors.push("Missing or invalid 'scoringSignals' object");
  } else {
    for (const dim of SCORING_DIMENSIONS) {
      const sig = parsed.scoringSignals[dim];
      if (!sig || typeof sig !== "object") {
        errors.push(`scoringSignals.${dim} is missing`);
      } else {
        if (typeof sig.score !== "number" && typeof sig.median !== "number") {
          errors.push(`scoringSignals.${dim}.score is not a number`);
        }
        if (typeof sig.reasoning !== "string" && !sig.byModel) {
          errors.push(`scoringSignals.${dim}.reasoning is not a string`);
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
