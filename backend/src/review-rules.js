/**
 * Documented override constraints (docs/framework/track-routing.md):
 * escalation to Track 4 is always permitted; de-escalation below Track 4 is
 * never permitted while an escalation condition applies; de-escalation from
 * Track 4 is admin-only.
 *
 * Kept in its own module (rather than inline in routes/review.js) because
 * routes/review.js transitively imports auth/middleware.js -> auth/jwt.js,
 * which calls process.exit(1) at import time if JWT_SECRET is unset. That
 * makes routes/review.js unsafe to import directly from unit tests that
 * don't set JWT_SECRET. This module has no imports and no side effects.
 */
export function canOverrideTrack({ oldTrack, newTrack, escalations, role }) {
  if (newTrack === 4) return { allowed: true };
  if ((escalations || []).length > 0 && newTrack < 4) {
    return { allowed: false, reason: "Escalation conditions still apply; the tool cannot be routed below Track 4." };
  }
  if (oldTrack === 4 && newTrack < 4 && role !== "admin") {
    return { allowed: false, reason: "De-escalation from Track 4 requires an admin." };
  }
  return { allowed: true };
}
