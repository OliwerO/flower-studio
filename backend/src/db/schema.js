// Postgres schema — Drizzle table definitions.
//
// Phase 1 added `system_meta`. Phase 2.5 added `audit_log`.
// Phase 3 adds `stock` + `parity_log`. Each entity arrives in this file
// as its phase begins.

import {
  pgTable, text, timestamp, jsonb, bigserial, index, uuid,
  integer, numeric, boolean, date, uniqueIndex,
} from 'drizzle-orm/pg-core';

// Single-row-per-key tracking. Phase 3+ writes rows like
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

// ── Stock ──
// Mirrors the Airtable Stock table's writable fields, plus:
//   - id (UUID): post-cutover canonical id
//   - airtable_id: the original recXXX, kept for the lifetime of the cutover
//     window. Lets routes that still pass an Airtable id resolve to the PG
//     row. We keep this column even after cutover so the audit trail and
//     legacy receipts remain searchable.
//   - deleted_at: soft delete (Phase 2.5 contract). All list queries auto-filter.
//
// Field naming: snake_case columns map to the Airtable display names via the
// repo's `pgToResponse` / `responseToPg` helpers — the wire format stays
// identical to today's Airtable response so frontends don't notice the swap.
//
// `current_quantity` is integer not numeric — every site we read or write it
// goes through Number() and integer math, and Airtable returns it as a JS
// number. Money fields (cost/sell) stay numeric(10,2) because they're often
// fractional zł.
//
// `substitute_for` is text[] (Airtable record ids) for the Phase 3 window;
// after Phase 4 it migrates to a proper FK array referencing stock.id.
export const stock = pgTable('stock', {
  id: uuid('id').primaryKey().defaultRandom(),
  airtableId: text('airtable_id'),  // recXXX during cutover; null for PG-native rows post-Phase 7
  displayName: text('display_name').notNull(),
  purchaseName: text('purchase_name'),
  category: text('category'),
  currentQuantity: integer('current_quantity').notNull().default(0),
  unit: text('unit'),
  currentCostPrice: numeric('current_cost_price', { precision: 10, scale: 2 }),
  currentSellPrice: numeric('current_sell_price', { precision: 10, scale: 2 }),
  supplier: text('supplier'),
  reorderThreshold: integer('reorder_threshold'),
  active: boolean('active').notNull().default(true),
  supplierNotes: text('supplier_notes'),
  deadStems: integer('dead_stems').notNull().default(0),
  lotSize: integer('lot_size'),
  farmer: text('farmer'),
  lastRestocked: date('last_restocked'),
  // text[] of Airtable record ids during cutover. PG syntax: text('substitute_for').array()
  substituteFor: text('substitute_for').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  // Unique mapping during cutover — backfill writes one row per Airtable rec.
  airtableIdx: uniqueIndex('stock_airtable_id_idx').on(table.airtableId),
  // Common filter: active + non-deleted.
  activeIdx: index('stock_active_idx').on(table.active, table.deletedAt),
  // Lookup by display name (substitute resolution + auto-create dedup).
  nameIdx: index('stock_display_name_idx').on(table.displayName),
}));

// ── Parity log ──
// During Phase 3 shadow-write, every mutation runs against both Airtable and
// Postgres. Reads stay on Airtable but on a sampled basis we re-fetch the PG
// row and compare. Any mismatch (different field value, missing row on either
// side) lands here so we can investigate before flipping to PG-only.
//
// Key: shadow-write is HOW we know it's safe to flip. Without parity_log we'd
// be flying blind into the Phase 3d cutover.
export const parityLog = pgTable('parity_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  entityType: text('entity_type').notNull(),         // 'stock' | 'order' | ...
  entityId:   text('entity_id').notNull(),           // Airtable id during cutover
  kind:       text('kind').notNull(),                // 'missing_pg' | 'missing_at' | 'field_mismatch' | 'write_failed'
  field:      text('field'),                         // populated on field_mismatch
  airtableValue: jsonb('airtable_value'),            // null if missing_at
  postgresValue: jsonb('postgres_value'),            // null if missing_pg
  context:    jsonb('context'),                      // { route, mode, error?, requestId? }
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  entityIdx:  index('parity_log_entity_idx').on(table.entityType, table.entityId, table.createdAt),
  kindIdx:    index('parity_log_kind_idx').on(table.entityType, table.kind, table.createdAt),
  createdIdx: index('parity_log_created_idx').on(table.createdAt),
}));
