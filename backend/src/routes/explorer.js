// backend/src/routes/explorer.js
// Thin HTTP controller for Explorer — the read-only, owner-only second
// front-end on the `query_records` engine (ADR-0010). All validation and
// query execution lives in dataQueryPack.js; this file only wires HTTP.
//
// Owner-only gate: the 'explorer' resource is granted to the owner role only
// in ROLE_ACCESS (middleware/auth.js), mirroring how 'assistant' gates Ask
// Blossom. Same read-only spec engine, dedicated resource key.
import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { queryRecordsHandler, validateSpec } from '../services/assistantTools/dataQueryPack.js';
import { describeSchema } from '../services/assistantTools/explorerSchema.js';
import * as savedViewRepo from '../repos/savedViewRepo.js';

const router = Router();
router.use(authorize('explorer')); // owner-only per ROLE_ACCESS

router.post('/query', async (req, res, next) => {
  try {
    const result = await queryRecordsHandler(req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/schema', async (req, res, next) => {
  try {
    res.json(describeSchema());
  } catch (err) {
    next(err);
  }
});

// ── Saved views (P4) — persisted query_records specs (ADR-0010) ──
// Single-owner app: no per-user scoping. The spec is validated against the
// query_records allow-list on write so a stored view can never smuggle an
// entity/field the engine would reject at run time.
router.get('/views', async (req, res, next) => {
  try {
    res.json(await savedViewRepo.list());
  } catch (err) {
    next(err);
  }
});

router.post('/views', async (req, res, next) => {
  try {
    const { name, spec } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const v = validateSpec(spec);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const view = await savedViewRepo.create({ name: name.trim(), spec });
    res.status(201).json(view);
  } catch (err) {
    next(err);
  }
});

router.patch('/views/:id', async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const view = await savedViewRepo.rename(req.params.id, name.trim());
    if (!view) return res.status(404).json({ error: 'View not found' });
    res.json(view);
  } catch (err) {
    next(err);
  }
});

router.delete('/views/:id', async (req, res, next) => {
  try {
    const removed = await savedViewRepo.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'View not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
