// Admin endpoints — owner-only raw-edit access to Postgres entities.
//
// Phase 2.5 shipped the route shape and audit-history reader.
// Phase 3 adds the first per-entity surface: `stock` (list / get / patch /
// restore / purge) and the parity-log dashboard. Each entity's handlers
// delegate to its repo, with audit writes wrapped around mutations by
// the repo itself — this route is just the HTTP edge.
//
// Why generic-entity routes rather than one route per entity: the AdminTab
// is pure dev/owner ergonomics — when something looks wrong, the owner
// needs to see the raw row without us shipping a custom UI per table. A
// small declarative registry keeps the surface area honest.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { db, isPostgresConfigured } from '../db/index.js';
import { auditLog, parityLog, stock } from '../db/schema.js';
import { actorFromReq } from '../utils/actor.js';
import * as stockRepo from '../repos/stockRepo.js';
import { desc, eq, and, count, isNull } from 'drizzle-orm';

const router = Router();

// `admin` is in ROLE_ACCESS for the owner role only — see middleware/auth.js.
router.use(authorize('admin'));

// Pre-flight: if Postgres isn't configured, every endpoint here is a 503.
// Keeps the dashboard from rendering broken data while we're still in
// Phase 1/2.5 and DATABASE_URL hasn't been wired on a deployed environment.
router.use((_req, res, next) => {
  if (!isPostgresConfigured) {
    return res.status(503).json({
      error: 'Postgres not configured. Admin tools require DATABASE_URL.',
    });
  }
  next();
});

// Entity registry — populated as entities migrate.
const ENTITIES = {
  stock: {
    repo: stockRepo,
    table: stock,
    label: 'Stock',
    orderByCol: stock.updatedAt,
  },
};

// GET /api/admin/entities — what's available in the Admin tab today.
router.get('/entities', (_req, res) => {
  res.json({
    entities: Object.keys(ENTITIES).map(key => ({ key, label: ENTITIES[key].label })),
    note: 'Entities are added per-phase as they migrate to Postgres.',
  });
});

// GET /api/admin/status — per-entity backend mode + general PG health.
// Drives the AdminTab's "Stock backend: shadow" banner so the owner can
// see at a glance which phase the cutover is in, without needing to peek
// at Railway env vars.
router.get('/status', (_req, res) => {
  res.json({
    databaseUrlConfigured: isPostgresConfigured,
    backends: {
      stock: stockRepo.getBackendMode(),
    },
  });
});

// ── Audit log reader (entity-agnostic) ──

// GET /api/admin/audit?entityType=stock&entityId=...&limit=100
router.get('/audit', async (req, res, next) => {
  try {
    const { entityType, entityId } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? '100', 10) || 100, 1), 500);

    const filters = [];
    if (entityType) filters.push(eq(auditLog.entityType, String(entityType)));
    if (entityId)   filters.push(eq(auditLog.entityId, String(entityId)));

    const rows = await db.select().from(auditLog)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/audit/stats — quick counters for the Admin tab header.
router.get('/audit/stats', async (_req, res, next) => {
  try {
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(auditLog);
    res.json({ total: Number(total) });
  } catch (err) {
    next(err);
  }
});

// ── Parity log (Phase 3 cutover verification) ──

// GET /api/admin/parity/:entity?limit=200&kind=field_mismatch
// Returns recent parity events for the entity, optionally filtered by kind.
router.get('/parity/:entity', async (req, res, next) => {
  try {
    const { entity } = req.params;
    if (!ENTITIES[entity]) return res.status(404).json({ error: `Unknown entity: ${entity}` });

    const limit = Math.min(Math.max(parseInt(req.query.limit ?? '200', 10) || 200, 1), 1000);
    const filters = [eq(parityLog.entityType, entity)];
    if (req.query.kind) filters.push(eq(parityLog.kind, String(req.query.kind)));

    const rows = await db.select().from(parityLog)
      .where(and(...filters))
      .orderBy(desc(parityLog.createdAt))
      .limit(limit);

    // Counts grouped by kind (so the frontend can show a quick summary tile).
    const allCountsRaw = await db
      .select({ kind: parityLog.kind, c: count() })
      .from(parityLog)
      .where(eq(parityLog.entityType, entity))
      .groupBy(parityLog.kind);
    const countsByKind = Object.fromEntries(allCountsRaw.map(r => [r.kind, Number(r.c)]));

    res.json({ rows, countsByKind });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/parity/:entity/recheck — runs a fresh full diff for the
// entity. Slow during peak hours; the owner triggers this from the AdminTab
// during quiet hours to certify that flip-to-PG is safe.
router.post('/parity/:entity/recheck', async (req, res, next) => {
  try {
    const { entity } = req.params;
    if (entity !== 'stock') {
      return res.status(400).json({ error: `Recheck not implemented for: ${entity}` });
    }
    const summary = await stockRepo.runParityCheck();
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// ── Per-entity raw-data endpoints ──
//
// These intentionally ignore the entity registry's column metadata and just
// return whole PG rows — the AdminTab is for the owner peering at raw data.
// Filtering / pagination is delegated to the underlying SQL.

// GET /api/admin/:entity?includeDeleted=true&limit=200
router.get('/:entity', async (req, res, next) => {
  try {
    const def = ENTITIES[req.params.entity];
    if (!def) return res.status(404).json({ error: `Unknown entity: ${req.params.entity}` });
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? '200', 10) || 200, 1), 1000);

    const filters = [];
    if (req.query.includeDeleted !== 'true') {
      filters.push(isNull(def.table.deletedAt));
    }

    const rows = await db.select().from(def.table)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(def.orderByCol))
      .limit(limit);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/:entity/:id — fetch a single PG row including soft-deleted.
router.get('/:entity/:id', async (req, res, next) => {
  try {
    const def = ENTITIES[req.params.entity];
    if (!def) return res.status(404).json({ error: `Unknown entity: ${req.params.entity}` });

    const isAirtableId = req.params.id.startsWith('rec');
    const where = isAirtableId
      ? eq(def.table.airtableId, req.params.id)
      : eq(def.table.id, req.params.id);

    const [row] = await db.select().from(def.table).where(where).limit(1);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/:entity/:id — raw inline edit, audited by the repo.
router.patch('/:entity/:id', async (req, res, next) => {
  try {
    const def = ENTITIES[req.params.entity];
    if (!def) return res.status(404).json({ error: `Unknown entity: ${req.params.entity}` });
    const updated = await def.repo.update(req.params.id, req.body, { actor: actorFromReq(req) });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/:entity/:id/restore — undelete a soft-deleted row.
router.post('/:entity/:id/restore', async (req, res, next) => {
  try {
    const def = ENTITIES[req.params.entity];
    if (!def) return res.status(404).json({ error: `Unknown entity: ${req.params.entity}` });
    const restored = await def.repo.restore(req.params.id, { actor: actorFromReq(req) });
    res.json(restored);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/:entity/:id/purge — hard delete (no undo). UI confirmation
// modal must precede this call. Audit log keeps the row's last state forever.
router.delete('/:entity/:id/purge', async (req, res, next) => {
  try {
    const def = ENTITIES[req.params.entity];
    if (!def) return res.status(404).json({ error: `Unknown entity: ${req.params.entity}` });
    const result = await def.repo.purge(req.params.id, { actor: actorFromReq(req) });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
