import { Router } from 'express';
import multer from 'multer';
import { authorize } from '../middleware/auth.js';
import * as feedbackService from '../services/feedbackService.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    ok ? cb(null, true) : cb(new Error('JPG, PNG, or WebP only'));
  },
});

// All feedback routes require any authenticated role
router.use(authorize('feedback'));

// POST /feedback/start — begin a Report session
router.post('/start', async (req, res) => {
  try {
    const { text, appArea, reporterRole, reporterName } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    if (!reporterRole) return res.status(400).json({ error: 'reporterRole is required' });
    if (!reporterName) return res.status(400).json({ error: 'reporterName is required' });

    const result = await feedbackService.startSession({ text, appArea, reporterRole, reporterName });
    res.json(result);
  } catch (err) {
    console.error('[FEEDBACK] start error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /feedback/continue — send next message in conversation
router.post('/continue', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

    const result = await feedbackService.continueSession(sessionId, message);
    res.json(result);
  } catch (err) {
    console.error('[FEEDBACK] continue error:', err);
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// POST /feedback/preview — get Russian summary before publishing
router.post('/preview', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const result = await feedbackService.previewSession(sessionId);
    res.json(result);
  } catch (err) {
    console.error('[FEEDBACK] preview error:', err);
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// POST /feedback/publish — create GitHub issue (multipart to support optional screenshot)
router.post('/publish', upload.single('image'), async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const imageBuffer = req.file ? req.file.buffer : null;
    const imageName   = req.file ? req.file.originalname : null;
    const result = await feedbackService.publishSession(sessionId, imageBuffer, imageName);
    res.json(result);
  } catch (err) {
    console.error('[FEEDBACK] publish error:', err);
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

export default router;
