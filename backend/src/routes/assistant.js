// backend/src/routes/assistant.js
// Thin HTTP controller for the Ask Blossom assistant.
// All business logic lives in assistantService.js.
import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { ask, listConversations, getConversation, renameConversation, deleteConversation } from '../services/assistantService.js';

const router = Router();
router.use(authorize('assistant')); // owner-only per ROLE_ACCESS

router.post('/message', async (req, res, next) => {
  try {
    const { sessionId, message } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message (string) is required' });
    }
    const result = await ask({ sessionId, message });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/conversations', async (req, res, next) => {
  try {
    res.json(await listConversations());
  } catch (err) { next(err); }
});

router.get('/conversations/:id', async (req, res, next) => {
  try {
    const c = await getConversation(req.params.id);
    if (!c) return res.status(404).json({ error: 'conversation not found' });
    res.json(c);
  } catch (err) { next(err); }
});

router.patch('/conversations/:id', async (req, res, next) => {
  try {
    const title = (req.body?.title ?? '').trim();
    if (!title) return res.status(400).json({ error: 'title (non-empty string) is required' });
    const row = await renameConversation(req.params.id, title.slice(0, 200));
    if (!row) return res.status(404).json({ error: 'conversation not found' });
    res.json(row);
  } catch (err) { next(err); }
});

router.delete('/conversations/:id', async (req, res, next) => {
  try {
    const ok = await deleteConversation(req.params.id);
    if (!ok) return res.status(404).json({ error: 'conversation not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
