// Product Config repository — Phase 6: reads and writes the product_config
// Postgres table directly (no Airtable involvement).
//
// Wire format: all public methods return Airtable-shaped objects so that
// callers (routes, services) require no logic changes across the cutover.
// The PG row's UUID is exposed as `id` — the productConfig table has no
// Airtable ID in normal use (it's populated by backfill only).

import { db } from '../db/index.js';
import { productConfig } from '../db/schema.js';
import { eq, and, isNull, inArray, asc, sql } from 'drizzle-orm';

// ── Wire-format mapper ─────────────────────────────────────────────────────

/**
 * Convert a Postgres row (snake_case) into an Airtable-shaped object.
 * Callers (routes, services, frontends) only see this shape.
 */
function toWire(row) {
  return {
    id:               row.id,
    'Wix Product ID': row.wixProductId,
    'Wix Variant ID': row.wixVariantId,
    'Product Name':   row.productName,
    'Variant Name':   row.variantName,
    'Sort Order':     row.sortOrder,
    'Image URL':      row.imageUrl,
    Price:            Number(row.price || 0),
    'Lead Time Days': row.leadTimeDays,
    Active:           row.active,
    'Visible in Wix': row.visibleInWix,
    'Product Type':   row.productType || '',
    'Min Stems':      row.minStems,
    Description:      row.description,
    Category:         row.category || '',
    'Key Flower':     row.keyFlower || '',
    Quantity:         row.quantity ?? null,
    'Available From': row.availableFrom || null,
    'Available To':   row.availableTo   || null,
    Translations:     row.translations  || {},
  };
}

/**
 * Convert Airtable-shaped fields (or camelCase fields) into PG column object.
 * Only the keys that are present in `fields` are included — partial updates work.
 */
function toPg(fields) {
  const col = {};

  // camelCase form (used by create/upsert from sync code)
  if ('wixProductId'  in fields) col.wixProductId  = fields.wixProductId;
  if ('wixVariantId'  in fields) col.wixVariantId  = fields.wixVariantId;
  if ('productName'   in fields) col.productName   = fields.productName;
  if ('variantName'   in fields) col.variantName   = fields.variantName;
  if ('sortOrder'     in fields) col.sortOrder     = fields.sortOrder;
  if ('imageUrl'      in fields) col.imageUrl      = fields.imageUrl;
  if ('price'         in fields) col.price         = String(fields.price);
  if ('leadTimeDays'  in fields) col.leadTimeDays  = fields.leadTimeDays;
  if ('active'        in fields) col.active        = fields.active;
  if ('visibleInWix'  in fields) col.visibleInWix  = fields.visibleInWix;
  if ('productType'   in fields) col.productType   = fields.productType;
  if ('minStems'      in fields) col.minStems      = fields.minStems;
  if ('description'   in fields) col.description   = fields.description;
  if ('keyFlower'     in fields) col.keyFlower     = fields.keyFlower;
  if ('quantity'      in fields) col.quantity      = fields.quantity;
  if ('availableFrom' in fields) col.availableFrom = fields.availableFrom;
  if ('availableTo'   in fields) col.availableTo   = fields.availableTo;
  if ('translations'  in fields) col.translations  = fields.translations;

  // category: Airtable may pass an array — join to comma-separated text
  if ('category' in fields) {
    col.category = Array.isArray(fields.category)
      ? fields.category.join(', ')
      : (fields.category ?? null);
  }

  // Airtable-field-name form (used by update from routes)
  if ('Wix Product ID' in fields) col.wixProductId  = fields['Wix Product ID'];
  if ('Wix Variant ID' in fields) col.wixVariantId  = fields['Wix Variant ID'];
  if ('Product Name'   in fields) col.productName   = fields['Product Name'];
  if ('Variant Name'   in fields) col.variantName   = fields['Variant Name'];
  if ('Sort Order'     in fields) col.sortOrder     = fields['Sort Order'];
  if ('Image URL'      in fields) col.imageUrl      = fields['Image URL'];
  if ('Price'          in fields) col.price         = String(fields['Price']);
  if ('Lead Time Days' in fields) col.leadTimeDays  = fields['Lead Time Days'];
  if ('Active'         in fields) col.active        = fields['Active'];
  if ('Visible in Wix' in fields) col.visibleInWix  = fields['Visible in Wix'];
  if ('Product Type'   in fields) col.productType   = fields['Product Type'];
  if ('Min Stems'      in fields) col.minStems      = fields['Min Stems'];
  if ('Description'    in fields) col.description   = fields['Description'];
  if ('Key Flower'     in fields) col.keyFlower     = fields['Key Flower'];
  if ('Quantity'       in fields) col.quantity      = fields['Quantity'];
  if ('Available From' in fields) col.availableFrom = fields['Available From'];
  if ('Available To'   in fields) col.availableTo   = fields['Available To'];
  if ('Translations'   in fields) col.translations  = fields['Translations'];

  if ('Category' in fields) {
    col.category = Array.isArray(fields['Category'])
      ? fields['Category'].join(', ')
      : (fields['Category'] ?? null);
  }

  return col;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * List all non-deleted product config rows.
 * @param {{ activeOnly?: boolean }} [filter]
 * @returns {Promise<Array>} Wire-format objects ordered by productName, sortOrder.
 */
export async function list(filter = {}) {
  const conditions = [isNull(productConfig.deletedAt)];
  if (filter.activeOnly) conditions.push(eq(productConfig.active, true));

  const rows = await db
    .select()
    .from(productConfig)
    .where(and(...conditions))
    .orderBy(asc(productConfig.productName), asc(productConfig.sortOrder));

  return rows.map(toWire);
}

/**
 * Fetch a single row by PG UUID.
 * @returns Wire-format object or null.
 */
export async function getById(id) {
  const rows = await db
    .select()
    .from(productConfig)
    .where(and(eq(productConfig.id, id), isNull(productConfig.deletedAt)))
    .limit(1);
  return rows[0] ? toWire(rows[0]) : null;
}

/**
 * Fetch a row by (wixProductId, wixVariantId) pair.
 * @returns Wire-format object or null.
 */
export async function getByWixPair(wixProductId, wixVariantId) {
  const rows = await db
    .select()
    .from(productConfig)
    .where(and(
      eq(productConfig.wixProductId, wixProductId),
      eq(productConfig.wixVariantId, wixVariantId),
      isNull(productConfig.deletedAt),
    ))
    .limit(1);
  return rows[0] ? toWire(rows[0]) : null;
}

/**
 * Insert a new product config row.
 * Accepts camelCase or Airtable-field-name keys (or a mix).
 * @returns Wire-format object.
 */
export async function create(fields) {
  const col = toPg(fields);
  if (!col.productName) throw new Error('productName / Product Name is required');

  const rows = await db.insert(productConfig).values(col).returning();
  return toWire(rows[0]);
}

/**
 * Insert or update by (wixProductId, wixVariantId) uniqueness key.
 * On conflict (matching the partial unique index), all supplied fields are overwritten.
 * @returns Wire-format object.
 */
export async function upsert(fields) {
  const col = toPg(fields);

  // The unique index product_config_wix_pair_idx is a PARTIAL index
  // (WHERE wix_product_id IS NOT NULL AND wix_variant_id IS NOT NULL).
  // Drizzle's onConflictDoUpdate with a column array targets the base constraint,
  // not a partial index — we must reference the index by name via targetWhere.
  const rows = await db
    .insert(productConfig)
    .values(col)
    .onConflictDoUpdate({
      target:       [productConfig.wixProductId, productConfig.wixVariantId],
      targetWhere:  and(
        sql`${productConfig.wixProductId} IS NOT NULL`,
        sql`${productConfig.wixVariantId} IS NOT NULL`,
      ),
      set: col,
    })
    .returning();

  return toWire(rows[0]);
}

/**
 * Patch a row by PG UUID. Accepts Airtable-field-name keys.
 * Only the EDITABLE_FIELDS subset is accepted (same list as routes/products.js).
 * @returns Wire-format object or throws 404.
 */
const EDITABLE_FIELD_MAP = {
  'Price':          true, 'Quantity':      true, 'Lead Time Days': true,
  'Active':         true, 'Visible in Wix': true, 'Category':      true,
  'Key Flower':     true, 'Product Type':  true, 'Min Stems':      true,
  'Sort Order':     true, 'Available From': true, 'Available To':   true,
  'Description':    true, 'Translations':  true,
};

export async function update(id, fields) {
  // Allow only editable fields
  const allowed = {};
  for (const [k, v] of Object.entries(fields)) {
    if (EDITABLE_FIELD_MAP[k]) allowed[k] = v;
  }
  if (Object.keys(allowed).length === 0) {
    throw Object.assign(new Error('No valid fields to update'), { status: 400 });
  }

  const col = toPg(allowed);

  const rows = await db
    .update(productConfig)
    .set(col)
    .where(and(eq(productConfig.id, id), isNull(productConfig.deletedAt)))
    .returning();

  if (rows.length === 0) {
    throw Object.assign(new Error('Product config not found'), { status: 404 });
  }
  return toWire(rows[0]);
}

/**
 * Write the same imageUrl to every variant row matching wixProductId.
 * @returns {{ updatedCount: number }}
 */
export async function setImage(wixProductId, imageUrl) {
  const result = await db
    .update(productConfig)
    .set({ imageUrl })
    .where(and(
      eq(productConfig.wixProductId, wixProductId),
      isNull(productConfig.deletedAt),
    ))
    .returning({ id: productConfig.id });

  return { updatedCount: result.length };
}

/**
 * Return the Image URL of the first matching variant, or '' if none.
 */
export async function getImage(wixProductId) {
  const rows = await db
    .select({ imageUrl: productConfig.imageUrl })
    .from(productConfig)
    .where(and(
      eq(productConfig.wixProductId, wixProductId),
      isNull(productConfig.deletedAt),
    ))
    .limit(1);
  return rows[0]?.imageUrl || '';
}

/**
 * Batch lookup. Returns Map<wixProductId, imageUrl> for the subset that
 * has both a product_config row and a non-empty imageUrl.
 * @param {string[]} wixProductIds
 * @returns {Promise<Map<string, string>>}
 */
export async function getImagesBatch(wixProductIds) {
  const map = new Map();
  if (!wixProductIds || wixProductIds.length === 0) return map;

  const rows = await db
    .select({ wixProductId: productConfig.wixProductId, imageUrl: productConfig.imageUrl })
    .from(productConfig)
    .where(and(
      inArray(productConfig.wixProductId, wixProductIds),
      isNull(productConfig.deletedAt),
    ));

  for (const row of rows) {
    const pid = row.wixProductId;
    const url = row.imageUrl;
    if (pid && url && !map.has(pid)) map.set(pid, url);
  }
  return map;
}

/**
 * Decrement Quantity by `amount`, clamping at 0.
 * Rows with NULL quantity are "untracked/unlimited" and left alone.
 * Uses raw SQL because Drizzle doesn't expose GREATEST().
 */
export async function decrementQuantity(wixProductId, wixVariantId, amount) {
  await db.execute(
    sql`UPDATE product_config
        SET quantity = GREATEST(0, quantity - ${amount})
        WHERE wix_product_id = ${wixProductId}
          AND wix_variant_id = ${wixVariantId}
          AND quantity IS NOT NULL
          AND deleted_at IS NULL`
  );
}

/**
 * Soft-delete a row by PG UUID (sets deleted_at to now).
 */
export async function softDelete(id) {
  await db
    .update(productConfig)
    .set({ deletedAt: new Date() })
    .where(eq(productConfig.id, id));
}

/**
 * Deactivate a row by PG UUID (sets active = false).
 */
export async function deactivate(id) {
  await db
    .update(productConfig)
    .set({ active: false })
    .where(eq(productConfig.id, id));
}
