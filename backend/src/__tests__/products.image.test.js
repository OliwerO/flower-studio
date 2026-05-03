// Integration test for POST /api/products/:wixProductId/image.
//
// The route orchestrates: Wix Media (upload URL → PUT bytes → poll ready) →
// Wix Stores (clear + attach media to product) → productRepo.setImage (local
// cache) → audit log → SSE broadcast. We mock every external boundary and
// assert the orchestration contract:
//   • happy path returns 200 + { imageUrl }, persists, broadcasts
//   • non-{owner,florist} roles 403 BEFORE multer parses the body
//   • unsupported MIME 400 from multer's fileFilter
//   • Wix Media generateUploadUrl failure surfaces as 502
//   • attachMediaToProduct failure → 500, no setImage, no broadcast
//   • pollForReady timeout → 504 + best-effort deleteFiles cleanup
//   • setImage failure after attach → 500, broadcast not called
//
// Note on auth: the image route lives in routes/productImages.js — a SEPARATE
// router from products.js. products.js gates everything behind
// authorize('admin'); productImages.js does its own role check via imageAuth().

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/wixMediaClient.js', () => ({
  generateUploadUrl: vi.fn(),
  uploadFile:        vi.fn(),
  pollForReady:      vi.fn(),
  deleteFiles:       vi.fn(),
}));
vi.mock('../services/wixProductSync.js', () => ({
  clearProductMedia:    vi.fn(),
  attachMediaToProduct: vi.fn(),
}));
vi.mock('../repos/productRepo.js', () => ({
  setImage:   vi.fn(),
  getImage:   vi.fn(),
}));
vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));
vi.mock('../db/audit.js', () => ({ recordAudit: vi.fn() }));
vi.mock('../db/index.js', () => ({ db: {} }));

const wixMedia = await import('../services/wixMediaClient.js');
const wixSync  = await import('../services/wixProductSync.js');
const repo     = await import('../repos/productRepo.js');
const notif    = await import('../services/notifications.js');

async function buildApp() {
  const app = express();
  app.use((req, _res, next) => { req.role = req.headers['x-test-role'] || 'florist'; next(); });
  const m = await import('../routes/productImages.js');
  app.use('/api/products', m.default);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('WIX_API_KEY', 'k');
  vi.stubEnv('WIX_SITE_ID', 's');
});

describe('POST /api/products/:wixProductId/image', () => {
  it('uploads, attaches, persists URL, broadcasts SSE, returns 200 with imageUrl', async () => {
    wixMedia.generateUploadUrl.mockResolvedValue({ uploadUrl: 'https://upload/x' });
    wixMedia.uploadFile.mockResolvedValue({ file: { id: 'f1', url: 'https://static/x.jpg' } });
    wixMedia.pollForReady.mockResolvedValue({ id: 'f1', url: 'https://static/x.jpg', state: 'OK' });
    wixSync.clearProductMedia.mockResolvedValue({});
    wixSync.attachMediaToProduct.mockResolvedValue({});
    repo.getImage.mockResolvedValue('');
    repo.setImage.mockResolvedValue({ updatedCount: 2 });

    const app = await buildApp();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const res = await request(app)
      .post('/api/products/prod-1/image')
      .set('x-test-role', 'florist')
      .attach('image', png, { filename: 'b.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imageUrl: 'https://static/x.jpg' });
    expect(wixSync.attachMediaToProduct).toHaveBeenCalledWith('prod-1', 'https://static/x.jpg');
    expect(repo.setImage).toHaveBeenCalledWith('prod-1', 'https://static/x.jpg');
    expect(notif.broadcast).toHaveBeenCalledWith({
      type: 'product_image_changed',
      wixProductId: 'prod-1',
      imageUrl: 'https://static/x.jpg',
    });
  });

  it('rejects driver role with 403', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/products/prod-1/image')
      .set('x-test-role', 'driver')
      .attach('image', Buffer.from([0]), { filename: 'b.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
  });

  it('rejects unsupported MIME', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/products/prod-1/image')
      .set('x-test-role', 'owner')
      .attach('image', Buffer.from([0]), { filename: 'x.gif', contentType: 'image/gif' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/MIME|tipo|format/i);
  });

  it('returns 502 when generateUploadUrl fails', async () => {
    wixMedia.generateUploadUrl.mockRejectedValue(new Error('Wix down'));
    const app = await buildApp();
    const res = await request(app)
      .post('/api/products/prod-1/image')
      .set('x-test-role', 'owner')
      .attach('image', Buffer.from([0xff]), { filename: 'b.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(502);
  });

  it('attachMediaToProduct fails after upload → 500, no setImage, no broadcast', async () => {
    wixMedia.generateUploadUrl.mockResolvedValue({ uploadUrl: 'https://upload/x' });
    wixMedia.uploadFile.mockResolvedValue({ file: { id: 'f1', url: 'https://static/x.jpg' } });
    wixMedia.pollForReady.mockResolvedValue({ id: 'f1', url: 'https://static/x.jpg', state: 'OK' });
    wixSync.clearProductMedia.mockResolvedValue({});
    wixSync.attachMediaToProduct.mockRejectedValue(new Error('attach 500'));

    const app = await buildApp();
    const res = await request(app)
      .post('/api/products/prod-1/image')
      .set('x-test-role', 'owner')
      .attach('image', Buffer.from([0xff]), { filename: 'b.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Uploaded to Wix Media but failed to attach/);
    expect(repo.setImage).not.toHaveBeenCalled();
    expect(notif.broadcast).not.toHaveBeenCalled();
  });

  it('pollForReady timeout → 504 + best-effort deleteFiles cleanup', async () => {
    wixMedia.generateUploadUrl.mockResolvedValue({ uploadUrl: 'https://upload/x' });
    wixMedia.uploadFile.mockResolvedValue({ file: { id: 'f1', url: 'https://static/x.jpg' } });
    wixMedia.pollForReady.mockRejectedValue(new Error('timeout'));
    wixMedia.deleteFiles.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app)
      .post('/api/products/prod-1/image')
      .set('x-test-role', 'owner')
      .attach('image', Buffer.from([0xff]), { filename: 'b.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(504);
    expect(wixMedia.deleteFiles).toHaveBeenCalledWith(['f1']);
  });

  it('setImage fails after attach → 500, broadcast not called', async () => {
    wixMedia.generateUploadUrl.mockResolvedValue({ uploadUrl: 'https://upload/x' });
    wixMedia.uploadFile.mockResolvedValue({ file: { id: 'f1', url: 'https://static/x.jpg' } });
    wixMedia.pollForReady.mockResolvedValue({ id: 'f1', url: 'https://static/x.jpg', state: 'OK' });
    wixSync.clearProductMedia.mockResolvedValue({});
    wixSync.attachMediaToProduct.mockResolvedValue({});
    repo.setImage.mockRejectedValue(new Error('airtable down'));

    const app = await buildApp();
    const res = await request(app)
      .post('/api/products/prod-1/image')
      .set('x-test-role', 'owner')
      .attach('image', Buffer.from([0xff]), { filename: 'b.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Attached to Wix product but failed to save locally/);
    expect(notif.broadcast).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/products/:wixProductId/image', () => {
  it('owner: clears product media, nulls cached URL, broadcasts SSE, returns 200', async () => {
    repo.getImage.mockResolvedValue('https://static/old.jpg');
    wixSync.clearProductMedia.mockResolvedValue({});
    repo.setImage.mockResolvedValue({ updatedCount: 1 });
    const app = await buildApp();
    const res = await request(app)
      .delete('/api/products/prod-1/image')
      .set('x-test-role', 'owner');
    expect(res.status).toBe(200);
    expect(wixSync.clearProductMedia).toHaveBeenCalledWith('prod-1');
    expect(repo.setImage).toHaveBeenCalledWith('prod-1', '');
    expect(notif.broadcast).toHaveBeenCalledWith({
      type: 'product_image_changed',
      wixProductId: 'prod-1',
      imageUrl: '',
    });
  });

  it('florist: 403', async () => {
    const app = await buildApp();
    const res = await request(app)
      .delete('/api/products/prod-1/image')
      .set('x-test-role', 'florist');
    expect(res.status).toBe(403);
  });

  it('owner: no-op DELETE when no image exists → 200, no audit/broadcast', async () => {
    repo.getImage.mockResolvedValue('');
    wixSync.clearProductMedia.mockResolvedValue({});
    repo.setImage.mockResolvedValue({ updatedCount: 1 });
    const app = await buildApp();
    const res = await request(app)
      .delete('/api/products/prod-1/image')
      .set('x-test-role', 'owner');
    expect(res.status).toBe(200);
    expect(notif.broadcast).not.toHaveBeenCalled();
  });
});
