// backend/src/routes/assistant.js
// Thin HTTP controller for the Ask Blossom assistant.
// All business logic lives in assistantService.js.
import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { ask } from '../services/assistantService.js';

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

export default router;
