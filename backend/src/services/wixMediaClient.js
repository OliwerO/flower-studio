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
