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
import { queryRecordsHandler } from '../services/assistantTools/dataQueryPack.js';
import { describeSchema } from '../services/assistantTools/explorerSchema.js';

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

export default router;
