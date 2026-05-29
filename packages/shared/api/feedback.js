// Wraps the multipart POST /feedback/publish call.
//
// Resizes the screenshot client-side first to stay well under the backend's 5MB
// multer cap. Desktop (dashboard) screenshots are large PNGs that routinely
// exceed 5MB — sending the raw file is what blocked the owner from filing
// reports on 2026-05-29 (the florist app's phone-sized screenshots stayed under
// the cap, so it worked there). Mirrors api/uploadImage.js.

import client from './client.js';
import { resizeImageBlob } from '../utils/imageResize.js';

export async function publishFeedback({ sessionId, imageFile }) {
  const form = new FormData();
  form.append('sessionId', sessionId);

  if (imageFile) {
    let blob = imageFile;
    try {
      // 1600px long edge keeps UI text legible while landing well under 5MB.
      blob = await resizeImageBlob(imageFile, { maxEdge: 1600, quality: 0.85 });
    } catch {
      // Resize can fail on unsupported/corrupt input; fall back to the raw file.
      // The backend now returns a clear 413 if it is still too large.
      blob = imageFile;
    }
    const name = imageFile.name?.replace(/\.[^.]+$/, '.jpg') || 'screenshot.jpg';
    form.append('image', blob, name);
  }

  const res = await client.post('/feedback/publish', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data; // { issueUrl, issueNumber }
}
