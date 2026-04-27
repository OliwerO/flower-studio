// Postgres schema — Drizzle table definitions.
//
// Phase 1 added `system_meta`. Phase 2.5 adds `audit_log`.
// Phase 3 will add `stock` + `parity_log`. Each entity arrives in this file
// as its phase begins.

import { pgTable, text, timestamp, jsonb, bigserial, index } from 'drizzle-orm/pg-core';

// Single-row-per-key tracking. Phase 3+ will write rows like
//   ('stock_cutover_at', '2026-05-...') when entity cutovers happen, so
//   audit/admin tooling can show "X has been on PG for N days".
export const systemMeta = pgTable('system_meta', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Audit log — every PG-side write (create / update / delete / restore) lands
// here. Repos call `recordAudit()` in the same transaction as the entity
// write, so the log can never disagree with the data.
//
// Why text, not uuid, for entity_id: during the Phase 3 shadow-write window,
// repos may write the Airtable record id (`recXXX`) until cutover, then
// switch to uuid. Text accepts both without a migration.
//
// Why bigserial, not uuid, for id: this table is single-writer (the backend),
// not distributed. Sequential ids are cheaper, sortable by insert order, and
// avoid a pgcrypto extension dependency in the migration.
export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  entityType: text('entity_type').notNull(),         // 'stock' | 'order' | 'customer' | ...
  entityId:   text('entity_id').notNull(),
  action:     text('action').notNull(),              // 'create' | 'update' | 'delete' | 'restore' | 'purge'
  diff:       jsonb('diff').notNull(),               // { before: {...} | null, after: {...} | null }
  actorRole:  text('actor_role').notNull(),          // 'owner' | 'florist' | 'driver' | 'webhook' | 'system'
  actorPinLabel: text('actor_pin_label'),            // e.g. 'Timur' for driver PINs; never the PIN itself
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // Drives "show me everything that happened to this row" lookups (Admin tab sidebar).
  entityIdx:  index('audit_log_entity_idx').on(table.entityType, table.entityId, table.createdAt),
  // Drives "what changed in the last hour" queries.
  createdIdx: index('audit_log_created_idx').on(table.createdAt),
}));
