// Data-access for saved_views — Explorer's persisted query_records specs
// (ADR-0010). Single-owner app: no per-user scoping, every view is the
// Owner's. Soft-deleted via deleted_at so a "remove" never destroys history.
//
// NOTE: this repo does NOT validate `spec` against the query_records
// allow-list — that validation happens at query time in the route layer
// (a later wave). This repo stores and returns the spec object verbatim.
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { savedViews } from '../db/schema.js';

function toWire(row) {
  return {
    id:        row.id,
    name:      row.name,
    spec:      row.spec,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Active views (deleted_at IS NULL), newest-first.
export async function list() {
  const rows = await db
    .select()
    .from(savedViews)
    .where(isNull(savedViews.deletedAt))
    .orderBy(desc(savedViews.createdAt));
  return rows.map(toWire);
}

export async function create({ name, spec }) {
  const [row] = await db
    .insert(savedViews)
    .values({ name, spec })
    .returning();
  return toWire(row);
}

// Renames a view + bumps updated_at. Returns null if the view is missing or
// already soft-deleted (matches only active rows so a rename never revives
// a removed view).
export async function rename(id, name) {
  const [row] = await db
    .update(savedViews)
    .set({ name, updatedAt: sql`now()` })
    .where(and(eq(savedViews.id, id), isNull(savedViews.deletedAt)))
    .returning();
  return row ? toWire(row) : null;
}

// Soft-delete. Returns true if an active row was found and marked deleted,
// false if the id was missing or already deleted (idempotent).
export async function remove(id) {
  const [row] = await db
    .update(savedViews)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(savedViews.id, id), isNull(savedViews.deletedAt)))
    .returning();
  return !!row;
}
