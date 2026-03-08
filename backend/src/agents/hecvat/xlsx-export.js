/**
 * HECVAT XLSX Export
 *
 * Takes the JSON assessment from Agent 3 and populates the actual HECVAT 4.15
 * spreadsheet template, producing a filled-in .xlsx a CISO can review.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = process.env.HECVAT_TEMPLATE_PATH || join(__dirname, "..", "..", "..", "..", "hecvat415.xlsx");

/**
 * Map agent status values to HECVAT-style answer text.
 */
function statusToAnswer(status, answer) {
  switch (status) {
    case "yes": return "Yes";
    case "no": return "No";
    case "partial": return "Partial";
    case "not_applicable": return "N/A";
    case "requires_human_input": return "";
    default: return "";
  }
}

/**
 * Build a row-index map for a sheet: question ID → row number.
 * Scans column A for IDs matching /^[A-Z]{2,4}-\d+$/.
 */
function buildIdRowMap(sheet) {
  const map = {};
  if (!sheet || !sheet["!ref"]) return map;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let r = 0; r <= range.e.r; r++) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
    const id = cell?.v || "";
    if (typeof id === "string" && /^[A-Z]{2,4}-\d+$/.test(id)) {
      map[id] = r;
    }
  }
  return map;
}

/**
 * Write a value into a cell, creating it if needed.
 */
function setCell(sheet, r, c, value) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (!sheet[addr]) sheet[addr] = {};
  sheet[addr].v = value;
  sheet[addr].t = "s";
}

/**
 * Export HECVAT assessment to a filled XLSX file.
 *
 * @param {object} assessment - Parsed hecvat_assessment.json
 * @param {string} outputPath - Where to write the .xlsx
 * @param {string} [templatePath] - Override template location
 * @returns {string} - Path to written file
 */
export function exportHecvatXlsx(assessment, outputPath, templatePath) {
  const tpl = templatePath || TEMPLATE_PATH;
  if (!existsSync(tpl)) {
    throw new Error(`HECVAT template not found: ${tpl}`);
  }

  const wb = XLSX.readFile(tpl);

  // Build ID→row maps for each relevant sheet
  const ieSheet = wb.Sheets["Institution Evaluation"];
  const privSheet = wb.Sheets["Privacy"];
  const privAnalystSheet = wb.Sheets["Privacy Analyst Evaluation"];

  const ieMap = buildIdRowMap(ieSheet);
  const privMap = buildIdRowMap(privSheet);
  const privAnalystMap = buildIdRowMap(privAnalystSheet);

  // Answer column is C (index 2) in all sheets
  // Additional Information is D (index 3) in Institution Evaluation
  // For Privacy tab, answer is also column C (index 2)
  const ANSWER_COL = 2;
  const ADDL_INFO_COL = 3;

  let filled = 0;
  let skipped = 0;

  for (const q of assessment.questions || []) {
    const answerText = statusToAnswer(q.status, q.answer);
    const detail = q.answer || "";

    // Try Institution Evaluation first (has most questions)
    if (ieMap[q.id] !== undefined) {
      const row = ieMap[q.id];
      if (answerText) setCell(ieSheet, row, ANSWER_COL, answerText);
      if (detail) setCell(ieSheet, row, ADDL_INFO_COL, detail);
      filled++;
    }

    // Also fill Privacy tab (for PCOM, PTHP, PDAT, PRPO, DPAI questions)
    if (privMap[q.id] !== undefined) {
      const row = privMap[q.id];
      if (answerText) setCell(privSheet, row, ANSWER_COL, answerText);
      if (detail) setCell(privSheet, row, ADDL_INFO_COL, detail);
      if (!ieMap[q.id]) filled++; // only count if not already counted
    }

    // Also fill Privacy Analyst Evaluation
    if (privAnalystMap[q.id] !== undefined) {
      const row = privAnalystMap[q.id];
      if (answerText) setCell(privAnalystSheet, row, ANSWER_COL, answerText);
      if (detail) setCell(privAnalystSheet, row, ADDL_INFO_COL, detail);
    }

    if (!ieMap[q.id] && !privMap[q.id] && !privAnalystMap[q.id]) {
      skipped++;
    }
  }

  XLSX.writeFile(wb, outputPath);
  console.log(`[hecvat] XLSX exported: ${filled} questions filled, ${skipped} not found in template`);
  console.log(`[hecvat] Output: ${outputPath}`);

  return outputPath;
}
