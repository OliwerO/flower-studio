// lab/factories/auditLog.js
//
// Synthetic audit_log row — matches backend/src/db/schema.js `auditLog` table.
// Used to seed Y-model trace events that have NO dedicated source table — chiefly
// `premade_dissolved`, the 5th trace event type (see stockRepo.getUsageByExactId
// step 5). The dissolve event's date derives from created_at, so callers MUST pass
// a FIXED created_at literal for determinism (never let it default to "now").
//
// Schema: id (bigserial — auto, OMITTED so Postgres assigns it),
//         entity_type (NOT NULL), entity_id (TEXT NOT NULL), action (NOT NULL),
//         diff (jsonb NOT NULL — { before, after }), actor_role (NOT NULL),
//         actor_pin_label (nullable), created_at (timestamptz NOT NULL)
//
// Factory-only shaping keys (stripped from output):
//   stockId → maps to entity_id (the stock row the event is about)

export function makeAuditLog(overrides = {}) {
  // Extract factory-only shaping keys — never included in the returned row.
  const { stockId, ...columnOverrides } = overrides;

  return {
    // NOTE: no `id` — entity_id/created_at carry identity; id is a bigserial PK
    // that Postgres assigns. Emitting it would break the serial sequence.
    entity_type: columnOverrides.entity_type ?? 'stock',
    entity_id: stockId ?? columnOverrides.entity_id ?? null,
    action: columnOverrides.action ?? 'premade_dissolved',
    diff: columnOverrides.diff ?? { before: null, after: {} },
    actor_role: columnOverrides.actor_role ?? 'owner',
    actor_pin_label: columnOverrides.actor_pin_label ?? null,
    // Fixed default so seeded events plot at a deterministic date. Callers that
    // care about the trace date should always pass an explicit literal.
    created_at: columnOverrides.created_at ?? '2026-01-01T00:00:00Z',
    // Apply column-level overrides last, excluding factory-only keys already handled.
    ...columnOverrides,
    // Ensure entity_id is always correct (shorthand takes priority).
    entity_id: stockId ?? columnOverrides.entity_id ?? null,
  };
}
