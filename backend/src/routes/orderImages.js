// Order bouquet image routes — owner attaches/replaces a photo for the
// driver. The file lives in Wix Media (consistent with productImages.js)
// and the public URL is cached on the order row's `Image URL` field.
//
// Florist + owner can upload; only owner can remove. Drivers get 403.
// Mounted as a separate router so it can sit ahead of the main orders
// router and bypass any future role gating added there.

import { Router } from 'express';
import multer from 'multer';
import { generateUploadUrl, uploadFile, pollForReady, deleteFiles }
  from '../services/wixMediaClient.js';
import * as orderRepo from '../repos/orderRepo.js';
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
    return res.status(403).json({ error: `Role "${req.role}" cannot upload order images.` });
  }
  next();
}

// Wix Media URLs look like https://static.wixstatic.com/media/<fileId>/...
// The fileId is what `deleteFiles` wants, so derive it once.
function fileIdFromWixUrl(url) {
  if (!url) return null;
  const m = String(url).match(/wixstatic\.com\/media\/([^/]+)/);
  return m ? m[1] : null;
}

router.post('/:orderId/image', imageAuth, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    handleImageUpload(req, res).catch(next);
  });
});

async function handleImageUpload(req, res) {
  const { orderId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded.' });
  const { buffer, mimetype, originalname } = req.file;

  // Read prev URL up-front so we can reap the orphaned Wix Media file
  // after a successful replacement.
  let prevUrl = '';
  try {
    const before = await orderRepo.getById(orderId);
    prevUrl = before?.['Image URL'] || '';
  } catch (err) {
    console.error('[order-image-upload] getById failed (continuing):', err.message);
  }

  let uploadUrlResp;
  try {
    uploadUrlResp = await generateUploadUrl({ mimeType: mimetype, fileName: originalname });
  } catch (err) {
    console.error('[order-image-upload] generateUploadUrl failed:', err.message);
    return res.status(502).json({ error: `Wix Media unavailable: ${err.message}` });
  }

  let fileDescriptor;
  try {
    const putResp = await uploadFile(uploadUrlResp.uploadUrl, buffer, mimetype);
    fileDescriptor = putResp.file;
  } catch (err) {
    console.error('[order-image-upload] uploadFile failed:', err.message);
    return res.status(502).json({ error: `Wix Media upload failed: ${err.message}` });
  }

  let readyFile;
  if (fileDescriptor?.operationStatus === 'READY' && fileDescriptor.url) {
    readyFile = fileDescriptor;
  } else {
    try {
      readyFile = await pollForReady(fileDescriptor.id, { timeoutMs: 10000 });
    } catch (err) {
      console.error('[order-image-upload] pollForReady failed:', err.message);
      deleteFiles([fileDescriptor.id]).catch(e =>
        console.error('[order-image-upload] best-effort delete after timeout failed:', e.message));
      return res.status(504).json({ error: `Wix Media file processing timeout: ${err.message}` });
    }
  }

  try {
    await orderRepo.updateOrder(orderId, { 'Image URL': readyFile.url }, {
      actor: { actorRole: req.role, actorPinLabel: req.driverName || null },
    });
  } catch (err) {
    console.error('[order-image-upload] updateOrder failed:', err.message);
    return res.status(500).json({ error: `Uploaded to Wix Media but failed to save on order: ${err.message}` });
  }

  // Reap the previous file from Wix Media so we don't accumulate orphans.
  // Best-effort — failure here is logged but not surfaced to the client.
  if (prevUrl && prevUrl !== readyFile.url) {
    const prevId = fileIdFromWixUrl(prevUrl);
    if (prevId) {
      deleteFiles([prevId]).catch(err =>
        console.error('[order-image-upload] failed to delete old file:', err.message));
    }
  }

  if (drizzleDb) {
    try {
      await recordAudit(drizzleDb, {
        entityType: 'order',
        entityId: orderId,
        action: 'image_set',
        before: prevUrl ? { imageUrl: prevUrl } : null,
        after: { imageUrl: readyFile.url },
        actorRole: req.role,
      });
    } catch (err) {
      console.error('[order-image-upload] recordAudit failed:', err.message);
    }
  }

  broadcast({
    type: 'order_image_changed',
    orderId,
    imageUrl: readyFile.url,
  });

  res.json({ imageUrl: readyFile.url });
}

router.delete('/:orderId/image', (req, res, next) => {
  if (req.role !== 'owner') {
    return res.status(403).json({ error: `Role "${req.role}" cannot remove order images.` });
  }
  handleImageDelete(req, res).catch(next);
});

async function handleImageDelete(req, res) {
  const { orderId } = req.params;

  let prevUrl = '';
  try {
    const before = await orderRepo.getById(orderId);
    prevUrl = before?.['Image URL'] || '';
  } catch (err) {
    console.error('[order-image-delete] getById failed:', err.message);
  }

  try {
    await orderRepo.updateOrder(orderId, { 'Image URL': '' }, {
      actor: { actorRole: req.role, actorPinLabel: req.driverName || null },
    });
  } catch (err) {
    console.error('[order-image-delete] updateOrder failed:', err.message);
    return res.status(500).json({ error: `Failed to clear image on order: ${err.message}` });
  }

  if (prevUrl) {
    const prevId = fileIdFromWixUrl(prevUrl);
    if (prevId) {
      deleteFiles([prevId]).catch(err =>
        console.error('[order-image-delete] failed to delete Wix Media file:', err.message));
    }

    if (drizzleDb) {
      try {
        await recordAudit(drizzleDb, {
          entityType: 'order',
          entityId: orderId,
          action: 'image_remove',
          before: { imageUrl: prevUrl },
          after: null,
          actorRole: req.role,
        });
      } catch (err) {
        console.error('[order-image-delete] recordAudit failed:', err.message);
      }
    }
    broadcast({
      type: 'order_image_changed',
      orderId,
      imageUrl: '',
    });
  }

  res.json({ ok: true });
}

export default router;
