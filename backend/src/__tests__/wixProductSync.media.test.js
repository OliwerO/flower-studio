import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('wixProductSync media helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('WIX_API_KEY', 'k');
    vi.stubEnv('WIX_SITE_ID', 's');
  });

  it('clearProductMedia POSTs delete to product media endpoint', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ product: {} }) });
    const { clearProductMedia } = await import('../services/wixProductSync.js');
    await clearProductMedia('prod-1');
    expect(fetch).toHaveBeenCalledWith(
      'https://www.wixapis.com/stores/v1/products/prod-1/media/all',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('attachMediaToProduct POSTs media url to product media endpoint', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ product: {} }) });
    const { attachMediaToProduct } = await import('../services/wixProductSync.js');
    await attachMediaToProduct('prod-1', 'https://static.wixstatic.com/x.jpg');
    expect(fetch).toHaveBeenCalledWith(
      'https://www.wixapis.com/stores/v1/products/prod-1/media',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('https://static.wixstatic.com/x.jpg'),
      })
    );
  });

  it('attachMediaToProduct throws on non-2xx', async () => {
    fetch.mockResolvedValue({ ok: false, status: 404, text: async () => 'PRODUCT_NOT_FOUND' });
    const { attachMediaToProduct } = await import('../services/wixProductSync.js');
    await expect(attachMediaToProduct('bad', 'u')).rejects.toThrow(/404.*PRODUCT_NOT_FOUND/);
  });
});
