// Wraps the multipart POST /products/:wixProductId/image call.
// Resizes the file client-side first to stay well under the 5MB cap.

import client from './client.js';
import { resizeImageBlob } from '../utils/imageResize.js';

export async function uploadBouquetImage({ wixProductId, file, onProgress }) {
  const resized = await resizeImageBlob(file, { maxEdge: 1200, quality: 0.85 });
  const form = new FormData();
  form.append('image', resized, file.name?.replace(/\.[^.]+$/, '.jpg') || 'bouquet.jpg');
  const res = await client.post(`/products/${wixProductId}/image`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round(100 * e.loaded / e.total));
    },
  });
  return res.data; // { imageUrl }
}

export async function removeBouquetImage(wixProductId) {
  const res = await client.delete(`/products/${wixProductId}/image`);
  return res.data; // { ok: true }
}

// Per-order bouquet image: separate endpoint, distinct semantic — overrides
// the storefront product image for one specific order.
export async function uploadOrderImage({ orderId, file, onProgress }) {
  const resized = await resizeImageBlob(file, { maxEdge: 1200, quality: 0.85 });
  const form = new FormData();
  form.append('image', resized, file.name?.replace(/\.[^.]+$/, '.jpg') || 'order-bouquet.jpg');
  const res = await client.post(`/orders/${orderId}/image`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round(100 * e.loaded / e.total));
    },
  });
  return res.data; // { imageUrl }
}

export async function removeOrderImage(orderId) {
  const res = await client.delete(`/orders/${orderId}/image`);
  return res.data; // { ok: true }
}
