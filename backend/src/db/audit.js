// Audit log writer.
//
// Repos call recordAudit(...) inside the same transaction as the entity
// write, so the log can never disagree with the data. No background queue,
// no fire-and-forget — auditing is part of the write, not an observer.
//
// This module is HTTP-agnostic: it takes `actorRole` + `actorPinLabel`
// as primitives, never an Express request. Routes/repos use
// `actorFromReq()` (utils/actor.js) to bridge from HTTP to these
// primitives.
//
// Usage from a repo (Phase 3+):
//   await db.transaction(async (tx) => {
//     const before = await tx.select(...).from(stock).where(eq(stock.id, id));
//     const [after] = await tx.update(stock).set(fields).where(...).returning();
//     await recordAudit(tx, {
//       entityType: 'stock',
//       entityId:   id,
//       action:     'update',
//       before:     before[0] ?? null,
//       after,
//       ...actorFromReq(req),
//     });
//   });

import { auditLog } from './schema.js';

// Compute a minimal diff: only keys whose value actually changed.
// Stored as { before: { onlyChanged }, after: { onlyChanged } } so the
// jsonb column stays small. For create/delete, the opposite side is null.
function minimalDiff(before, after) {
  if (!before && after) return { before: null, after };
  if (before && !after) return { before, after: null };
  if (!before && !after) return { before: null, after: null };

  const beforeChanged = {};
  const afterChanged  = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      beforeChanged[k] = before[k] ?? null;
      afterChanged[k]  = after[k]  ?? null;
    }
  }
  return { before: beforeChanged, after: afterChanged };
}

/**
 * Record an audit entry. `tx` is a Drizzle transaction (or top-level db) —
 * pass the same one used for the entity write so the log lands atomically.
 *
 * @param {object} tx                       Drizzle transaction or db instance
 * @param {object} args
 * @param {string} args.entityType          'stock' | 'order' | 'customer' | ...
 * @param {string} args.entityId            DB id (uuid in PG, or recXXX during shadow)
 * @param {string} args.action              'create' | 'update' | 'delete' | 'restore' | 'purge'
 * @param {object|null} args.before         Pre-write state (null for create)
 * @param {object|null} args.after          Post-write state (null for delete)
 * @param {string} args.actorRole           'owner' | 'florist' | 'driver' | 'webhook' | 'system'
 * @param {string|null} [args.actorPinLabel]  Driver name for driver writes; null otherwise
 */
export async function recordAudit(tx, {
  entityType, entityId, action, before, after, actorRole, actorPinLabel = null,
}) {
  if (!tx) throw new Error('recordAudit: tx (drizzle handle) is required');
  if (!actorRole) throw new Error('recordAudit: actorRole is required');
  await tx.insert(auditLog).values({
    entityType,
    entityId,
    action,
    diff: minimalDiff(before, after),
    actorRole,
    actorPinLabel,
  });
}

// Exposed for tests — minimalDiff is independently useful and the repo
// tests in Phase 3+ will assert on its output.
export const _internal = { minimalDiff };
