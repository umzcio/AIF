/**
 * Tiny dependency-free structural validator for a JSON-Schema subset.
 *
 * Enforces only what we need to catch genuinely malformed model output —
 * declared `required` keys present, declared `type` matches, and array
 * `items` type matches. Deliberately does NOT enforce `additionalProperties`,
 * `enum`, `minimum`/`maximum`, or "properties not marked required must be
 * present" — the agent schema.js files describe the ideal shape but real
 * model output legitimately omits optional fields or includes extras, and
 * this validator must not reject output that the working pipeline already
 * accepts. When a constraint isn't one of the three above, we pass.
 *
 * No ajv, no external dependency — used to gate acceptance in direct-api.js.
 */

const TYPE_CHECKERS = {
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && !Number.isNaN(v),
  integer: (v) => typeof v === "number" && Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  null: (v) => v === null,
};

function typeMatches(value, type) {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => TYPE_CHECKERS[t] ? TYPE_CHECKERS[t](value) : true);
}

/**
 * Recursively validate `value` against `schema`, pushing human-readable
 * messages onto `errors` (with `path` for context) on failure.
 */
function check(value, schema, path, errors) {
  if (!schema || typeof schema !== "object") return; // no constraints — pass

  if (schema.type && !typeMatches(value, schema.type)) {
    errors.push(`${path}: expected type ${JSON.stringify(schema.type)}, got ${Array.isArray(value) ? "array" : value === null ? "null" : typeof value}`);
    return; // type mismatch makes further structural checks meaningless
  }

  if (Array.isArray(schema.required) && value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required) {
      if (!(key in value)) errors.push(`${path}: missing required key "${key}"`);
    }
  }

  if (schema.properties && value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, subSchema] of Object.entries(schema.properties)) {
      if (key in value) check(value[key], subSchema, `${path}.${key}`, errors);
    }
  }

  if (schema.items && Array.isArray(value)) {
    value.forEach((item, i) => check(item, schema.items, `${path}[${i}]`, errors));
  }
}

/**
 * Validate `obj` against a JSON-Schema-subset `schema`.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateAgainstSchema(obj, schema) {
  const errors = [];
  check(obj, schema, "$", errors);
  return { ok: errors.length === 0, errors };
}
