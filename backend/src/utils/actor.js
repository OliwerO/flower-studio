// Maps an Express request to the primitive fields the audit log persists.
// Lives here (not in db/audit.js) so the DB layer doesn't import any HTTP
// concept — repos and routes both call this; the audit helper itself just
// takes { actorRole, actorPinLabel }.

/**
 * Extract actor identity from an authenticated Express request.
 * `req.role` is set by middleware/auth.js. For driver PINs we include the
 * named driver bucket as `actorPinLabel`; we never persist the PIN itself.
 *
 * Falls back to { actorRole: 'system', actorPinLabel: null } when no req
 * is available (e.g., webhook processing, scheduled jobs).
 */
export function actorFromReq(req) {
  if (!req || !req.role) return { actorRole: 'system', actorPinLabel: null };
  if (req.role === 'driver') {
    return { actorRole: 'driver', actorPinLabel: req.driverName ?? null };
  }
  return { actorRole: req.role, actorPinLabel: null };
}
