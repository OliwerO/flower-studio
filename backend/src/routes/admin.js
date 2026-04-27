// Admin endpoints — owner-only raw-edit access to Postgres entities.
//
// Phase 2.5 ships the route shape and audit-history reader; per-entity
// list/get/patch/restore/purge handlers will populate the entityRegistry
// as each entity migrates to Postgres in Phase 3+. Today this route only
// returns the audit log itself (which is empty until Phase 3).
//
// Why a generic registry instead of one route per entity: the Admin tab is
// pure dev/owner ergonomics — when something looks wrong, owner needs to
// see the raw row without having to ship a custom UI per table. A small
// declarative registry keeps the surface area honest.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { db, isPostgresConfigured } from '../db/index.js';
import { auditLog } from '../db/schema.js';
import { desc, eq, and, count } from 'drizzle-orm';

const router = Router();

// `admin` is in ROLE_ACCESS for the owner role only — see middleware/auth.js.
router.use(authorize('admin'));

// Pre-flight check: if Postgres isn't configured, every endpoint here is a 503.
// This keeps the dashboard from rendering broken data while we're still in
// Phase 1/2.5 and DATABASE_URL hasn't been wired on a deployed environment.
router.use((_req, res, next) => {
  if (!isPostgresConfigured) {
    return res.status(503).json({
      error: 'Postgres not configured. Admin tools require DATABASE_URL.',
    });
  }
  next();
});

// Entity registry — populated as entities migrate. Today the values are stubs
// (the Stock / Customer / Order entries arrive in Phase 3+).
const ENTITIES = {
  // 'stock':    { table: stock,    idColumn: 'id', listFields: [...] },
  // 'order':    { ... },
  // 'customer': { ... },
};

// GET /api/admin/entities — what's available in the Admin tab today.
router.get('/entities', (_req, res) => {
  res.json({
    entities: Object.keys(ENTITIES),
    note: 'Entities are added per-phase as they migrate to Postgres.',
  });
});

// GET /api/admin/audit?entityType=stock&entityId=...&limit=100
// Generic audit-log reader — drives the "history" sidebar on the Admin tab.
// Without filters, returns the most recent N rows across all entities.
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

// Per-entity handlers (list, get, patch, restore, purge) will be added here
// in Phase 3 when there's an entity to operate on. Each of those becomes a
// thin proxy to its repo's admin-mode methods, with audit writes wrapped
// around mutations.

export default router;
