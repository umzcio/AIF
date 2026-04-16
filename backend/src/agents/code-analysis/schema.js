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

