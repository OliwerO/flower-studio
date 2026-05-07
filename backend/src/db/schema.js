// Postgres schema — Drizzle table definitions.
//
// Phase 1 added `system_meta`. Phase 2.5 added `audit_log`.
// Phase 3 added `stock` + `parity_log`.
// Phase 4 adds `orders` + `order_lines` + `deliveries` (the trio that
// always migrates together — see docs/migration/phase-4-orders-design.md).

import {
  pgTable, text, timestamp, jsonb, bigserial, index, uuid,
  integer, numeric, boolean, date, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { isNotNull, and } from 'drizzle-orm';

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
// ── Phase 4: Orders ──
//
// Why text columns for status / payment_status / delivery_type instead of
// pgEnum: the Airtable single-select fields were always loose strings on
// the frontend, and the JS state machine in `backend/src/constants/statuses.js`
// is the single source of truth. Using text here means adding a new status
// value is a JS-only change — no migration needed.
//
// Why customer_id is text not uuid FK: Customers don't migrate until
// Phase 5. customer_id holds the Airtable rec id (recXXX) during the
// Phase 4 cutover window, then gets ALTER'd to uuid + FK in Phase 5.
//
// `app_order_id` is the human-facing identifier (e.g. "BLO-20260428-1");
// already unique in Airtable, kept unique here.
export const orders = pgTable('orders', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  airtableId:         text('airtable_id'),
  // Wix webhook idempotency key. Partial-unique so non-Wix orders
  // (NULL value) don't collide. Migrated in 0004.
  wixOrderId:         text('wix_order_id'),
  appOrderId:         text('app_order_id').notNull(),
  customerId:         text('customer_id').notNull(),
  status:             text('status').notNull().default('New'),
  deliveryType:       text('delivery_type').notNull(),  // 'Delivery' | 'Pickup'
  orderDate:          date('order_date').notNull().defaultNow(),
  requiredBy:         date('required_by'),
  deliveryTime:       text('delivery_time'),
  customerRequest:    text('customer_request'),
  notesOriginal:      text('notes_original'),
  floristNote:        text('florist_note'),
  greetingCardText:   text('greeting_card_text'),
  source:             text('source'),
  communicationMethod: text('communication_method'),
  paymentStatus:      text('payment_status').notNull().default('Unpaid'),
  paymentMethod:      text('payment_method'),
  priceOverride:      numeric('price_override', { precision: 10, scale: 2 }),
  deliveryFee:        numeric('delivery_fee', { precision: 10, scale: 2 }),
  createdBy:          text('created_by'),
  payment1Amount:     numeric('payment_1_amount', { precision: 10, scale: 2 }),
  payment1Method:     text('payment_1_method'),
  imageUrl:           text('image_url'),
  keyPersonId:        uuid('key_person_id'),  // nullable FK → key_people; set at order creation (issue #216)
  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:          timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  airtableIdx:    uniqueIndex('orders_airtable_id_idx').on(table.airtableId),
  appOrderIdIdx:  uniqueIndex('orders_app_order_id_idx').on(table.appOrderId),
  wixOrderIdIdx:  uniqueIndex('orders_wix_order_id_idx').on(table.wixOrderId),
  customerDateIdx: index('orders_customer_date_idx').on(table.customerId, table.orderDate),
  // Drives "today's work" queries (dashboard tab) — narrow partial index keeps it cheap.
  activeStatusIdx: index('orders_active_status_idx').on(table.status, table.requiredBy),
  deletedIdx:     index('orders_deleted_idx').on(table.deletedAt),
  keyPersonIdx:   index('orders_key_person_id_idx').on(table.keyPersonId),
}));

// ── Phase 4: Order Lines ──
//
// `stock_item_id` is text (not uuid FK) for the same reason as orders.customer_id:
// it carries the Airtable rec id (recXXX) during the cutover window. After Phase 7
// retires Airtable, the rec ids may be replaced by stock.id uuids in a backfill,
// but that's a downstream cleanup — Phase 4 itself doesn't depend on it.
//
// ON DELETE CASCADE: hard-deleting an order removes its lines automatically. This
// matches `orderService.deleteOrder()`'s manual unwinding logic — once enforced
// at the schema, the JS code stops being the lone enforcer.
export const orderLines = pgTable('order_lines', {
  id:                uuid('id').primaryKey().defaultRandom(),
  airtableId:        text('airtable_id'),
  orderId:           uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  stockItemId:       text('stock_item_id'),  // recXXX or null (orphan); validated by JS layer
  flowerName:        text('flower_name').notNull(),
  quantity:          integer('quantity').notNull().default(0),
  costPricePerUnit:  numeric('cost_price_per_unit', { precision: 10, scale: 2 }),
  sellPricePerUnit:  numeric('sell_price_per_unit', { precision: 10, scale: 2 }),
  stockDeferred:     boolean('stock_deferred').notNull().default(false),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:         timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  airtableIdx: uniqueIndex('order_lines_airtable_id_idx').on(table.airtableId),
  orderIdx:    index('order_lines_order_id_idx').on(table.orderId),
  stockIdx:    index('order_lines_stock_item_id_idx').on(table.stockItemId),
}));

// ── Phase 4: Deliveries ──
//
// One delivery per order — enforced as `unique(order_id)` at the DB level. Today
// nothing in code prevents two deliveries from being created for one order; this
// constraint catches that bug class permanently.
export const deliveries = pgTable('deliveries', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  airtableId:         text('airtable_id'),
  orderId:            uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  deliveryAddress:    text('delivery_address'),
  recipientName:      text('recipient_name'),
  recipientPhone:     text('recipient_phone'),
  deliveryDate:       date('delivery_date'),
  deliveryTime:       text('delivery_time'),
  assignedDriver:     text('assigned_driver'),
  deliveryFee:        numeric('delivery_fee', { precision: 10, scale: 2 }),
  driverInstructions: text('driver_instructions'),
  deliveryMethod:     text('delivery_method'),  // 'Driver' | 'Self'
  driverPayout:       numeric('driver_payout', { precision: 10, scale: 2 }),
  status:             text('status').notNull().default('Pending'),
  // Stamped by the route layer when Status flips to Delivered. Migrated in 0004.
  deliveredAt:        timestamp('delivered_at', { withTimezone: true }),
  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:          timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  airtableIdx:    uniqueIndex('deliveries_airtable_id_idx').on(table.airtableId),
  orderIdx:       uniqueIndex('deliveries_order_id_idx').on(table.orderId),
  driverDateIdx:  index('deliveries_driver_date_idx').on(table.assignedDriver, table.deliveryDate),
  statusDateIdx:  index('deliveries_status_date_idx').on(table.status, table.deliveryDate),
}));

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

// ── Phase 5: Customers ──
//
// customers.airtable_id stays populated for all rows backfilled from Airtable.
// Rows created post-cutover have airtable_id = NULL.
//
// orders.customer_id is text during Phase 4-5 transition (holds recXXX).
// backfill-customer-fk.js converts the values to UUID strings; a future
// cleanup migration can ALTER COLUMN + add the formal FK constraint.
export const customers = pgTable('customers', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  airtableId:          text('airtable_id'),
  name:                text('name').notNull(),
  nickname:            text('nickname'),
  phone:               text('phone'),
  email:               text('email'),
  link:                text('link'),
  language:            text('language'),
  homeAddress:         text('home_address'),
  sexBusiness:         text('sex_business'),
  segment:             text('segment'),
  foundUsFrom:         text('found_us_from'),
  communicationMethod: text('communication_method'),
  orderSource:         text('order_source'),
  createdAt:           timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:           timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  airtableIdx: uniqueIndex('customers_airtable_id_idx').on(table.airtableId),
  nameIdx:     index('customers_name_idx').on(table.name),
  phoneIdx:    index('customers_phone_idx').on(table.phone),
  deletedIdx:  index('customers_deleted_idx').on(table.deletedAt),
}));

// Unlimited key people per customer. The 2-slot UI limit was an Airtable
// constraint — PG has no limit. First two rows (by created_at) map to
// 'Key person 1' / 'Key person 2' in the wire format for backward compat.
export const keyPeople = pgTable('key_people', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  customerId:         uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  name:               text('name').notNull(),
  contactDetails:     text('contact_details'),
  importantDate:      date('important_date'),
  importantDateLabel: text('important_date_label'),
  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:          timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  customerIdx: index('key_people_customer_id_idx').on(table.customerId),
}));

// Read-only post-backfill. Schema is intentionally incompatible with orders
// (no status, no lines, no delivery FK) — kept separate, not attempted as a join.
export const legacyOrders = pgTable('legacy_orders', {
  id:          uuid('id').primaryKey().defaultRandom(),
  airtableId:  text('airtable_id').notNull(),
  customerId:  uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  orderDate:   date('order_date'),
  description: text('description'),
  amount:      numeric('amount', { precision: 10, scale: 2 }),
  raw:         jsonb('raw').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  airtableIdx: uniqueIndex('legacy_orders_airtable_id_idx').on(table.airtableId),
  customerIdx: index('legacy_orders_customer_id_idx').on(table.customerId),
}));

// ── Phase 6: Config + log tables ──

export const appConfig = pgTable('app_config', {
  key:       text('key').primaryKey(),
  value:     jsonb('value').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const floristHours = pgTable('florist_hours', {
  id:            uuid('id').primaryKey().defaultRandom(),
  airtableId:    text('airtable_id'),
  name:          text('name').notNull(),
  date:          date('date').notNull(),
  hours:         numeric('hours', { precision: 8, scale: 2 }).notNull().default('0'),
  hourlyRate:    numeric('hourly_rate', { precision: 8, scale: 2 }).notNull().default('0'),
  rateType:      text('rate_type'),
  bonus:         numeric('bonus', { precision: 8, scale: 2 }).notNull().default('0'),
  deduction:     numeric('deduction', { precision: 8, scale: 2 }).notNull().default('0'),
  notes:         text('notes').notNull().default(''),
  deliveryCount: integer('delivery_count').notNull().default(0),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:     timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  airtableIdx: uniqueIndex('florist_hours_airtable_id_idx').on(t.airtableId).where(isNotNull(t.airtableId)),
  dateIdx:     index('florist_hours_date_idx').on(t.date),
  nameIdx:     index('florist_hours_name_idx').on(t.name),
}));

export const marketingSpend = pgTable('marketing_spend', {
  id:         uuid('id').primaryKey().defaultRandom(),
  airtableId: text('airtable_id'),
  month:      date('month').notNull(),
  channel:    text('channel').notNull(),
  amount:     numeric('amount', { precision: 10, scale: 2 }).notNull(),
  notes:      text('notes').notNull().default(''),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  airtableIdx: uniqueIndex('marketing_spend_airtable_id_idx').on(t.airtableId).where(isNotNull(t.airtableId)),
  monthIdx:    index('marketing_spend_month_idx').on(t.month),
}));

export const stockLossLog = pgTable('stock_loss_log', {
  id:         uuid('id').primaryKey().defaultRandom(),
  airtableId: text('airtable_id'),
  date:       date('date').notNull(),
  stockId:    uuid('stock_id').references(() => stock.id, { onDelete: 'set null' }),
  quantity:   numeric('quantity', { precision: 8, scale: 2 }).notNull(),
  reason:     text('reason').notNull(),
  notes:      text('notes').notNull().default(''),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  airtableIdx: uniqueIndex('stock_loss_log_airtable_id_idx').on(t.airtableId).where(isNotNull(t.airtableId)),
  dateIdx:     index('stock_loss_log_date_idx').on(t.date),
  stockIdx:    index('stock_loss_log_stock_id_idx').on(t.stockId),
}));

export const webhookLog = pgTable('webhook_log', {
  id:          uuid('id').primaryKey().defaultRandom(),
  wixOrderId:  text('wix_order_id').notNull(),
  status:      text('status').notNull(),
  timestamp:   timestamp('timestamp', { withTimezone: true }).notNull(),
  appOrderId:  text('app_order_id'),
  error:       text('error'),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  wixOrderIdx: index('webhook_log_wix_order_id_idx').on(t.wixOrderId),
  tsIdx:       index('webhook_log_timestamp_idx').on(t.timestamp),
}));

export const syncLog = pgTable('sync_log', {
  id:           uuid('id').primaryKey().defaultRandom(),
  timestamp:    timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  status:       text('status').notNull(),
  newProducts:  integer('new_products').notNull().default(0),
  updated:      integer('updated').notNull().default(0),
  deactivated:  integer('deactivated').notNull().default(0),
  priceSyncs:   integer('price_syncs').notNull().default(0),
  stockSyncs:   integer('stock_syncs').notNull().default(0),
  errorMessage: text('error_message').notNull().default(''),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tsIdx: index('sync_log_timestamp_idx').on(t.timestamp),
}));

export const feedbackReports = pgTable('feedback_reports', {
  id:                uuid('id').primaryKey().defaultRandom(),
  githubIssueNumber: integer('github_issue_number').notNull(),
  reporterRole:      text('reporter_role').notNull(),
  reporterName:      text('reporter_name').notNull(),
  telegramChatId:    text('telegram_chat_id'),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const productConfig = pgTable('product_config', {
  id:           uuid('id').primaryKey().defaultRandom(),
  airtableId:   text('airtable_id'),
  wixProductId: text('wix_product_id'),
  wixVariantId: text('wix_variant_id'),
  productName:  text('product_name').notNull().default(''),
  variantName:  text('variant_name').notNull().default(''),
  sortOrder:    integer('sort_order').notNull().default(0),
  imageUrl:     text('image_url').notNull().default(''),
  price:        numeric('price', { precision: 10, scale: 2 }).notNull().default('0'),
  leadTimeDays: integer('lead_time_days').notNull().default(1),
  active:       boolean('active').notNull().default(true),
  visibleInWix: boolean('visible_in_wix').notNull().default(true),
  productType:  text('product_type'),
  minStems:     integer('min_stems').notNull().default(0),
  description:  text('description').notNull().default(''),
  category:     text('category'),
  keyFlower:    text('key_flower'),
  quantity:     integer('quantity'),
  availableFrom: date('available_from'),
  availableTo:   date('available_to'),
  translations:  jsonb('translations').notNull().default({}),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:     timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  airtableIdx: uniqueIndex('product_config_airtable_id_idx').on(t.airtableId).where(isNotNull(t.airtableId)),
  wixPairIdx:  uniqueIndex('product_config_wix_pair_idx').on(t.wixProductId, t.wixVariantId).where(and(isNotNull(t.wixProductId), isNotNull(t.wixVariantId))),
  productIdx:  index('product_config_wix_product_id_idx').on(t.wixProductId),
  activeIdx:   index('product_config_active_idx').on(t.active),
}));
