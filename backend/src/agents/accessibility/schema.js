/**
 * Accessibility Analysis JSON Schema
 *
 * Machine-readable JSON Schema for the OpenRouter response_format parameter.
 * Matches the output format defined in prompts.js OUTPUT_SCHEMA.
 */

export const ACCESSIBILITY_SCHEMA = {
  type: "object",
  required: ["findings", "scoringSignals", "summary"],
  additionalProperties: true,
  properties: {
    uiInventory: {
      type: "object",
      additionalProperties: true,
      properties: {
        technologies: { type: "array", items: { type: "string" } },
        cssApproach: { type: "array", items: { type: "string" } },
        componentFiles: { type: "array", items: { type: "string" } },
        routeCount: { type: "number" },
        formCount: { type: "number" },
        modalDialogCount: { type: "number" },
        tableCount: { type: "number" },
        imageCount: { type: "number" },
        videoAudioCount: { type: "number" },
        dynamicContentAreas: { type: "number" },
        hasDesignSystem: { type: "boolean" }
      }
    },
    wcagChecklist: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          criterion: { type: "string" },
          title: { type: "string" },
          level: { type: "string", enum: ["A", "AA"] },
          status: { type: "string", enum: ["pass", "fail", "warning", "not_applicable"] },
          checked: { type: "boolean" },
          evidence: { type: "string" },
          instances: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                file: { type: "string" },
                line: { type: "number" },
                element: { type: "string" },
                issue: { type: "string" },
                recommendation: { type: "string" }
              }
            }
          }
        }
      }
    },
    ariaAudit: {
      type: "object",
      additionalProperties: true,
      properties: {
        totalAriaAttributes: { type: "number" },
        misusedRoles: { type: "array", items: { type: "object", additionalProperties: true } },
        missingAriaLabels: { type: "array", items: { type: "object", additionalProperties: true } },
        invalidAriaPatterns: { type: "array", items: { type: "object", additionalProperties: true } },
        liveRegions: { type: "array", items: { type: "object", additionalProperties: true } }
      }
    },
    keyboardAccess: {
      type: "object",
      additionalProperties: true,
      properties: {
        allInteractiveElementsFocusable: { type: "boolean" },
        visibleFocusIndicator: { type: "boolean" },
        focusIndicatorEvidence: { type: ["string", "null"] },
        noKeyboardTraps: { type: "boolean" },
        trapEvidence: { type: ["string", "null"] },
        skipNavigation: { type: "boolean" },
        customKeyHandlers: { type: "array", items: { type: "object", additionalProperties: true } },
        tabindexIssues: { type: "array", items: { type: "object", additionalProperties: true } }
      }
    },
    colorContrast: {
      type: "object",
      additionalProperties: true,
      properties: {
        textColors: { type: "array", items: { type: "object", additionalProperties: true } },
        usesColorAlone: { type: "array", items: { type: "object", additionalProperties: true } },
        respectsUserPreferences: {
          type: "object",
          additionalProperties: true,
          properties: {
            prefersReducedMotion: { type: "boolean" },
            prefersColorScheme: { type: "boolean" },
            forcedColors: { type: "boolean" }
          }
        }
      }
    },
    semanticStructure: {
      type: "object",
      additionalProperties: true,
      properties: {
        hasLandmarks: { type: "boolean" },
        landmarks: { type: "array", items: { type: "object", additionalProperties: true } },
        headingHierarchy: {
          type: "object",
          additionalProperties: true,
          properties: {
            isLogical: { type: "boolean" },
            issues: { type: "array", items: { type: "object", additionalProperties: true } }
          }
        },
        listsUsedCorrectly: { type: "boolean" },
        tablesHaveHeaders: { type: "boolean" },
        tableIssues: { type: "array", items: { type: "object", additionalProperties: true } }
      }
    },
    formsAccessibility: {
      type: "object",
      additionalProperties: true,
      properties: {
        allInputsLabeled: { type: "boolean" },
        labelIssues: { type: "array", items: { type: "object", additionalProperties: true } },
        errorHandling: {
          type: "object",
          additionalProperties: true,
          properties: {
            errorsIdentified: { type: "boolean" },
            errorsSuggestCorrection: { type: "boolean" },
            errorsPreventSubmission: { type: "boolean" },
            issues: { type: "array", items: { type: "object", additionalProperties: true } }
          }
        },
        groupedWithFieldset: { type: "boolean" },
        autocompleteUsed: { type: "boolean" },
        inputPurposeIdentified: { type: "boolean" }
      }
    },
    imagesMedia: {
      type: "object",
      additionalProperties: true,
      properties: {
        allImagesHaveAlt: { type: "boolean" },
        altTextIssues: { type: "array", items: { type: "object", additionalProperties: true } },
        decorativeImagesMarked: { type: "boolean" },
        svgAccessibility: { type: "array", items: { type: "object", additionalProperties: true } },
        videoHasCaptions: { type: ["boolean", "null"] },
        audioHasTranscript: { type: ["boolean", "null"] },
        mediaIssues: { type: "array", items: { type: "object", additionalProperties: true } }
      }
    },
    dynamicContent: {
      type: "object",
      additionalProperties: true,
      properties: {
        statusMessagesAnnounced: { type: "boolean" },
        statusIssues: { type: "array", items: { type: "object", additionalProperties: true } },
        loadingStatesAccessible: { type: "boolean" },
        infiniteScrollAccessible: { type: ["boolean", "null"] },
        spaRouteChangesAnnounced: { type: ["boolean", "null"] },
        toastsNotificationsAccessible: { type: ["boolean", "null"] },
        dynamicIssues: { type: "array", items: { type: "object", additionalProperties: true } }
      }
    },
    modalDialogAccessibility: {
      type: "object",
      additionalProperties: true,
      properties: {
        focusTrappedCorrectly: { type: ["boolean", "null"] },
        escapeCloses: { type: ["boolean", "null"] },
        focusRestored: { type: ["boolean", "null"] },
        ariaDialogUsed: { type: ["boolean", "null"] },
        issues: { type: "array", items: { type: "object", additionalProperties: true } }
      }
    },
    responsiveZoom: {
      type: "object",
      additionalProperties: true,
      properties: {
        viewportMetaCorrect: { type: "boolean" },
        noHorizontalScrollAt320css: { type: ["boolean", "null"] },
        textResizeTo200Percent: { type: ["boolean", "null"] },
        touchTargetMin24px: { type: ["boolean", "null"] },
        issues: { type: "array", items: { type: "object", additionalProperties: true } }
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
          wcagCriterion: { type: ["string", "null"] },
          category: { type: "string" },
          title: { type: "string" },
          detail: { type: "string" },
          evidence: { type: "string" },
          recommendation: { type: "string" }
        }
      }
    },
    scorecard: {
      type: "object",
      additionalProperties: true,
      properties: {
        perceivable: {
          type: "object",
          additionalProperties: true,
          properties: {
            pass: { type: "number" },
            fail: { type: "number" },
            warning: { type: "number" },
            na: { type: "number" }
          }
        },
        operable: {
          type: "object",
          additionalProperties: true,
          properties: {
            pass: { type: "number" },
            fail: { type: "number" },
            warning: { type: "number" },
            na: { type: "number" }
          }
        },
        understandable: {
          type: "object",
          additionalProperties: true,
          properties: {
            pass: { type: "number" },
            fail: { type: "number" },
            warning: { type: "number" },
            na: { type: "number" }
          }
        },
        robust: {
          type: "object",
          additionalProperties: true,
          properties: {
            pass: { type: "number" },
            fail: { type: "number" },
            warning: { type: "number" },
            na: { type: "number" }
          }
        },
        overallCompliance: { type: "string" },
        estimatedConformanceLevel: { type: "string" }
      }
    },
    scoringSignals: {
      type: "object",
      required: ["accessibility"],
      additionalProperties: true,
      properties: {
        accessibility: {
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

  // scoringSignals
  if (!parsed.scoringSignals || typeof parsed.scoringSignals !== "object") {
    errors.push("Missing or invalid 'scoringSignals' object");
  } else {
    const acc = parsed.scoringSignals.accessibility;
    if (!acc || typeof acc !== "object") {
      errors.push("scoringSignals.accessibility is missing");
    } else {
      if (typeof acc.score !== "number" && typeof acc.median !== "number") {
        errors.push("scoringSignals.accessibility.score is not a number");
      }
      if (typeof acc.reasoning !== "string" && !acc.byModel) {
        errors.push("scoringSignals.accessibility.reasoning is not a string");
      }
    }
  }

  // summary
  if (typeof parsed.summary !== "string") {
    errors.push("Missing or invalid 'summary' string");
  }

  return { valid: errors.length === 0, errors };
}
