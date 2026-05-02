// Wix Media REST client — uploads files to the site's Media Manager
// for use as bouquet images on Wix Stores products.
//
// Auth: reuses the existing WIX_API_KEY + WIX_SITE_ID env vars set for
// wixProductSync. The key needs the additional `Manage Media Manager`
// scope (MEDIA.SITE_MEDIA_FILES_UPLOAD) — see plan Task 0.
//
// Upload flow per Wix docs:
//   1. POST /files/generate-upload-url → { uploadUrl }
//   2. PUT bytes to uploadUrl → { file: { url, id, ... } }
//   3. Poll GET /files/:id until state === 'OK'
//
// All methods throw on non-2xx with response body in the error message
// so the caller can surface a useful toast (no silent catches).

const WIX_API_URL = 'https://www.wixapis.com';

function wixHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': process.env.WIX_API_KEY,
    'wix-site-id': process.env.WIX_SITE_ID,
  };
}

/**
 * Generates a signed upload URL for a single file.
 * @param {object} args
 * @param {string} args.mimeType - e.g. 'image/jpeg'
 * @param {string} args.fileName - e.g. 'bouquet-123.jpg'
 * @param {string} [args.parentFolderId] - optional folder under /media/
 * @returns {Promise<{ uploadUrl: string }>}
 */
export async function generateUploadUrl({ mimeType, fileName, parentFolderId }) {
  const body = { mimeType, fileName };
  if (parentFolderId) body.parentFolderId = parentFolderId;
  const res = await fetch(`${WIX_API_URL}/site-media/v1/files/generate-upload-url`, {
    method: 'POST',
    headers: wixHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix Media generate-upload-url ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * PUTs file bytes to a signed upload URL returned by generateUploadUrl.
 * @param {string} uploadUrl - signed URL from generateUploadUrl
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<{ file: { id: string, url: string, ... } }>}
 */
export async function uploadFile(uploadUrl, buffer, mimeType) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix Media uploadFile ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Polls GET /files/:id until file.state === 'OK' or timeout.
 * Wix takes 1–10s for typical images; raise timeoutMs if you see 504s.
 * @param {string} fileId
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=10000]
 * @param {number} [opts.intervalMs=400]
 */
export async function pollForReady(fileId, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const intervalMs = opts.intervalMs ?? 400;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${WIX_API_URL}/site-media/v1/files/${fileId}`, {
      method: 'GET',
      headers: wixHeaders(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Wix Media pollForReady ${res.status}: ${text}`);
    }
    const json = await res.json();
    if (json.file?.state === 'OK') return json.file;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Wix Media pollForReady timeout after ${timeoutMs}ms (fileId=${fileId})`);
}

/**
 * Best-effort bulk delete. Caller should not rely on this for cleanup
 * correctness; orphaned files are tracked in sync_log for owner review.
 * @param {string[]} fileIds
 */
export async function deleteFiles(fileIds) {
  if (!fileIds || fileIds.length === 0) return;
  const res = await fetch(`${WIX_API_URL}/site-media/v1/bulk/files/delete`, {
    method: 'POST',
    headers: wixHeaders(),
    body: JSON.stringify({ fileIds }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix Media deleteFiles ${res.status}: ${text}`);
  }
  return res.json();
}
