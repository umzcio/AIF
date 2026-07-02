/**
 * Wrap an async Express handler so a rejected promise is routed to the
 * error middleware via next(err) instead of becoming an unhandled rejection
 * that crashes the process (Express 4 does not catch async throws).
 */
export function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
