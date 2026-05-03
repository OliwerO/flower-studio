// Bouquet image upload routes — florist + owner can upload, owner can remove.
//
// Mounted as a SEPARATE router from products.js because products.js gates
// everything behind authorize('admin'). Image routes need broader access
// (florist + owner), enforced via the imageAuth middleware below. Drivers
// get 403.

import { Router } from 'express';
import multer from 'multer';
import { generateUploadUrl, uploadFile, pollForReady, deleteFiles }
  from '../services/wixMediaClient.js';
import { clearProductMedia, attachMediaToProduct }
  from '../services/wixProductSync.js';
import * as productRepo from '../repos/productRepo.js';
import { broadcast } from '../services/notifications.js';
import { recordAudit } from '../db/audit.js';
import { db as drizzleDb } from '../db/index.js';

const router = Router();

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported image MIME — JPG, PNG, or WebP only'));
  },
});

function imageAuth(req, res, next) {
  if (req.role !== 'florist' && req.role !== 'owner') {
    return res.status(403).json({ error: `Role "${req.role}" cannot upload bouquet images.` });
  }
  next();
}

router.post('/:wixProductId/image', imageAuth, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    handleImageUpload(req, res).catch(next);
  });
});

async function handleImageUpload(req, res) {
  const { wixProductId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded.' });
  const { buffer, mimetype, originalname } = req.file;

  let uploadUrlResp;
  try {
    uploadUrlResp = await generateUploadUrl({ mimeType: mimetype, fileName: originalname });
  } catch (err) {
    console.error('[image-upload] generateUploadUrl failed:', err.message);
    return res.status(502).json({ error: `Wix Media unavailable: ${err.message}` });
  }

  let fileDescriptor;
  try {
    const putResp = await uploadFile(uploadUrlResp.uploadUrl, buffer, mimetype);
    fileDescriptor = putResp.file;
  } catch (err) {
    console.error('[image-upload] uploadFile failed:', err.message);
    return res.status(502).json({ error: `Wix Media upload failed: ${err.message}` });
  }

  let readyFile;
  try {
    readyFile = await pollForReady(fileDescriptor.id, { timeoutMs: 10000 });
  } catch (err) {
    console.error('[image-upload] pollForReady failed:', err.message);
    deleteFiles([fileDescriptor.id]).catch(e =>
      console.error('[image-upload] best-effort delete after timeout failed:', e.message));
    return res.status(504).json({ error: `Wix Media file processing timeout: ${err.message}` });
  }

  // Best-effort: clear pre-existing media so the bouquet keeps the
  // single-image semantic. 404 PRODUCT_NOT_FOUND means the product has no
  // media yet — benign. Anything else (rate limit, transient 5xx) we
  // surface so a stale image isn't silently left attached.
  try {
    await clearProductMedia(wixProductId);
  } catch (err) {
    const is404 = err.message?.includes(' 404:') || err.message?.includes('PRODUCT_NOT_FOUND');
    if (!is404) {
      console.error('[image-upload] clearProductMedia failed:', err.message);
      return res.status(502).json({ error: `Failed to clear existing image on Wix product: ${err.message}` });
    }
  }

  try {
    await attachMediaToProduct(wixProductId, readyFile.url);
  } catch (err) {
    console.error('[image-upload] attachMediaToProduct failed:', err.message);
    return res.status(500).json({ error: `Uploaded to Wix Media but failed to attach to product: ${err.message}` });
  }

  try {
    await productRepo.setImage(wixProductId, readyFile.url);
  } catch (err) {
    console.error('[image-upload] productRepo.setImage failed:', err.message);
    return res.status(500).json({ error: `Attached to Wix product but failed to save locally: ${err.message}` });
  }

  // Audit — recordAudit signature is (tx, payload). drizzleDb may be null
  // in dev/airtable-only mode; skip silently rather than crash.
  if (drizzleDb) {
    try {
      await recordAudit(drizzleDb, {
        entityType: 'product',
        entityId: wixProductId,
        action: 'image_set',
        before: null,
        after: { imageUrl: readyFile.url },
        actorRole: req.role,
      });
    } catch (err) {
      console.error('[image-upload] recordAudit failed:', err.message);
    }
  }

  broadcast({
    type: 'product_image_changed',
    wixProductId,
    imageUrl: readyFile.url,
  });

  res.json({ imageUrl: readyFile.url });
}

export default router;
