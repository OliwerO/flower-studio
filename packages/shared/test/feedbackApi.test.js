// @vitest-environment jsdom
//
// Regression guard for the 2026-05-29 incident: the owner could not publish
// reports with a desktop screenshot because the raw file exceeded the backend
// 5MB multer cap. publishFeedback must resize the screenshot BEFORE uploading
// (mirrors api/uploadImage.js). If this test goes red, we've regressed to
// shipping raw screenshots.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { postMock, resizeMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  resizeMock: vi.fn(),
}));

vi.mock('../api/client.js', () => ({ default: { post: postMock } }));
vi.mock('../utils/imageResize.js', () => ({ resizeImageBlob: resizeMock }));

const { publishFeedback } = await import('../api/feedback.js');

beforeEach(() => {
  vi.clearAllMocks();
  postMock.mockResolvedValue({ data: { issueUrl: 'u', issueNumber: 7 } });
});

describe('publishFeedback', () => {
  it('resizes the screenshot before uploading and sends the resized blob', async () => {
    const resized = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    resizeMock.mockResolvedValue(resized);
    const file = new File([new Uint8Array(10 * 1024 * 1024)], 'screenshot.png', { type: 'image/png' });

    const out = await publishFeedback({ sessionId: 's1', imageFile: file });

    expect(resizeMock).toHaveBeenCalledOnce();
    expect(resizeMock.mock.calls[0][0]).toBe(file);
    expect(resizeMock.mock.calls[0][1]).toMatchObject({ maxEdge: 1600 });

    const [url, form] = postMock.mock.calls[0];
    expect(url).toBe('/feedback/publish');
    expect(form.get('sessionId')).toBe('s1');
    // The uploaded blob is the small resized one (3 bytes), NOT the 10MB raw file.
    expect(form.get('image').size).toBe(resized.size);
    expect(form.get('image').type).toBe('image/jpeg');
    expect(out).toEqual({ issueUrl: 'u', issueNumber: 7 });
  });

  it('uploads without an image when none is attached (no resize call)', async () => {
    await publishFeedback({ sessionId: 's2', imageFile: null });

    expect(resizeMock).not.toHaveBeenCalled();
    const [url, form] = postMock.mock.calls[0];
    expect(url).toBe('/feedback/publish');
    expect(form.get('sessionId')).toBe('s2');
    expect(form.get('image')).toBeNull();
  });

  it('falls back to the raw file if resize throws', async () => {
    resizeMock.mockRejectedValue(new Error('decode failed'));
    const file = new File([new Uint8Array(100)], 'shot.webp', { type: 'image/webp' });

    await publishFeedback({ sessionId: 's3', imageFile: file });

    const [, form] = postMock.mock.calls[0];
    // Resize failed → the raw file (100 bytes) is uploaded as a fallback.
    expect(form.get('image').size).toBe(file.size);
  });
});
