/**
 * Structured JSON logger.
 *
 * Provides leveled logging (info, warn, error, debug) with JSON output
 * and support for context fields (runId, agentKey, passIndex, etc.).
 *
 * Uses a lightweight custom implementation — no external dependencies.
 */

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || "info"] || LOG_LEVELS.info;

function formatEntry(level, msg, fields) {
  const entry = {
    level,
    time: new Date().toISOString(),
    msg,
    ...fields,
  };
  return JSON.stringify(entry);
}

function createLogger(baseFields = {}) {
  const logger = {
    debug(msg, fields = {}) {
      if (currentLevel <= LOG_LEVELS.debug) {
        process.stdout.write(formatEntry("debug", msg, { ...baseFields, ...fields }) + "\n");
      }
    },
    info(msg, fields = {}) {
      if (currentLevel <= LOG_LEVELS.info) {
        process.stdout.write(formatEntry("info", msg, { ...baseFields, ...fields }) + "\n");
      }
    },
    warn(msg, fields = {}) {
      if (currentLevel <= LOG_LEVELS.warn) {
        process.stderr.write(formatEntry("warn", msg, { ...baseFields, ...fields }) + "\n");
      }
    },
    error(msg, fields = {}) {
      if (currentLevel <= LOG_LEVELS.error) {
        process.stderr.write(formatEntry("error", msg, { ...baseFields, ...fields }) + "\n");
      }
    },
    /**
     * Create a child logger with additional context fields.
     * @param {object} childFields - Fields to merge into every log entry
     * @returns {object} Child logger
     */
    child(childFields) {
      return createLogger({ ...baseFields, ...childFields });
    },
  };
  return logger;
}

const logger = createLogger({ service: "aif" });

export default logger;
