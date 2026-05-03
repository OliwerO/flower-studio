// Resize an image Blob/File to a max long-edge using canvas, then re-encode
// as JPEG with the given quality. Used to keep bouquet image uploads under
// ~500KB on the wire.
//
// Why client-side: phones routinely take 3000x4000+ photos. Sending the
// raw file would push backend memory, multer limits, and the Wix Media
// upload to their edges. A 1200px long edge at q=0.85 is visually clean
// for the storefront listing AND the driver thumbnail/zoom view.

export async function resizeImageBlob(blob, { maxEdge = 1200, quality = 0.85 } = {}) {
  const bitmap = await createImageBitmap(blob);
  const { width: w, height: h } = bitmap;
  const longEdge = Math.max(w, h);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const newW = Math.round(w * scale);
  const newH = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = newW;
  canvas.height = newH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, newW, newH);
  bitmap.close?.();

  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => b ? resolve(b) : reject(new Error('Canvas toBlob returned null')),
      'image/jpeg',
      quality,
    );
  });
}
