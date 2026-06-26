import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('fetchProductTranslations', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('WIX_API_KEY', 'k');
    vi.stubEnv('WIX_SITE_ID', 's');
  });

  it('maps Wix translation-content rows to {locale:{title,description}}', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ contents: [
        { locale: 'pl', fields: { 'product-name': { textValue: 'Bukiet dnia 1 - XL' }, 'product-description': { textValue: '<p>Opis</p>' } } },
        { locale: 'ru', fields: { 'product-name': { textValue: 'Микс дня 1 - XL' } } },
      ] }),
    });
    const { fetchProductTranslations } = await import('../services/wixProductSync.js');
    const out = await fetchProductTranslations('prod-1');
    expect(out.pl).toEqual({ title: 'Bukiet dnia 1 - XL', description: '<p>Opis</p>' });
    expect(out.ru).toEqual({ title: 'Микс дня 1 - XL' });
    expect(fetch).toHaveBeenCalledWith(
      'https://www.wixapis.com/translation-content/v1/contents/query',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"entityId":"prod-1"') }),
    );
  });

  it('throws on non-2xx', async () => {
    fetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const { fetchProductTranslations } = await import('../services/wixProductSync.js');
    await expect(fetchProductTranslations('p')).rejects.toThrow(/500|boom|translation/i);
  });
});
