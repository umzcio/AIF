/**
 * opencode Agent Definition Generator
 *
 * Generates .opencode/agent/<name>.md files in the codebase directory
 * from existing prompt constants. opencode reads agent definitions
 * from the working directory's .opencode/agent/ folder.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { ANALYSIS_PROMPT } from "../agents/code-analysis/lenses.js";
import { ACCESSIBILITY_PROMPT } from "../agents/accessibility/prompts.js";
import { QA_PROMPT } from "../agents/qa-analysis/prompts.js";
import { HECVAT_PROMPT } from "../agents/documentation/hecvat-prompt.js";

const AGENT_PROMPTS = {
  "code-analysis": ANALYSIS_PROMPT,
  "accessibility": ACCESSIBILITY_PROMPT,
  "qa-analysis": QA_PROMPT,
  "hecvat": HECVAT_PROMPT,
};

/**
 * Prompt suffix appended to every agent definition.
 * Addresses a failure mode where models exhaust their output budget on file
 * exploration (tool use) and never produce the final JSON report.
 */
export const PROMPT_SUFFIX = `

CRITICAL OUTPUT REQUIREMENT:
You MUST produce the JSON report above as your final output. Do NOT end your response with file-reading or exploration. Budget your work: spend at most 60% of your effort on reading files, then produce the complete JSON. If you are running low on output capacity, STOP exploring and emit the JSON immediately with whatever findings you have so far. An incomplete JSON report is far more valuable than an exhaustive exploration that never produces a report. Your response MUST end with valid JSON matching the schema above.`;

/**
 * Generate .opencode/agent/<passKey>.md files from existing prompts.
 *
 * @param {string} codebasePath - Codebase directory where .opencode/agent/ will be created
 * @param {Object} passConfig - Map of passKey → { model, agentType, prompt? }
 *   e.g. { "code-pass2": { model: "openrouter/minimax/minimax-m2.5", agentType: "code-analysis" } }
 *   If `prompt` is provided, it overrides the agentType lookup.
 * @returns {Map<string, string>} passKey → agent name
 */
export function generateAgentDefinitions(codebasePath, passConfig) {
  const agentDir = join(codebasePath, ".opencode", "agent");
  mkdirSync(agentDir, { recursive: true });

  const agentMap = new Map();

  for (const [passKey, config] of Object.entries(passConfig)) {
    const agentName = passKey; // e.g. "code-pass2"
    const prompt = config.prompt || AGENT_PROMPTS[config.agentType];
    if (!prompt) throw new Error(`No prompt found for agent type: ${config.agentType}`);

    const content = `---
name: ${agentName}
model: ${config.model}
---

${prompt}
${PROMPT_SUFFIX}
`;
    writeFileSync(join(agentDir, `${agentName}.md`), content);
    agentMap.set(passKey, agentName);
  }

  return agentMap;
}

/**
 * Remove generated .opencode/agent/ directory from codebase.
 */
export function cleanupAgentDefinitions(codebasePath) {
  const agentDir = join(codebasePath, ".opencode", "agent");
  if (existsSync(agentDir)) {
    rmSync(agentDir, { recursive: true, force: true });
  }
  // Clean up .opencode dir if empty
  const ocDir = join(codebasePath, ".opencode");
  if (existsSync(ocDir)) {
    try { rmSync(ocDir, { recursive: false }); } catch {}
  }
}
