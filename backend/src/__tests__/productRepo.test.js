import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/airtable.js', () => ({
  list:   vi.fn(),
  update: vi.fn(),
}));
vi.mock('../config/airtable.js', () => ({
  TABLES: { PRODUCT_CONFIG: 'tblProductConfig' },
}));

const airtable = await import('../services/airtable.js');

describe('productRepo.setImage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates Image URL on every Product Config row matching the Wix Product ID', async () => {
    airtable.list.mockResolvedValue([
      { id: 'rec1', 'Wix Product ID': 'prod-1', 'Wix Variant ID': 'v1' },
      { id: 'rec2', 'Wix Product ID': 'prod-1', 'Wix Variant ID': 'v2' },
    ]);
    airtable.update.mockResolvedValue({});
    const { setImage } = await import('../repos/productRepo.js');
    const out = await setImage('prod-1', 'https://x/img.jpg');
    expect(out).toEqual({ updatedCount: 2 });
    expect(airtable.update).toHaveBeenCalledWith('tblProductConfig', 'rec1', { 'Image URL': 'https://x/img.jpg' });
    expect(airtable.update).toHaveBeenCalledWith('tblProductConfig', 'rec2', { 'Image URL': 'https://x/img.jpg' });
  });

  it('returns updatedCount=0 when no rows match', async () => {
    airtable.list.mockResolvedValue([]);
    const { setImage } = await import('../repos/productRepo.js');
    const out = await setImage('missing', 'u');
    expect(out).toEqual({ updatedCount: 0 });
    expect(airtable.update).not.toHaveBeenCalled();
  });
});

describe('productRepo.getImage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns Image URL from the first matching variant row', async () => {
    airtable.list.mockResolvedValue([
      { id: 'rec1', 'Wix Product ID': 'prod-1', 'Image URL': 'https://x/a.jpg' },
    ]);
    const { getImage } = await import('../repos/productRepo.js');
    expect(await getImage('prod-1')).toBe('https://x/a.jpg');
  });

  it('returns empty string when no rows or no Image URL', async () => {
    airtable.list.mockResolvedValue([]);
    const { getImage } = await import('../repos/productRepo.js');
    expect(await getImage('p')).toBe('');
  });
});

describe('productRepo.getImagesBatch', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns Map<wixProductId, imageUrl> for all matching variants', async () => {
    airtable.list.mockResolvedValue([
      { id: 'r1', 'Wix Product ID': 'p1', 'Image URL': 'u1' },
      { id: 'r2', 'Wix Product ID': 'p1', 'Image URL': 'u1' },
      { id: 'r3', 'Wix Product ID': 'p2', 'Image URL': 'u2' },
    ]);
    const { getImagesBatch } = await import('../repos/productRepo.js');
    const out = await getImagesBatch(['p1', 'p2', 'p3']);
    expect(out.get('p1')).toBe('u1');
    expect(out.get('p2')).toBe('u2');
    expect(out.has('p3')).toBe(false);
  });

  it('returns empty Map when productIds empty', async () => {
    const { getImagesBatch } = await import('../repos/productRepo.js');
    const out = await getImagesBatch([]);
    expect(out.size).toBe(0);
    expect(airtable.list).not.toHaveBeenCalled();
  });
});
