// productRepo.test.js — Phase 6: productRepo is now a thin delegation layer
// on top of productConfigRepo. These tests verify that the delegation is wired
// correctly (the right method is called with the right args) without needing
// a live Postgres instance.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../repos/productConfigRepo.js', () => ({
  setImage:       vi.fn(),
  getImage:       vi.fn(),
  getImagesBatch: vi.fn(),
}));

const productConfigRepo = await import('../repos/productConfigRepo.js');

describe('productRepo.setImage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('delegates to productConfigRepo.setImage and returns result', async () => {
    productConfigRepo.setImage.mockResolvedValue({ updatedCount: 2 });
    const { setImage } = await import('../repos/productRepo.js');
    const out = await setImage('prod-1', 'https://x/img.jpg');
    expect(productConfigRepo.setImage).toHaveBeenCalledWith('prod-1', 'https://x/img.jpg');
    expect(out).toEqual({ updatedCount: 2 });
  });

  it('returns updatedCount=0 when no rows match', async () => {
    productConfigRepo.setImage.mockResolvedValue({ updatedCount: 0 });
    const { setImage } = await import('../repos/productRepo.js');
    const out = await setImage('missing', 'u');
    expect(out).toEqual({ updatedCount: 0 });
  });
});

describe('productRepo.getImage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('delegates to productConfigRepo.getImage and returns URL', async () => {
    productConfigRepo.getImage.mockResolvedValue('https://x/a.jpg');
    const { getImage } = await import('../repos/productRepo.js');
    expect(await getImage('prod-1')).toBe('https://x/a.jpg');
    expect(productConfigRepo.getImage).toHaveBeenCalledWith('prod-1');
  });

  it('returns empty string when productConfigRepo returns empty string', async () => {
    productConfigRepo.getImage.mockResolvedValue('');
    const { getImage } = await import('../repos/productRepo.js');
    expect(await getImage('p')).toBe('');
  });
});

describe('productRepo.getImagesBatch', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('delegates to productConfigRepo.getImagesBatch and returns Map', async () => {
    const m = new Map([['p1', 'u1'], ['p2', 'u2']]);
    productConfigRepo.getImagesBatch.mockResolvedValue(m);
    const { getImagesBatch } = await import('../repos/productRepo.js');
    const out = await getImagesBatch(['p1', 'p2', 'p3']);
    expect(productConfigRepo.getImagesBatch).toHaveBeenCalledWith(['p1', 'p2', 'p3']);
    expect(out.get('p1')).toBe('u1');
    expect(out.get('p2')).toBe('u2');
    expect(out.has('p3')).toBe(false);
  });

  it('returns empty Map when ids are empty', async () => {
    productConfigRepo.getImagesBatch.mockResolvedValue(new Map());
    const { getImagesBatch } = await import('../repos/productRepo.js');
    const out = await getImagesBatch([]);
    expect(out.size).toBe(0);
  });
});
