// Integration test for POST/DELETE /api/orders/:orderId/image — the
// per-order bouquet image override that wins over the storefront product
// image. Mirrors products.image.test.js but targets orderRepo + the
// orderImages router.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/wixMediaClient.js', () => ({
  generateUploadUrl: vi.fn(),
  uploadFile:        vi.fn(),
  pollForReady:      vi.fn(),
  deleteFiles:       vi.fn(),
}));
vi.mock('../repos/orderRepo.js', () => ({
  getById:     vi.fn(),
  updateOrder: vi.fn(),
}));
vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));
vi.mock('../db/audit.js', () => ({ recordAudit: vi.fn() }));
vi.mock('../db/index.js', () => ({ db: {} }));

const wixMedia = await import('../services/wixMediaClient.js');
const repo     = await import('../repos/orderRepo.js');
const notif    = await import('../services/notifications.js');

async function buildApp(roleOverride) {
  const app = express();
  app.use((req, _res, next) => {
    req.role = roleOverride || req.headers['x-test-role'] || 'florist';
    next();
  });
  const m = await import('../routes/orderImages.js');
  app.use('/api/orders', m.default);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('WIX_API_KEY', 'k');
  vi.stubEnv('WIX_SITE_ID', 's');
});

describe('POST /api/orders/:orderId/image', () => {
  it('happy path: uploads, persists, broadcasts', async () => {
    repo.getById.mockResolvedValue({ id: 'ord1', 'Image URL': '' });
    wixMedia.generateUploadUrl.mockResolvedValue({ uploadUrl: 'https://wix-up' });
    wixMedia.uploadFile.mockResolvedValue({
      file: { id: 'f1', operationStatus: 'READY', url: 'https://static.wixstatic.com/media/abc/ord1.jpg' },
    });
    repo.updateOrder.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app)
      .post('/api/orders/ord1/image')
      .attach('image', Buffer.from([0xff, 0xd8, 0xff]), { filename: 'b.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.imageUrl).toBe('https://static.wixstatic.com/media/abc/ord1.jpg');
    expect(repo.updateOrder).toHaveBeenCalledWith(
      'ord1',
      { 'Image URL': 'https://static.wixstatic.com/media/abc/ord1.jpg' },
      expect.objectContaining({ actor: expect.any(Object) }),
    );
    expect(notif.broadcast).toHaveBeenCalledWith({
      type: 'order_image_changed',
      orderId: 'ord1',
      imageUrl: 'https://static.wixstatic.com/media/abc/ord1.jpg',
    });
  });

  it('replaces previous image and reaps the orphaned Wix Media file', async () => {
    repo.getById.mockResolvedValue({ id: 'ord1', 'Image URL': 'https://static.wixstatic.com/media/old-fileId/old.jpg' });
    wixMedia.generateUploadUrl.mockResolvedValue({ uploadUrl: 'https://wix-up' });
    wixMedia.uploadFile.mockResolvedValue({
      file: { id: 'fnew', operationStatus: 'READY', url: 'https://static.wixstatic.com/media/new-fileId/new.jpg' },
    });
    repo.updateOrder.mockResolvedValue({});
    wixMedia.deleteFiles.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app)
      .post('/api/orders/ord1/image')
      .attach('image', Buffer.from([0xff, 0xd8, 0xff]), { filename: 'b.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    // Wait a tick for the fire-and-forget deleteFiles to be invoked.
    await new Promise(r => setImmediate(r));
    expect(wixMedia.deleteFiles).toHaveBeenCalledWith(['old-fileId']);
  });

  it('rejects unsupported MIME', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/orders/ord1/image')
      .attach('image', Buffer.from([0]), { filename: 'b.gif', contentType: 'image/gif' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JPG, PNG, or WebP/);
    expect(repo.updateOrder).not.toHaveBeenCalled();
  });

  it('rejects driver role with 403', async () => {
    const app = await buildApp('driver');
    const res = await request(app)
      .post('/api/orders/ord1/image')
      .attach('image', Buffer.from([0xff]), { filename: 'b.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(403);
    expect(repo.updateOrder).not.toHaveBeenCalled();
  });

  it('returns 502 when Wix Media generateUploadUrl fails', async () => {
    repo.getById.mockResolvedValue({ id: 'ord1', 'Image URL': '' });
    wixMedia.generateUploadUrl.mockRejectedValue(new Error('Wix down'));
    const app = await buildApp();
    const res = await request(app)
      .post('/api/orders/ord1/image')
      .attach('image', Buffer.from([0xff]), { filename: 'b.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(502);
  });

  it('returns 504 + reaps the Wix file when pollForReady times out', async () => {
    repo.getById.mockResolvedValue({ id: 'ord1', 'Image URL': '' });
    wixMedia.generateUploadUrl.mockResolvedValue({ uploadUrl: 'https://wix-up' });
    // operationStatus !== READY → forces pollForReady path.
    wixMedia.uploadFile.mockResolvedValue({ file: { id: 'fnew', operationStatus: 'PENDING' } });
    wixMedia.pollForReady.mockRejectedValue(new Error('timeout'));

    const app = await buildApp();
    const res = await request(app)
      .post('/api/orders/ord1/image')
      .attach('image', Buffer.from([0xff]), { filename: 'b.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(504);
    expect(wixMedia.deleteFiles).toHaveBeenCalledWith(['fnew']);
    expect(repo.updateOrder).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/orders/:orderId/image', () => {
  it('owner-only — florist gets 403', async () => {
    const app = await buildApp('florist');
    const res = await request(app).delete('/api/orders/ord1/image');
    expect(res.status).toBe(403);
    expect(repo.updateOrder).not.toHaveBeenCalled();
  });

  it('clears the URL, reaps Wix file, broadcasts', async () => {
    repo.getById.mockResolvedValue({
      id: 'ord1',
      'Image URL': 'https://static.wixstatic.com/media/old-fileId/old.jpg',
    });
    repo.updateOrder.mockResolvedValue({});

    const app = await buildApp('owner');
    const res = await request(app).delete('/api/orders/ord1/image');
    expect(res.status).toBe(200);
    expect(repo.updateOrder).toHaveBeenCalledWith(
      'ord1',
      { 'Image URL': '' },
      expect.objectContaining({ actor: expect.any(Object) }),
    );
    await new Promise(r => setImmediate(r));
    expect(wixMedia.deleteFiles).toHaveBeenCalledWith(['old-fileId']);
    expect(notif.broadcast).toHaveBeenCalledWith({
      type: 'order_image_changed',
      orderId: 'ord1',
      imageUrl: '',
    });
  });

  it('no-op DELETE (no prior image) skips broadcast', async () => {
    repo.getById.mockResolvedValue({ id: 'ord1', 'Image URL': '' });
    repo.updateOrder.mockResolvedValue({});

    const app = await buildApp('owner');
    const res = await request(app).delete('/api/orders/ord1/image');
    expect(res.status).toBe(200);
    expect(notif.broadcast).not.toHaveBeenCalled();
    expect(wixMedia.deleteFiles).not.toHaveBeenCalled();
  });
});
