import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('wixMediaClient.generateUploadUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('WIX_API_KEY', 'test-key');
    vi.stubEnv('WIX_SITE_ID', 'test-site');
  });

  it('POSTs to generate-upload-url with correct headers + body and returns uploadUrl', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ uploadUrl: 'https://upload.wix.com/signed/abc' }),
    });
    const { generateUploadUrl } = await import('../services/wixMediaClient.js');
    const out = await generateUploadUrl({ mimeType: 'image/jpeg', fileName: 'b.jpg' });
    expect(out).toEqual({ uploadUrl: 'https://upload.wix.com/signed/abc' });
    expect(fetch).toHaveBeenCalledWith(
      'https://www.wixapis.com/site-media/v1/files/generate-upload-url',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'test-key',
          'wix-site-id': 'test-site',
          'Content-Type': 'application/json',
        }),
        body: expect.stringContaining('"mimeType":"image/jpeg"'),
      })
    );
  });

  it('throws on non-2xx with response body in message', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid token',
    });
    const { generateUploadUrl } = await import('../services/wixMediaClient.js');
    await expect(generateUploadUrl({ mimeType: 'image/jpeg', fileName: 'x.jpg' }))
      .rejects.toThrow(/401.*invalid token/);
  });
});

describe('wixMediaClient.uploadFile', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });

  it('PUTs the buffer to the signed URL with Content-Type and returns parsed file descriptor', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ file: { id: 'file-1', url: 'https://static.wixstatic.com/x.jpg' } }),
    });
    const { uploadFile } = await import('../services/wixMediaClient.js');
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const out = await uploadFile('https://upload.wix.com/signed/abc', buf, 'image/jpeg');
    expect(out).toEqual({ file: { id: 'file-1', url: 'https://static.wixstatic.com/x.jpg' } });
    expect(fetch).toHaveBeenCalledWith(
      'https://upload.wix.com/signed/abc',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: buf,
      })
    );
  });

  it('throws on non-2xx', async () => {
    fetch.mockResolvedValue({ ok: false, status: 413, text: async () => 'too large' });
    const { uploadFile } = await import('../services/wixMediaClient.js');
    await expect(uploadFile('https://x', Buffer.alloc(0), 'image/png'))
      .rejects.toThrow(/413.*too large/);
  });
});

describe('wixMediaClient.pollForReady', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('returns the file once state is OK', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ file: { id: 'f', state: 'PENDING' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ file: { id: 'f', state: 'OK', url: 'u' } }) });
    const { pollForReady } = await import('../services/wixMediaClient.js');
    const promise = pollForReady('f', { timeoutMs: 5000, intervalMs: 200 });
    await vi.advanceTimersByTimeAsync(250);
    const out = await promise;
    expect(out).toEqual({ id: 'f', state: 'OK', url: 'u' });
  });

  it('throws on timeout', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ file: { id: 'f', state: 'PENDING' } }) });
    const { pollForReady } = await import('../services/wixMediaClient.js');
    const promise = pollForReady('f', { timeoutMs: 1000, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(1100);
    await expect(promise).rejects.toThrow(/timeout/i);
  });
});

describe('wixMediaClient.deleteFiles', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });

  it('POSTs file ids to bulk delete endpoint', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    const { deleteFiles } = await import('../services/wixMediaClient.js');
    await deleteFiles(['f1', 'f2']);
    expect(fetch).toHaveBeenCalledWith(
      'https://www.wixapis.com/site-media/v1/bulk/files/delete',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"fileIds":["f1","f2"]'),
      })
    );
  });
});
