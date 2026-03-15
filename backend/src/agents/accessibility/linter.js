/**
 * Static Accessibility Linter
 *
 * Runs eslint-plugin-jsx-a11y (React/JSX) or framework-appropriate linters
 * against the codebase. Produces structured JSON findings that get injected
 * into Agent 2 synthesis as tool-verified results.
 *
 * Same pattern as Snyk agent-scan in Agent 1: runs in parallel with model
 * passes, returns null on failure, non-blocking.
 */

import { spawn } from "child_process";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import log from "../../logger.js";

/**
 * Detect the UI framework(s) in a codebase by checking manifest files and file extensions.
 */
function detectUIFramework(codebasePath) {
  const frameworks = [];

  // Check package.json for React/Vue/Angular/Svelte
  const pkgPath = join(codebasePath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps.react || allDeps["react-dom"] || allDeps.next || allDeps.gatsby) frameworks.push("react");
      if (allDeps.vue || allDeps.nuxt) frameworks.push("vue");
      if (allDeps["@angular/core"]) frameworks.push("angular");
      if (allDeps.svelte || allDeps["@sveltejs/kit"]) frameworks.push("svelte");
    } catch {}
  }

  // Check mix.exs for Phoenix/LiveView
  const mixPath = join(codebasePath, "mix.exs");
  if (existsSync(mixPath)) {
    try {
      const mix = readFileSync(mixPath, "utf-8");
      if (/phoenix|live_view/.test(mix)) frameworks.push("phoenix");
    } catch {}
  }

  // Check for plain HTML if no framework detected
  if (frameworks.length === 0) {
    // Quick check for .html files in common locations
    const htmlDirs = ["", "src", "public", "templates", "views", "pages"];
    for (const dir of htmlDirs) {
      const checkPath = join(codebasePath, dir);
      if (existsSync(checkPath)) {
        try {
          const { execSync } = require("child_process");
          const count = execSync(
            `find "${checkPath}" -maxdepth 2 -name "*.html" -o -name "*.htm" 2>/dev/null | head -5 | wc -l`,
            { encoding: "utf-8", timeout: 3000 }
          ).trim();
          if (parseInt(count) > 0) { frameworks.push("html"); break; }
        } catch {}
      }
    }
  }

  return frameworks;
}

// eslint flat config for jsx-a11y (written to temp file)
const JSX_A11Y_CONFIG = `
import jsxA11y from "eslint-plugin-jsx-a11y";

export default [
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/anchor-is-valid": "warn",
      "jsx-a11y/aria-activedescendant-has-tabindex": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-proptypes": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/autocomplete-valid": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/control-has-associated-label": "warn",
      "jsx-a11y/heading-has-content": "error",
      "jsx-a11y/html-has-lang": "error",
      "jsx-a11y/iframe-has-title": "error",
      "jsx-a11y/img-redundant-alt": "warn",
      "jsx-a11y/interactive-supports-focus": "error",
      "jsx-a11y/label-has-associated-control": "error",
      "jsx-a11y/media-has-caption": "error",
      "jsx-a11y/mouse-events-have-key-events": "error",
      "jsx-a11y/no-access-key": "warn",
      "jsx-a11y/no-aria-hidden-on-focusable": "error",
      "jsx-a11y/no-autofocus": "warn",
      "jsx-a11y/no-distracting-elements": "error",
      "jsx-a11y/no-interactive-element-to-noninteractive-role": "warn",
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/no-noninteractive-element-to-interactive-role": "warn",
      "jsx-a11y/no-noninteractive-tabindex": "warn",
      "jsx-a11y/no-redundant-roles": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "jsx-a11y/prefer-tag-over-role": "warn",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      "jsx-a11y/scope": "error",
      "jsx-a11y/tabindex-no-positive": "error",
    },
  },
];
`;

/**
 * Transform ESLint JSON output into our standard findings format.
 */
function transformEslintResults(eslintOutput, codebasePath) {
  const findings = [];

  for (const file of eslintOutput) {
    if (!file.messages || file.messages.length === 0) continue;

    // Make path relative to codebase
    const relPath = file.filePath.replace(codebasePath + "/", "").replace(codebasePath, "");

    for (const msg of file.messages) {
      const ruleId = msg.ruleId || "unknown";
      const severity = msg.severity === 2 ? "high" : "warning";

      findings.push({
        severity,
        ruleId,
        title: `${ruleId}: ${msg.message}`,
        file: relPath,
        line: msg.line || 0,
        column: msg.column || 0,
        detail: msg.message,
        evidence: `${relPath}:${msg.line || 0}`,
        tool: "eslint-plugin-jsx-a11y",
      });
    }
  }

  return findings;
}

/**
 * Run the static accessibility linter against a codebase.
 * Returns structured findings or null if not applicable/failed.
 */
export async function runA11yLinter(codebasePath, outputDir) {
  const frameworks = detectUIFramework(codebasePath);
  const aLog = log.child({ component: "a11y-linter" });

  if (frameworks.length === 0) {
    aLog.info("No UI framework detected, skipping static a11y linter");
    return null;
  }

  aLog.info("UI frameworks detected", { frameworks });

  // For now, only React/JSX gets the linter (most mature plugin)
  if (!frameworks.includes("react")) {
    aLog.info("No React framework detected, skipping eslint-plugin-jsx-a11y (other frameworks planned)");
    return null;
  }

  const start = Date.now();
  aLog.info("Running eslint-plugin-jsx-a11y");

  // Write temporary eslint config
  const configDir = join(outputDir, "_a11y_linter");
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, "eslint.config.mjs");
  writeFileSync(configPath, JSX_A11Y_CONFIG);

  // Write a minimal package.json so eslint resolves the plugin
  writeFileSync(join(configDir, "package.json"), JSON.stringify({
    name: "a11y-lint-temp",
    type: "module",
    dependencies: {
      "eslint": "*",
      "eslint-plugin-jsx-a11y": "*",
    },
  }));

  // Install the plugin
  try {
    const { execSync } = await import("child_process");
    execSync("npm install --no-audit --no-fund --loglevel=error", {
      cwd: configDir,
      timeout: 60000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    aLog.warn("Failed to install eslint-plugin-jsx-a11y", { error: err.message });
    return null;
  }

  // Find source directories to lint
  const srcDirs = ["src", "app", "components", "pages", "lib", "frontend/src"];
  const targetDirs = srcDirs
    .map(d => join(codebasePath, d))
    .filter(d => existsSync(d));

  if (targetDirs.length === 0) {
    // Fall back to linting the whole codebase
    targetDirs.push(codebasePath);
  }

  return new Promise((resolve) => {
    const eslintBin = join(configDir, "node_modules", ".bin", "eslint");
    const args = [
      "--config", configPath,
      "--format", "json",
      "--no-error-on-unmatched-pattern",
      ...targetDirs,
    ];

    const proc = spawn(eslintBin, args, {
      timeout: 120000, // 2 min max
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

      // ESLint exits 1 when it finds issues — that's expected
      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch {}

      if (parsed && Array.isArray(parsed)) {
        const findings = transformEslintResults(parsed, codebasePath);
        const result = {
          tool: "eslint-plugin-jsx-a11y",
          frameworks,
          totalFiles: parsed.length,
          filesWithIssues: parsed.filter(f => f.errorCount + f.warningCount > 0).length,
          totalErrors: parsed.reduce((n, f) => n + f.errorCount, 0),
          totalWarnings: parsed.reduce((n, f) => n + f.warningCount, 0),
          findings,
        };

        writeFileSync(join(outputDir, "a11y_linter.json"), JSON.stringify(result, null, 2));
        aLog.info(`eslint-plugin-jsx-a11y completed in ${elapsed}s`, {
          files: result.totalFiles,
          errors: result.totalErrors,
          warnings: result.totalWarnings,
          findings: findings.length,
        });
        resolve(result);
      } else {
        if (stdout || stderr) {
          writeFileSync(join(outputDir, "a11y_linter_raw.txt"), stdout || stderr);
        }
        aLog.warn(`eslint-plugin-jsx-a11y completed in ${elapsed}s (could not parse output)`, { code });
        resolve(null);
      }
    });

    proc.on("error", (err) => {
      aLog.warn("eslint-plugin-jsx-a11y failed", { error: err.message });
      resolve(null);
    });
  });
}
