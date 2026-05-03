// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsdom ships HTMLCanvasElement but `getContext('2d')` returns null because
// it doesn't bundle a real 2D rasteriser. Stub it once for the suite so the
// utility's drawImage call has somewhere to go.
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() }));
});

describe('resizeImageBlob', () => {
  it('returns a Blob with image/jpeg type and shrinks long-edge to maxEdge', async () => {
    const fakeBlob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    HTMLCanvasElement.prototype.toBlob = vi.fn(function (cb) { cb(fakeBlob); });

    globalThis.createImageBitmap = vi.fn().mockResolvedValue({
      width: 4000, height: 3000, close: () => {},
    });

    const { resizeImageBlob } = await import('../utils/imageResize.js');
    const inputBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const out = await resizeImageBlob(inputBlob, { maxEdge: 1200, quality: 0.85 });
    expect(out).toBeInstanceOf(Blob);
    expect(out.type).toBe('image/jpeg');

    const drawCalls = HTMLCanvasElement.prototype.toBlob.mock.calls;
    expect(drawCalls.length).toBe(1);
    expect(drawCalls[0][1]).toBe('image/jpeg');
    expect(drawCalls[0][2]).toBe(0.85);
  });

  it('does not upscale when image is smaller than maxEdge', async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn(function (cb) {
      cb(new Blob([new Uint8Array()], { type: 'image/jpeg' }));
    });
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({
      width: 800, height: 600, close: () => {},
    });
    const { resizeImageBlob } = await import('../utils/imageResize.js');
    await resizeImageBlob(new Blob([], { type: 'image/jpeg' }), { maxEdge: 1200 });
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalled();
  });
});
