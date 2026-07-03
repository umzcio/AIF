/**
 * Registry status state machine — TRANSITIONS map and canTransition().
 *
 * Kept in its own module (rather than inline in routes/registry.js) because
 * routes/registry.js transitively imports auth/middleware.js -> auth/jwt.js,
 * which calls process.exit(1) at import time if JWT_SECRET is unset. That
 * makes routes/registry.js unsafe to import directly from unit tests that
 * don't set JWT_SECRET. This module has no imports and no side effects.
 * (Same pattern as review-rules.js for routes/review.js.)
 */

// Valid status transitions: { fromStatus: { role: [toStatuses] } }
//
// The "system" key documents transitions the pipeline performs via direct SQL
// (backend/src/pipeline/queue.js — pending->in_progress on run start,
// in_progress->under_review/active on run completion). It is NOT HTTP-reachable:
// canTransition() below only honors the caller's actual role, never "system".
// Every transition a real HTTP caller needs already has an explicit role key
// (admin duplicates the system entries where admins need equivalent access).
export const TRANSITIONS = {
  draft:             { builder: ["pending"], admin: ["pending"] },
  pending:           { system: ["in_progress"], admin: ["in_progress"] },
  in_progress:       { system: ["under_review", "active"], admin: ["under_review", "active"] },
  under_review:      { reviewer: ["approved", "changes_requested"], admin: ["approved", "changes_requested", "active"] },
  approved:          { reviewer: ["active"], admin: ["active"] },
  changes_requested: { builder: ["pending"], admin: ["pending"] },
  active:            { reviewer: ["under_review", "suspended"], admin: ["under_review", "suspended", "retired"], builder: ["retired"] },
  suspended:         { reviewer: ["under_review"], admin: ["under_review", "active"] },
};

export function canTransition(fromStatus, toStatus, role) {
  const allowed = TRANSITIONS[fromStatus];
  if (!allowed) return false;
  const roleAllowed = allowed[role] || [];
  return roleAllowed.includes(toStatus);
}
