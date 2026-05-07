// backend/scripts/backfill-phase6.js
// Category: DESTRUCTIVE
//
// Reads Airtable, writes prod Postgres for Phase 6 tables.
// Idempotent: upserts on airtable_id (safe to re-run).
// Requires owner approval phrase before running.
//
// Tables backfilled:
//   florist_hours       — florist payroll records
//   marketing_spend     — ad spend per channel per month
//   stock_loss_log      — waste events (stock_id FK resolved via PG stock table)
//   product_config      — Wix product/variant config
//
// Tables intentionally skipped (start fresh or self-seed):
//   webhook_log   — operational ephemera, no historical value to migrate
//   sync_log      — operational ephemera, no historical value to migrate
//   app_config    — auto-seeds on boot via settings.js
//
// Usage:
//   node backend/scripts/backfill-phase6.js --approve [--dry-run]
//   BACKFILL_APPROVED=1 node backend/scripts/backfill-phase6.js [--dry-run]

import 'dotenv/config';
import Airtable from 'airtable';
import pg from 'pg';

// ── Approval gate ─────────────────────────────────────────────────────────────
const approved = process.argv.includes('--approve') || process.env.BACKFILL_APPROVED === '1';
if (!approved) {
  console.error(
    '[backfill-phase6] STOP. This script writes to production Postgres.\n' +
    'Pass --approve or set BACKFILL_APPROVED=1 to confirm you have owner approval.',
  );
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) console.log('[backfill-phase6] *** DRY RUN — no data will be written ***\n');

// ── Prerequisites ─────────────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  console.error('[backfill-phase6] DATABASE_URL not set. Aborting.');
  process.exit(1);
}
if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
  console.error('[backfill-phase6] AIRTABLE_API_KEY / AIRTABLE_BASE_ID not set. Aborting.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch all records from an Airtable table, paginating automatically. */
async function fetchAll(tableName, opts = {}) {
  const rows = [];
  await base(tableName).select(opts).eachPage((records, next) => {
    for (const r of records) rows.push(r);
    next();
  });
  return rows;
}

/** Skip a table when the env var isn't configured. */
function tableConfigured(envValue, label) {
  if (!envValue) {
    console.log(`[${label}] AIRTABLE env var not set — skipping.`);
    return false;
  }
  return true;
}

// ── 1. florist_hours ─────────────────────────────────────────────────────────

async function backfillFloristHours() {
  const TABLE = process.env.AIRTABLE_FLORIST_HOURS_TABLE;
  if (!tableConfigured(TABLE, 'florist_hours')) return;

  console.log('[florist_hours] Fetching from Airtable…');
  const rows = await fetchAll(TABLE, {
    fields: ['Name', 'Date', 'Hours', 'Hourly Rate', 'Rate Type', 'Bonus', 'Deduction', 'Notes', 'Delivery Count'],
  });
  console.log(`[florist_hours] Fetched ${rows.length} records.`);

  if (DRY_RUN) {
    console.log(`[florist_hours] [DRY RUN] Would insert/skip up to ${rows.length} rows.\n`);
    return;
  }

  let inserted = 0, skipped = 0, failed = 0;
  for (const r of rows) {
    try {
      const result = await pool.query(
        `INSERT INTO florist_hours
           (airtable_id, name, date, hours, hourly_rate, rate_type, bonus, deduction, notes, delivery_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (airtable_id) WHERE airtable_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          r.id,
          r.get('Name') || '',
          r.get('Date') || null,
          String(Number(r.get('Hours') || 0)),
          String(Number(r.get('Hourly Rate') || 0)),
          r.get('Rate Type') || null,
          String(Number(r.get('Bonus') || 0)),
          String(Number(r.get('Deduction') || 0)),
          r.get('Notes') || '',
          Number(r.get('Delivery Count') || 0),
        ],
      );
      if (result.rows.length > 0) inserted++; else skipped++;
    } catch (err) {
      console.error(`[florist_hours] Failed on ${r.id}:`, err.message);
      failed++;
    }
  }
  console.log(`[florist_hours] inserted=${inserted}, skipped=${skipped}, failed=${failed}\n`);
}

// ── 2. marketing_spend ────────────────────────────────────────────────────────

async function backfillMarketingSpend() {
  const TABLE = process.env.AIRTABLE_MARKETING_SPEND_TABLE;
  if (!tableConfigured(TABLE, 'marketing_spend')) return;

  console.log('[marketing_spend] Fetching from Airtable…');
  const rows = await fetchAll(TABLE, {
    fields: ['Month', 'Channel', 'Amount', 'Notes'],
  });
  console.log(`[marketing_spend] Fetched ${rows.length} records.`);

  if (DRY_RUN) {
    console.log(`[marketing_spend] [DRY RUN] Would insert/skip up to ${rows.length} rows.\n`);
    return;
  }

  let inserted = 0, skipped = 0, failed = 0;
  for (const r of rows) {
    try {
      // Airtable Month field may be a full date string (YYYY-MM-DD); normalise to YYYY-MM-01
      const rawMonth = r.get('Month');
      if (!rawMonth) { skipped++; continue; }
      const month = rawMonth.length === 7 ? `${rawMonth}-01` : rawMonth;

      const result = await pool.query(
        `INSERT INTO marketing_spend
           (airtable_id, month, channel, amount, notes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (airtable_id) WHERE airtable_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          r.id,
          month,
          r.get('Channel') || '',
          String(Number(r.get('Amount') || 0)),
          r.get('Notes') || '',
        ],
      );
      if (result.rows.length > 0) inserted++; else skipped++;
    } catch (err) {
      console.error(`[marketing_spend] Failed on ${r.id}:`, err.message);
      failed++;
    }
  }
  console.log(`[marketing_spend] inserted=${inserted}, skipped=${skipped}, failed=${failed}\n`);
}

// ── 3. stock_loss_log ─────────────────────────────────────────────────────────

async function backfillStockLossLog() {
  const TABLE = process.env.AIRTABLE_STOCK_LOSS_LOG_TABLE;
  if (!tableConfigured(TABLE, 'stock_loss_log')) return;

  // Build airtable_id → PG UUID map from stock table so we can resolve FKs.
  console.log('[stock_loss_log] Building stock airtable_id → PG UUID map…');
  const stockMap = new Map(); // recXXX → UUID
  const { rows: stockRows } = await pool.query('SELECT id, airtable_id FROM stock WHERE airtable_id IS NOT NULL');
  for (const row of stockRows) stockMap.set(row.airtable_id, row.id);
  console.log(`[stock_loss_log] Stock map: ${stockMap.size} entries.`);

  console.log('[stock_loss_log] Fetching from Airtable…');
  const rows = await fetchAll(TABLE, {
    fields: ['Date', 'Stock Item', 'Quantity', 'Reason', 'Notes'],
  });
  console.log(`[stock_loss_log] Fetched ${rows.length} records.`);

  if (DRY_RUN) {
    console.log(`[stock_loss_log] [DRY RUN] Would insert/skip up to ${rows.length} rows.\n`);
    return;
  }

  let inserted = 0, skipped = 0, failed = 0;
  for (const r of rows) {
    try {
      // 'Stock Item' is a linked-record field — array of recXXX strings.
      const stockItemIds = r.get('Stock Item') || [];
      const firstStockId = Array.isArray(stockItemIds) ? stockItemIds[0] : stockItemIds;
      const pgStockId = firstStockId ? (stockMap.get(firstStockId) || null) : null;

      const result = await pool.query(
        `INSERT INTO stock_loss_log
           (airtable_id, date, stock_id, quantity, reason, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (airtable_id) WHERE airtable_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          r.id,
          r.get('Date') || new Date().toISOString().split('T')[0],
          pgStockId,
          String(Number(r.get('Quantity') || 0)),
          r.get('Reason') || 'Other',
          r.get('Notes') || '',
        ],
      );
      if (result.rows.length > 0) inserted++; else skipped++;
    } catch (err) {
      console.error(`[stock_loss_log] Failed on ${r.id}:`, err.message);
      failed++;
    }
  }
  console.log(`[stock_loss_log] inserted=${inserted}, skipped=${skipped}, failed=${failed}\n`);
}

// ── 4. product_config ─────────────────────────────────────────────────────────

async function backfillProductConfig() {
  const TABLE = process.env.AIRTABLE_PRODUCT_CONFIG_TABLE;
  if (!tableConfigured(TABLE, 'product_config')) return;

  console.log('[product_config] Fetching from Airtable…');
  const rows = await fetchAll(TABLE, {
    fields: [
      'Wix Product ID', 'Wix Variant ID', 'Product Name', 'Variant Name',
      'Sort Order', 'Image URL', 'Price', 'Lead Time Days',
      'Active', 'Visible in Wix', 'Product Type', 'Min Stems',
      'Description', 'Category', 'Key Flower', 'Quantity',
      'Available From', 'Available To',
    ],
  });
  console.log(`[product_config] Fetched ${rows.length} records.`);

  if (DRY_RUN) {
    console.log(`[product_config] [DRY RUN] Would insert/skip up to ${rows.length} rows.\n`);
    return;
  }

  let inserted = 0, skipped = 0, failed = 0;
  for (const r of rows) {
    try {
      // Category may be an array in Airtable (multi-select) — join for PG text storage.
      const rawCategory = r.get('Category');
      const category = Array.isArray(rawCategory)
        ? rawCategory.join(', ')
        : (rawCategory || null);

      // Use airtable_id as the idempotency key. The wix_pair partial unique index
      // is a separate secondary constraint — if a row with a matching wix_pair already
      // exists (e.g. from a previous Wix sync), we still skip on airtable_id conflict.
      const result = await pool.query(
        `INSERT INTO product_config
           (airtable_id, wix_product_id, wix_variant_id, product_name, variant_name,
            sort_order, image_url, price, lead_time_days, active, visible_in_wix,
            product_type, min_stems, description, category, key_flower,
            quantity, available_from, available_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (airtable_id) WHERE airtable_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          r.id,
          r.get('Wix Product ID') || null,
          r.get('Wix Variant ID') || null,
          r.get('Product Name') || '',
          r.get('Variant Name') || '',
          Number(r.get('Sort Order') || 0),
          r.get('Image URL') || '',
          String(Number(r.get('Price') || 0)),
          Number(r.get('Lead Time Days') || 1),
          r.get('Active') !== false,  // default true if not explicitly false
          r.get('Visible in Wix') !== false,
          r.get('Product Type') || null,
          Number(r.get('Min Stems') || 0),
          r.get('Description') || '',
          category,
          r.get('Key Flower') || null,
          r.get('Quantity') != null ? Number(r.get('Quantity')) : null,
          r.get('Available From') || null,
          r.get('Available To') || null,
        ],
      );
      if (result.rows.length > 0) inserted++; else skipped++;
    } catch (err) {
      console.error(`[product_config] Failed on ${r.id}:`, err.message);
      failed++;
    }
  }
  console.log(`[product_config] inserted=${inserted}, skipped=${skipped}, failed=${failed}\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

try {
  console.log('=== Phase 6 backfill ===');
  if (DRY_RUN) console.log('=== DRY RUN MODE ===\n');

  await backfillFloristHours();
  await backfillMarketingSpend();
  await backfillStockLossLog();
  await backfillProductConfig();

  console.log('=== Phase 6 backfill complete ===');
} finally {
  await pool.end();
}
