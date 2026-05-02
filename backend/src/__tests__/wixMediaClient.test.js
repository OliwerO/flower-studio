import { describe, it, expect, vi, beforeEach } from 'vitest';

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
