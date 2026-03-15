/**
 * ESLint QA Scanner
 *
 * Runs ESLint with quality/correctness rules against JS/TS codebases
 * to catch dead code, unused variables, unreachable code, and type issues
 * mechanically. These are the things LLMs inconsistently catch across passes.
 *
 * Same pattern as the a11y linter: creates a temp config, installs ESLint,
 * runs against the codebase, returns structured findings.
 */

import { spawn } from "child_process";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import log from "../../logger.js";

/**
 * Detect if the codebase has JS/TS source files worth linting.
 */
function hasJSTSSource(codebasePath) {
  const dirs = ["src", "app", "lib", "components", "pages", "frontend/src", "backend/src"];
  const checkDirs = [codebasePath, ...dirs.map(d => join(codebasePath, d))];

  for (const dir of checkDirs) {
    if (!existsSync(dir)) continue;
    try {
      const { execSync } = require("child_process");
      const count = execSync(
        `find "${dir}" -maxdepth 3 \\( -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.tsx" \\) ! -path "*/node_modules/*" ! -path "*/.next/*" ! -path "*/dist/*" 2>/dev/null | head -5 | wc -l`,
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (parseInt(count) > 0) return true;
    } catch {}
  }
  return false;
}

// Detect if the project uses TypeScript
function hasTypeScript(codebasePath) {
  return existsSync(join(codebasePath, "tsconfig.json")) ||
    existsSync(join(codebasePath, "tsconfig.base.json"));
}

// ESLint flat config for QA/correctness rules
const QA_CONFIG_JS = `
import js from "@eslint/js";

export default [
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // Dead code
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-unreachable": "error",
      "no-unreachable-loop": "error",
      "no-constant-condition": "error",
      "no-constant-binary-expression": "error",

      // Correctness
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-duplicate-case": "error",
      "no-func-assign": "error",
      "no-import-assign": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-unsafe-negation": "error",
      "no-unsafe-optional-chaining": "error",

      // Bug-prone patterns
      "no-fallthrough": "error",
      "no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      "no-loss-of-precision": "error",
      "no-unmodified-loop-condition": "error",
      "array-callback-return": "error",
      "no-constructor-return": "error",
      "no-promise-executor-return": "error",
      "no-template-curly-in-string": "warn",
      "no-unassigned-import": "off",

      // Async issues
      "no-async-promise-executor": "error",
      "require-atomic-updates": "warn",
      "no-await-in-loop": "warn",
    },
  },
];
`;

const QA_CONFIG_TS = `
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      // Dead code (TS-aware)
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-unreachable": "error",
      "no-unreachable-loop": "error",
      "no-constant-condition": "error",
      "no-constant-binary-expression": "error",

      // Correctness
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-unsafe-negation": "error",
      "no-unsafe-optional-chaining": "error",

      // Bug-prone patterns
      "no-fallthrough": "error",
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      "no-loss-of-precision": "error",
      "array-callback-return": "error",
      "no-constructor-return": "error",
      "no-promise-executor-return": "error",
      "no-template-curly-in-string": "warn",

      // Async issues
      "no-async-promise-executor": "error",
      "require-atomic-updates": "warn",
      "no-await-in-loop": "warn",
    },
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-unreachable": "error",
      "no-unreachable-loop": "error",
      "no-constant-condition": "error",
      "no-constant-binary-expression": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-unsafe-negation": "error",
      "no-unsafe-optional-chaining": "error",
      "no-fallthrough": "error",
      "no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      "no-loss-of-precision": "error",
      "array-callback-return": "error",
      "no-constructor-return": "error",
      "no-promise-executor-return": "error",
      "no-template-curly-in-string": "warn",
      "no-async-promise-executor": "error",
      "require-atomic-updates": "warn",
      "no-await-in-loop": "warn",
    },
  },
];
`;

/**
 * Map ESLint rule categories to QA categories.
 */
function categorizeRule(ruleId) {
  if (!ruleId) return "unknown";
  if (ruleId.includes("unused")) return "dead_code";
  if (ruleId.includes("unreachable")) return "dead_code";
  if (ruleId.includes("constant-condition") || ruleId.includes("constant-binary")) return "logic_errors";
  if (ruleId.includes("dupe") || ruleId.includes("duplicate")) return "logic_errors";
  if (ruleId.includes("self-assign") || ruleId.includes("self-compare")) return "logic_errors";
  if (ruleId.includes("async") || ruleId.includes("await") || ruleId.includes("promise") || ruleId.includes("atomic")) return "async_concurrency";
  if (ruleId.includes("fallthrough")) return "edge_cases";
  if (ruleId.includes("typeof") || ruleId.includes("isnan") || ruleId.includes("negation") || ruleId.includes("optional-chaining")) return "type_safety";
  if (ruleId.includes("callback-return") || ruleId.includes("constructor-return")) return "error_handling";
  return "code_smell";
}

/**
 * Run ESLint QA scanner against a JS/TS codebase.
 * Returns structured findings or null if not applicable/failed.
 */
export async function runEslintQA(codebasePath, outputDir) {
  const qLog = log.child({ component: "eslint-qa" });

  if (!hasJSTSSource(codebasePath)) {
    qLog.info("No JS/TS source files found, skipping ESLint QA scan");
    return null;
  }

  const useTS = hasTypeScript(codebasePath);
  qLog.info("Running ESLint QA scan", { typescript: useTS });

  const start = Date.now();

  // Set up temp config directory
  const configDir = join(outputDir, "_eslint_qa");
  mkdirSync(configDir, { recursive: true });

  const configPath = join(configDir, "eslint.config.mjs");
  writeFileSync(configPath, useTS ? QA_CONFIG_TS : QA_CONFIG_JS);

  // Write package.json for dependencies
  const deps = {
    "eslint": "*",
    "@eslint/js": "*",
  };
  if (useTS) {
    deps["@typescript-eslint/eslint-plugin"] = "*";
    deps["@typescript-eslint/parser"] = "*";
    deps["typescript"] = "*";
  }
  writeFileSync(join(configDir, "package.json"), JSON.stringify({
    name: "eslint-qa-temp",
    type: "module",
    dependencies: deps,
  }));

  // Install dependencies
  try {
    const { execSync } = await import("child_process");
    execSync("npm install --no-audit --no-fund --loglevel=error", {
      cwd: configDir,
      timeout: 90000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    qLog.warn("Failed to install ESLint QA dependencies", { error: err.message });
    return null;
  }

  // Find source directories
  const srcDirs = ["src", "app", "lib", "components", "pages", "frontend/src", "backend/src"];
  const targetDirs = srcDirs
    .map(d => join(codebasePath, d))
    .filter(d => existsSync(d));

  if (targetDirs.length === 0) targetDirs.push(codebasePath);

  return new Promise((resolve) => {
    const eslintBin = join(configDir, "node_modules", ".bin", "eslint");
    const args = [
      "--config", configPath,
      "--format", "json",
      "--no-error-on-unmatched-pattern",
      "--ignore-pattern", "node_modules",
      "--ignore-pattern", "dist",
      "--ignore-pattern", ".next",
      "--ignore-pattern", "build",
      "--ignore-pattern", "coverage",
      ...targetDirs,
    ];

    const proc = spawn(eslintBin, args, {
      timeout: 120000,
      cwd: codebasePath,
      env: { ...process.env, NODE_PATH: join(configDir, "node_modules") },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch {}

      if (!parsed || !Array.isArray(parsed)) {
        if (stdout || stderr) writeFileSync(join(outputDir, "eslint_qa_raw.txt"), stdout || stderr);
        qLog.warn(`ESLint QA completed in ${elapsed}s (could not parse output)`, { code });
        resolve(null);
        return;
      }

      // Transform to our findings format
      const findings = [];
      for (const file of parsed) {
        if (!file.messages || file.messages.length === 0) continue;
        const relPath = file.filePath.replace(codebasePath + "/", "").replace(codebasePath, "");

        for (const msg of file.messages) {
          const ruleId = msg.ruleId || "unknown";
          findings.push({
            severity: msg.severity === 2 ? "warning" : "info",
            ruleId,
            category: categorizeRule(ruleId),
            title: `${ruleId}: ${msg.message}`,
            detail: msg.message,
            file: relPath,
            line: msg.line || 0,
            column: msg.column || 0,
            evidence: `${relPath}:${msg.line || 0}`,
            tool: "eslint-qa",
          });
        }
      }

      const result = {
        tool: "eslint-qa",
        typescript: useTS,
        totalFiles: parsed.length,
        filesWithIssues: parsed.filter(f => f.errorCount + f.warningCount > 0).length,
        totalErrors: parsed.reduce((n, f) => n + f.errorCount, 0),
        totalWarnings: parsed.reduce((n, f) => n + f.warningCount, 0),
        byCategory: {},
        findings,
      };

      // Count by category
      for (const f of findings) {
        result.byCategory[f.category] = (result.byCategory[f.category] || 0) + 1;
      }

      writeFileSync(join(outputDir, "eslint_qa.json"), JSON.stringify(result, null, 2));
      qLog.info(`ESLint QA completed in ${elapsed}s`, {
        files: result.totalFiles,
        errors: result.totalErrors,
        warnings: result.totalWarnings,
        findings: findings.length,
        byCategory: result.byCategory,
      });
      resolve(result);
    });

    proc.on("error", (err) => {
      qLog.warn("ESLint QA failed", { error: err.message });
      resolve(null);
    });
  });
}
