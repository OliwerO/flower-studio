// Route-level test for POST /api/feedback/publish multipart upload.
//
// Reproduces the 2026-05-29 incident: the owner could not create reports from
// the dashboard. Root cause — desktop screenshots exceed multer's 5MB cap, and
// the resulting MulterError fell through the central errorHandler as an opaque
// 500 ("Internal server error") with no hint it was the image. The florist app
// (phone-sized screenshots) stayed under the cap, so reports worked there.
//
// We mount the REAL feedback router (real multer config) + the REAL errorHandler
// and mock only the service + auth boundaries. Asserts:
//   • oversized image → 413 with a clear, surfaceable message (not opaque 500)
//   • small image → publishSession called, 200 with issue url
//   • the message survives production masking (the owner saw a masked 500)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../middleware/auth.js', () => ({
  authorize: () => (req, _res, next) => { req.role = 'owner'; next(); },
}));
vi.mock('../services/feedbackService.js', () => ({
  publishSession: vi.fn(),
}));

const feedbackService = await import('../services/feedbackService.js');

async function buildApp() {
  const app = express();
  const routes = (await import('../routes/feedback.js')).default;
  const { errorHandler } = await import('../middleware/errorHandler.js');
  app.use('/api/feedback', routes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production'); // reproduce the owner's prod experience
});

describe('POST /api/feedback/publish — screenshot upload', () => {
  it('rejects an oversized screenshot with a clear 413 (not an opaque 500)', async () => {
    feedbackService.publishSession.mockResolvedValue({ issueUrl: 'x', issueNumber: 1 });
    const app = await buildApp();

    const big = Buffer.alloc(6 * 1024 * 1024, 0); // 6MB > 5MB cap

    const res = await request(app)
      .post('/api/feedback/publish')
      .field('sessionId', 'sess-1')
      .attach('image', big, { filename: 'screenshot.png', contentType: 'image/png' });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large|5\s?MB/i);
    expect(res.body.error).not.toMatch(/internal server error/i);
    expect(feedbackService.publishSession).not.toHaveBeenCalled();
  });

  it('accepts a small screenshot and publishes the report', async () => {
    feedbackService.publishSession.mockResolvedValue({
      issueUrl: 'https://github.com/OliwerO/flower-studio/issues/42',
      issueNumber: 42,
    });
    const app = await buildApp();

    const small = Buffer.alloc(64 * 1024, 1); // 64KB

    const res = await request(app)
      .post('/api/feedback/publish')
      .field('sessionId', 'sess-2')
      .attach('image', small, { filename: 'shot.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.issueNumber).toBe(42);
    expect(feedbackService.publishSession).toHaveBeenCalledOnce();
  });
});
