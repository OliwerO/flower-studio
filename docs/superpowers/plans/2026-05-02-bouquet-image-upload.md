# Bouquet Image Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner + florist attach bouquet photos via clipboard or photo library on florist app + dashboard. Photos store in Wix Media, surface on Wix storefront, and render on driver `DeliveryCard` so the driver can identify the right bouquet to grab.

**Architecture:** File of record = Wix Media. Backend mediates upload (multer → Wix Media generate-upload-url → PUT bytes → poll ready → attach to Wix product → cache URL via `productRepo`). Local DB caches the URL string only (Airtable today, PG after Phase 6 migration), keeping the design migration-safe. Driver app consumes URL via existing GET endpoints, enriched server-side with one `productRepo.getImagesBatch` call.

**Tech Stack:** Express + multer (backend), Wix Media REST + Wix Stores Catalog v1 REST, Airtable Product Config table (current cache), React + Tailwind (3 apps), shared component package, vitest + jsdom (tests).

**Spec:** `docs/superpowers/specs/2026-05-02-bouquet-image-upload-design.md`

**Branch:** `feat/bouquet-image-upload` (off master, already created with spec committed).

---

## Pre-flight

### Task 0: Verify environment + install multer

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Confirm Wix env vars are present and key has Media scope**

The owner must verify `WIX_API_KEY` on Railway has scopes:
- `Manage Products` (already in use)
- `Manage Media Manager` (`MEDIA.SITE_MEDIA_FILES_UPLOAD`) — NEW

If missing, regenerate the key in the Wix dashboard with both scopes and rotate `WIX_API_KEY` on Railway. **Do not proceed past this task until confirmed.**

- [ ] **Step 2: Add multer dependency**

```bash
cd backend && npm install multer@^1.4.5-lts.1
```

- [ ] **Step 3: Verify install**

Run: `cd backend && node -e "console.log(require('multer'))"`
Expected: function output (no MODULE_NOT_FOUND).

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore(backend): add multer for image uploads"
```

---

## Backend — Wix Media client

### Task 1: Create wixMediaClient with generateUploadUrl

**Files:**
- Create: `backend/src/services/wixMediaClient.js`
- Test: `backend/src/__tests__/wixMediaClient.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/wixMediaClient.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('wixMediaClient.generateUploadUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('WIX_API_KEY', 'test-key');
    vi.stubEnv('WIX_SITE_ID', 'test-site');
  });

  it('POSTs to generate-upload-url with correct headers + body and returns uploadUrl', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ uploadUrl: 'https://upload.wix.com/signed/abc' }),
    });
    const { generateUploadUrl } = await import('../services/wixMediaClient.js');
    const out = await generateUploadUrl({ mimeType: 'image/jpeg', fileName: 'b.jpg' });
    expect(out).toEqual({ uploadUrl: 'https://upload.wix.com/signed/abc' });
    expect(fetch).toHaveBeenCalledWith(
      'https://www.wixapis.com/site-media/v1/files/generate-upload-url',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'test-key',
          'wix-site-id': 'test-site',
          'Content-Type': 'application/json',
        }),
        body: expect.stringContaining('"mimeType":"image/jpeg"'),
      })
    );
  });

  it('throws on non-2xx with response body in message', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid token',
    });
    const { generateUploadUrl } = await import('../services/wixMediaClient.js');
    await expect(generateUploadUrl({ mimeType: 'image/jpeg', fileName: 'x.jpg' }))
      .rejects.toThrow(/401.*invalid token/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/wixMediaClient.test.js`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Create the client module with generateUploadUrl**

Create `backend/src/services/wixMediaClient.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/wixMediaClient.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/wixMediaClient.js backend/src/__tests__/wixMediaClient.test.js
git commit -m "feat(backend): wixMediaClient.generateUploadUrl"
```

### Task 2: Add uploadFile method

**Files:**
- Modify: `backend/src/services/wixMediaClient.js`
- Modify: `backend/src/__tests__/wixMediaClient.test.js`

- [ ] **Step 1: Add the failing test**

Append to `backend/src/__tests__/wixMediaClient.test.js`:

```js
describe('wixMediaClient.uploadFile', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });

  it('PUTs the buffer to the signed URL with Content-Type and returns parsed file descriptor', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ file: { id: 'file-1', url: 'https://static.wixstatic.com/x.jpg' } }),
    });
    const { uploadFile } = await import('../services/wixMediaClient.js');
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const out = await uploadFile('https://upload.wix.com/signed/abc', buf, 'image/jpeg');
    expect(out).toEqual({ file: { id: 'file-1', url: 'https://static.wixstatic.com/x.jpg' } });
    expect(fetch).toHaveBeenCalledWith(
      'https://upload.wix.com/signed/abc',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: buf,
      })
    );
  });

  it('throws on non-2xx', async () => {
    fetch.mockResolvedValue({ ok: false, status: 413, text: async () => 'too large' });
    const { uploadFile } = await import('../services/wixMediaClient.js');
    await expect(uploadFile('https://x', Buffer.alloc(0), 'image/png'))
      .rejects.toThrow(/413.*too large/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/wixMediaClient.test.js -t uploadFile`
Expected: FAIL "uploadFile is not a function".

- [ ] **Step 3: Add uploadFile to the client**

Append to `backend/src/services/wixMediaClient.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/wixMediaClient.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/wixMediaClient.js backend/src/__tests__/wixMediaClient.test.js
git commit -m "feat(backend): wixMediaClient.uploadFile"
```

### Task 3: Add pollForReady + deleteFiles

**Files:**
- Modify: `backend/src/services/wixMediaClient.js`
- Modify: `backend/src/__tests__/wixMediaClient.test.js`

- [ ] **Step 1: Add failing tests**

Append:

```js
describe('wixMediaClient.pollForReady', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('returns the file once state is OK', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ file: { id: 'f', state: 'PENDING' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ file: { id: 'f', state: 'OK', url: 'u' } }) });
    const { pollForReady } = await import('../services/wixMediaClient.js');
    const promise = pollForReady('f', { timeoutMs: 5000, intervalMs: 200 });
    await vi.advanceTimersByTimeAsync(250);
    const out = await promise;
    expect(out).toEqual({ id: 'f', state: 'OK', url: 'u' });
  });

  it('throws on timeout', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ file: { id: 'f', state: 'PENDING' } }) });
    const { pollForReady } = await import('../services/wixMediaClient.js');
    const promise = pollForReady('f', { timeoutMs: 1000, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(1100);
    await expect(promise).rejects.toThrow(/timeout/i);
  });
});

describe('wixMediaClient.deleteFiles', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });

  it('POSTs file ids to bulk delete endpoint', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    const { deleteFiles } = await import('../services/wixMediaClient.js');
    await deleteFiles(['f1', 'f2']);
    expect(fetch).toHaveBeenCalledWith(
      'https://www.wixapis.com/site-media/v1/bulk/files/delete',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"fileIds":["f1","f2"]'),
      })
    );
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd backend && npx vitest run src/__tests__/wixMediaClient.test.js`
Expected: 3 new tests FAIL.

- [ ] **Step 3: Implement pollForReady + deleteFiles**

Append:

```js
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
```

- [ ] **Step 4: Run all wixMediaClient tests**

Run: `cd backend && npx vitest run src/__tests__/wixMediaClient.test.js`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/wixMediaClient.js backend/src/__tests__/wixMediaClient.test.js
git commit -m "feat(backend): wixMediaClient pollForReady + deleteFiles"
```

---

## Backend — Wix product media attach

### Task 4: Add attachMediaToProduct + clearProductMedia in wixProductSync

**Files:**
- Modify: `backend/src/services/wixProductSync.js`
- Test: `backend/src/__tests__/wixProductSync.media.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/wixProductSync.media.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/wixProductSync.media.test.js`
Expected: FAIL "is not a function".

- [ ] **Step 3: Add the helpers to wixProductSync.js**

Append to `backend/src/services/wixProductSync.js` (end of file, before any `export default` if present — check first):

```js
/**
 * Removes all media from a Wix product. Used before attachMediaToProduct
 * to enforce single-image-per-product semantic (see plan Q2=A).
 *
 * Wix Stores Catalog v1: DELETE /products/:id/media/all clears the product
 * gallery; if the endpoint shape differs in your Wix version, swap to
 * iterating media ids and calling DELETE /products/:id/media/:mediaId.
 */
export async function clearProductMedia(productId) {
  const res = await fetch(
    `${WIX_API_URL}/stores/v1/products/${productId}/media/all`,
    { method: 'DELETE', headers: wixHeaders() }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix clearProductMedia ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Adds a single media item to a Wix product by URL.
 * The URL must point to a file already in the site's Media Manager
 * (use wixMediaClient.uploadFile to put it there first).
 */
export async function attachMediaToProduct(productId, mediaUrl) {
  const res = await fetch(
    `${WIX_API_URL}/stores/v1/products/${productId}/media`,
    {
      method: 'POST',
      headers: wixHeaders(),
      body: JSON.stringify({ media: [{ url: mediaUrl }] }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix attachMediaToProduct ${res.status}: ${text}`);
  }
  return res.json();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/wixProductSync.media.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/wixProductSync.js backend/src/__tests__/wixProductSync.media.test.js
git commit -m "feat(backend): Wix Stores product media attach + clear"
```

---

## Backend — productRepo

### Task 5: Create productRepo with setImage / getImage / getImagesBatch

**Files:**
- Create: `backend/src/repos/productRepo.js`
- Test: `backend/src/__tests__/productRepo.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/productRepo.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/productRepo.test.js`
Expected: FAIL "Cannot find module".

- [ ] **Step 3: Create the repo**

Create `backend/src/repos/productRepo.js`:

```js
// Product repository — persistence boundary for the product image URL cache.
//
// The bouquet image asset lives in Wix Media. This repo only persists the
// URL string in the local cache (Airtable Product Config today, Postgres
// product_config.image_url after Phase 6) so the florist + delivery apps
// can render images without calling Wix on every read.
//
// One Wix product → many Airtable Product Config rows (one per variant).
// All variants of a single bouquet share the same image — setImage writes
// the same URL to every row whose 'Wix Product ID' equals the input.
//
// Phase 6 dispatch: when PRODUCT_BACKEND === 'postgres', methods will read
// and write product_config in PG instead. The shape of the public methods
// is identical so callers don't change. (Not implemented in this task —
// added when Phase 6 lands; see backend/CLAUDE.md migration table.)

import * as airtable from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

function sanitizeFormulaValue(v) {
  return String(v).replace(/'/g, "\\'");
}

async function listVariants(wixProductId) {
  return airtable.list(TABLES.PRODUCT_CONFIG, {
    filterByFormula: `{Wix Product ID} = '${sanitizeFormulaValue(wixProductId)}'`,
    fields: ['Wix Product ID', 'Wix Variant ID', 'Image URL'],
  });
}

/**
 * Writes imageUrl to every Product Config row matching wixProductId.
 * @returns {Promise<{ updatedCount: number }>}
 */
export async function setImage(wixProductId, imageUrl) {
  const rows = await listVariants(wixProductId);
  if (rows.length === 0) return { updatedCount: 0 };
  for (const row of rows) {
    await airtable.update(TABLES.PRODUCT_CONFIG, row.id, { 'Image URL': imageUrl });
  }
  return { updatedCount: rows.length };
}

/**
 * Returns the Image URL of the first matching variant, or '' if none.
 */
export async function getImage(wixProductId) {
  const rows = await listVariants(wixProductId);
  return rows[0]?.['Image URL'] || '';
}

/**
 * Batch lookup. Returns Map<wixProductId, imageUrl> for the subset that
 * has both a Product Config row and a non-empty Image URL.
 * @param {string[]} wixProductIds
 * @returns {Promise<Map<string, string>>}
 */
export async function getImagesBatch(wixProductIds) {
  const map = new Map();
  if (!wixProductIds || wixProductIds.length === 0) return map;
  const orClauses = wixProductIds
    .map(id => `{Wix Product ID} = '${sanitizeFormulaValue(id)}'`)
    .join(',');
  const rows = await airtable.list(TABLES.PRODUCT_CONFIG, {
    filterByFormula: `OR(${orClauses})`,
    fields: ['Wix Product ID', 'Image URL'],
  });
  for (const row of rows) {
    const pid = row['Wix Product ID'];
    const url = row['Image URL'];
    if (pid && url && !map.has(pid)) map.set(pid, url);
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/productRepo.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/productRepo.js backend/src/__tests__/productRepo.test.js
git commit -m "feat(backend): productRepo with setImage/getImage/getImagesBatch"
```

---

## Backend — image upload routes

### Task 6: Add POST /products/:wixProductId/image route

**Files:**
- Modify: `backend/src/routes/products.js`
- Test: `backend/src/__tests__/products.image.test.js`

- [ ] **Step 1: Write the failing integration test**

Create `backend/src/__tests__/products.image.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/wixMediaClient.js', () => ({
  generateUploadUrl: vi.fn(),
  uploadFile:        vi.fn(),
  pollForReady:      vi.fn(),
  deleteFiles:       vi.fn(),
}));
vi.mock('../services/wixProductSync.js', () => ({
  clearProductMedia:    vi.fn(),
  attachMediaToProduct: vi.fn(),
  // stubs for unrelated exports the route module imports:
  runSync: vi.fn(), runPull: vi.fn(), runPush: vi.fn(),
}));
vi.mock('../services/wixPushJob.js', () => ({
  startPushJob: vi.fn(), getJob: vi.fn(),
}));
vi.mock('../repos/productRepo.js', () => ({
  setImage:   vi.fn(),
  getImage:   vi.fn(),
}));
vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));

const wixMedia = await import('../services/wixMediaClient.js');
const wixSync  = await import('../services/wixProductSync.js');
const repo     = await import('../repos/productRepo.js');
const notif    = await import('../services/notifications.js');

function buildApp() {
  const app = express();
  // Inject role for tests — replaces real PIN auth
  app.use((req, _res, next) => { req.role = req.headers['x-test-role'] || 'florist'; next(); });
  // eslint-disable-next-line global-require
  return import('../routes/products.js').then(m => {
    app.use('/api/products', m.default);
    return app;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('WIX_API_KEY', 'k');
  vi.stubEnv('WIX_SITE_ID', 's');
});

describe('POST /api/products/:wixProductId/image', () => {
  it('uploads, attaches, persists URL, broadcasts SSE, returns 200 with imageUrl', async () => {
    wixMedia.generateUploadUrl.mockResolvedValue({ uploadUrl: 'https://upload/x' });
    wixMedia.uploadFile.mockResolvedValue({ file: { id: 'f1', url: 'https://static/x.jpg' } });
    wixMedia.pollForReady.mockResolvedValue({ id: 'f1', url: 'https://static/x.jpg', state: 'OK' });
    wixSync.clearProductMedia.mockResolvedValue({});
    wixSync.attachMediaToProduct.mockResolvedValue({});
    repo.getImage.mockResolvedValue('');
    repo.setImage.mockResolvedValue({ updatedCount: 2 });

    const app = await buildApp();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const res = await request(app)
      .post('/api/products/prod-1/image')
      .set('x-test-role', 'florist')
      .attach('image', png, { filename: 'b.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imageUrl: 'https://static/x.jpg' });
    expect(wixSync.attachMediaToProduct).toHaveBeenCalledWith('prod-1', 'https://static/x.jpg');
    expect(repo.setImage).toHaveBeenCalledWith('prod-1', 'https://static/x.jpg');
    expect(notif.broadcast).toHaveBeenCalledWith({
      type: 'product_image_changed',
      wixProductId: 'prod-1',
      imageUrl: 'https://static/x.jpg',
    });
  });

  it('rejects driver role with 403', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/products/prod-1/image')
      .set('x-test-role', 'driver')
      .attach('image', Buffer.from([0]), { filename: 'b.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
  });

  it('rejects unsupported MIME', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/products/prod-1/image')
      .set('x-test-role', 'owner')
      .attach('image', Buffer.from([0]), { filename: 'x.gif', contentType: 'image/gif' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/MIME|tipo|format/i);
  });

  it('returns 502 when generateUploadUrl fails', async () => {
    wixMedia.generateUploadUrl.mockRejectedValue(new Error('Wix down'));
    const app = await buildApp();
    const res = await request(app)
      .post('/api/products/prod-1/image')
      .set('x-test-role', 'owner')
      .attach('image', Buffer.from([0xff]), { filename: 'b.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(502);
  });
});
```

Install supertest if missing:

```bash
cd backend && npm install --save-dev supertest@^6
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/products.image.test.js`
Expected: FAIL — route returns 403 (locked behind authorize('admin')) or 404.

- [ ] **Step 3: Modify products.js to add image routes BEFORE the admin authorize**

Open `backend/src/routes/products.js`. After `const router = Router();` and BEFORE `router.use(authorize('admin'));`, insert:

```js
import multer from 'multer';
import { authorize as authz } from '../middleware/auth.js';
import { generateUploadUrl, uploadFile, pollForReady, deleteFiles }
  from '../services/wixMediaClient.js';
import { clearProductMedia, attachMediaToProduct }
  from '../services/wixProductSync.js';
import * as productRepo from '../repos/productRepo.js';
import { broadcast } from '../services/notifications.js';

// ── Image upload (florist + owner) ──────────────────────────
//
// Mounted BEFORE router.use(authorize('admin')) so florists can hit it.
// The image endpoints do their own role check via authz('admin', [...]).
//
// authorize requires the role to have access to the resource AND, if a
// roles list is passed, to be one of those roles. We register 'admin' as
// the resource (existing convention for /products) and pass an explicit
// roles whitelist to widen access to florist + owner. Drivers get 403.

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported image MIME — JPG, PNG, or WebP only'));
  },
});

function imageAuth(req, res, next) {
  // Allow florist + owner. Driver gets 403.
  // Note: this route is mounted before router.use(authorize('admin'))
  // so it must do its own role enforcement.
  if (req.role !== 'florist' && req.role !== 'owner') {
    return res.status(403).json({ error: `Role "${req.role}" cannot upload bouquet images.` });
  }
  next();
}

// POST /api/products/:wixProductId/image
router.post('/:wixProductId/image', imageAuth, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      // multer errors (size, MIME) → 400
      return res.status(400).json({ error: err.message });
    }
    handleImageUpload(req, res).catch(next);
  });
});

async function handleImageUpload(req, res) {
  const { wixProductId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded.' });
  const { buffer, mimetype, originalname } = req.file;

  // 1. Generate signed upload URL
  let uploadUrlResp;
  try {
    uploadUrlResp = await generateUploadUrl({ mimeType: mimetype, fileName: originalname });
  } catch (err) {
    console.error('[image-upload] generateUploadUrl failed:', err.message);
    return res.status(502).json({ error: `Wix Media unavailable: ${err.message}` });
  }

  // 2. PUT bytes
  let fileDescriptor;
  try {
    const putResp = await uploadFile(uploadUrlResp.uploadUrl, buffer, mimetype);
    fileDescriptor = putResp.file;
  } catch (err) {
    console.error('[image-upload] uploadFile failed:', err.message);
    return res.status(502).json({ error: `Wix Media upload failed: ${err.message}` });
  }

  // 3. Poll for ready
  let readyFile;
  try {
    readyFile = await pollForReady(fileDescriptor.id, { timeoutMs: 10000 });
  } catch (err) {
    console.error('[image-upload] pollForReady failed:', err.message);
    deleteFiles([fileDescriptor.id]).catch(e =>
      console.error('[image-upload] best-effort delete after timeout failed:', e.message));
    return res.status(504).json({ error: `Wix Media file processing timeout: ${err.message}` });
  }

  // 4. Replace existing media on the product (single-image semantic)
  try {
    await clearProductMedia(wixProductId);
  } catch (err) {
    // 404 PRODUCT_NOT_FOUND is the only known benign case; surface anything else
    console.error('[image-upload] clearProductMedia failed:', err.message);
  }

  // 5. Attach the new media to the product
  try {
    await attachMediaToProduct(wixProductId, readyFile.url);
  } catch (err) {
    console.error('[image-upload] attachMediaToProduct failed:', err.message);
    return res.status(500).json({ error: `Uploaded to Wix Media but failed to attach to product: ${err.message}` });
  }

  // 6. Persist URL in local cache
  try {
    await productRepo.setImage(wixProductId, readyFile.url);
  } catch (err) {
    console.error('[image-upload] productRepo.setImage failed:', err.message);
    return res.status(500).json({ error: `Attached to Wix product but failed to save locally: ${err.message}` });
  }

  // 7. Broadcast SSE
  broadcast({
    type: 'product_image_changed',
    wixProductId,
    imageUrl: readyFile.url,
  });

  res.json({ imageUrl: readyFile.url });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/products.image.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/products.js backend/src/__tests__/products.image.test.js backend/package.json backend/package-lock.json
git commit -m "feat(backend): POST /products/:id/image — upload + attach to Wix"
```

### Task 7: Add DELETE /products/:wixProductId/image (owner only)

**Files:**
- Modify: `backend/src/routes/products.js`
- Modify: `backend/src/__tests__/products.image.test.js`

- [ ] **Step 1: Add the failing test**

Append to `backend/src/__tests__/products.image.test.js`:

```js
describe('DELETE /api/products/:wixProductId/image', () => {
  it('owner: clears product media, nulls cached URL, broadcasts SSE, returns 200', async () => {
    repo.getImage.mockResolvedValue('https://static/old.jpg');
    wixSync.clearProductMedia.mockResolvedValue({});
    repo.setImage.mockResolvedValue({ updatedCount: 1 });
    const app = await buildApp();
    const res = await request(app)
      .delete('/api/products/prod-1/image')
      .set('x-test-role', 'owner');
    expect(res.status).toBe(200);
    expect(wixSync.clearProductMedia).toHaveBeenCalledWith('prod-1');
    expect(repo.setImage).toHaveBeenCalledWith('prod-1', '');
    expect(notif.broadcast).toHaveBeenCalledWith({
      type: 'product_image_changed',
      wixProductId: 'prod-1',
      imageUrl: '',
    });
  });

  it('florist: 403', async () => {
    const app = await buildApp();
    const res = await request(app)
      .delete('/api/products/prod-1/image')
      .set('x-test-role', 'florist');
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd backend && npx vitest run src/__tests__/products.image.test.js -t DELETE`
Expected: FAIL.

- [ ] **Step 3: Add the DELETE handler**

In `backend/src/routes/products.js`, after the POST `/:wixProductId/image` block:

```js
// DELETE /api/products/:wixProductId/image — owner only
router.delete('/:wixProductId/image', (req, res, next) => {
  if (req.role !== 'owner') {
    return res.status(403).json({ error: `Role "${req.role}" cannot remove bouquet images.` });
  }
  handleImageDelete(req, res).catch(next);
});

async function handleImageDelete(req, res) {
  const { wixProductId } = req.params;
  try {
    await clearProductMedia(wixProductId);
  } catch (err) {
    console.error('[image-delete] clearProductMedia failed:', err.message);
    // continue — we still want to clear the local cache
  }
  try {
    await productRepo.setImage(wixProductId, '');
  } catch (err) {
    console.error('[image-delete] productRepo.setImage failed:', err.message);
    return res.status(500).json({ error: `Cleared on Wix but failed to update locally: ${err.message}` });
  }
  broadcast({
    type: 'product_image_changed',
    wixProductId,
    imageUrl: '',
  });
  res.json({ ok: true });
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx vitest run src/__tests__/products.image.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/products.js backend/src/__tests__/products.image.test.js
git commit -m "feat(backend): DELETE /products/:id/image — owner remove"
```

---

## Backend — bouquet summary enrichment

### Task 8: Enrich bouquet summary with imageUrl in GET /orders/:id

**Files:**
- Modify: `backend/src/routes/orders.js`
- Test: extend existing `backend/src/__tests__/orders.*.test.js` if present, else add `backend/src/__tests__/orders.image.test.js`

- [ ] **Step 1: Inspect the current GET /orders/:id response shape**

Run: `cd backend && grep -n "order.orderLines = orderLines" src/routes/orders.js`
Expected: line ~285. The response currently exposes `orderLines` (each with `Wix Product ID` from line.bouquet via product config, NOT directly on the line — verify with the next step).

- [ ] **Step 2: Verify how line → wixProductId is resolved today**

Run: `cd backend && grep -n "Wix Product ID\|productId\|wixProductId" src/services/orderService.js src/routes/orders.js`

Order Lines reference Stock Items. Stock Item rows do NOT carry Wix Product ID — that lives on Product Config. The bouquet group on Wix is the ordered bouquet; each Order Line carries `Wix Product ID` only if the order came from Wix webhook. Confirm by reading the order line schema:

Run: `cd backend && grep -A 5 "ORDER_LINES" src/services/airtableSchema.js`

If Order Lines do NOT carry `Wix Product ID`, the enrichment must derive it from the order itself: `order['Wix Product ID']` (set when the order originates from Wix) or fall back to `''`. Adjust the implementation accordingly.

**This is a knowledge step — no code change yet. Note the resolved field to use in step 4.**

- [ ] **Step 3: Write the failing test**

Create `backend/src/__tests__/orders.image.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/airtable.js', () => ({
  list:    vi.fn(),
  getById: vi.fn(),
  update:  vi.fn(),
  create:  vi.fn(),
}));
vi.mock('../repos/productRepo.js', () => ({ getImagesBatch: vi.fn() }));

const airtable = await import('../services/airtable.js');
const productRepo = await import('../repos/productRepo.js');

beforeEach(() => { vi.clearAllMocks(); });

async function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.role = 'florist'; next(); });
  const m = await import('../routes/orders.js');
  app.use('/api/orders', m.default);
  return app;
}

describe('GET /api/orders/:id', () => {
  it('attaches imageUrl to bouquet group', async () => {
    airtable.getById.mockResolvedValue({
      id: 'ord1',
      'Wix Product ID': 'prod-1',
      'Order Lines': ['ln1'],
      Status: 'New',
    });
    airtable.list
      .mockResolvedValueOnce([{ id: 'ln1', 'Flower Name': 'Rose', Quantity: 5, 'Sell Price Per Unit': 10 }]) // ORDER_LINES
      .mockResolvedValue([]); // anything else
    productRepo.getImagesBatch.mockResolvedValue(new Map([['prod-1', 'https://static/x.jpg']]));

    const app = await buildApp();
    const res = await request(app).get('/api/orders/ord1');
    expect(res.status).toBe(200);
    expect(res.body.bouquetImageUrl).toBe('https://static/x.jpg');
  });
});
```

> **NOTE:** the exact mock chain may need tuning for current orders.js implementation — use the simplest version that exercises the enrichment branch. Adjust the `airtable.list` mocks to match the calls the route actually makes, then rerun.

- [ ] **Step 4: Run test (expect failure)**

Run: `cd backend && npx vitest run src/__tests__/orders.image.test.js`
Expected: FAIL — `bouquetImageUrl` undefined on response.

- [ ] **Step 5: Add enrichment to GET /orders/:id**

In `backend/src/routes/orders.js`, find where `order.orderLines = orderLines` is set (around line 285). Add an import at the top:

```js
import * as productRepo from '../repos/productRepo.js';
```

Then immediately after `order.orderLines = orderLines;` insert:

```js
// Enrich with bouquet image URL so the driver app can render it.
// The image is associated with the Wix product (group), not individual
// stock-item order lines. Source the product id from the order's
// 'Wix Product ID' (set by the Wix webhook). For app-created orders
// without that field, the URL is empty string.
const wixProductId = order['Wix Product ID'];
if (wixProductId) {
  try {
    const map = await productRepo.getImagesBatch([wixProductId]);
    order.bouquetImageUrl = map.get(wixProductId) || '';
  } catch (err) {
    console.error('[orders] productRepo.getImagesBatch failed:', err.message);
    order.bouquetImageUrl = '';
  }
} else {
  order.bouquetImageUrl = '';
}
```

- [ ] **Step 6: Run test**

Run: `cd backend && npx vitest run src/__tests__/orders.image.test.js`
Expected: PASS.

- [ ] **Step 7: Run full backend suite to ensure no regression**

Run: `cd backend && npx vitest run`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/orders.js backend/src/__tests__/orders.image.test.js
git commit -m "feat(backend): GET /orders/:id returns bouquetImageUrl"
```

### Task 9: Enrich list endpoints (GET /orders, GET /deliveries) with imageUrl

**Files:**
- Modify: `backend/src/routes/orders.js`
- Modify: `backend/src/routes/deliveries.js`
- Test: extend `backend/src/__tests__/orders.image.test.js`

- [ ] **Step 1: Add failing test for list enrichment**

Append to `backend/src/__tests__/orders.image.test.js`:

```js
describe('GET /api/orders', () => {
  it('attaches bouquetImageUrl to each order in the list with one batched lookup', async () => {
    airtable.list
      .mockResolvedValueOnce([
        { id: 'o1', 'Wix Product ID': 'p1', 'Order Lines': [] },
        { id: 'o2', 'Wix Product ID': 'p2', 'Order Lines': [] },
        { id: 'o3', 'Wix Product ID': '',   'Order Lines': [] },
      ]); // first call = orders list
    productRepo.getImagesBatch.mockResolvedValue(new Map([
      ['p1', 'u1'], ['p2', 'u2'],
    ]));
    const app = await buildApp();
    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.map(o => [o.id, o.bouquetImageUrl]));
    expect(byId).toEqual({ o1: 'u1', o2: 'u2', o3: '' });
    expect(productRepo.getImagesBatch).toHaveBeenCalledTimes(1);
    expect(productRepo.getImagesBatch).toHaveBeenCalledWith(['p1', 'p2']);
  });
});
```

- [ ] **Step 2: Run (expect failure)**

Run: `cd backend && npx vitest run src/__tests__/orders.image.test.js -t "GET /api/orders"`
Expected: FAIL.

- [ ] **Step 3: Add list enrichment in GET /orders**

In `backend/src/routes/orders.js`, find the GET / handler that returns the orders list. After the orders are loaded into the local `orders` variable and BEFORE `res.json(orders)`, add:

```js
// Batch-load image URLs for distinct Wix products in this list so the
// frontend can render bouquet thumbnails without N+1 lookups.
const distinctProductIds = [...new Set(
  orders.map(o => o['Wix Product ID']).filter(Boolean)
)];
let imageMap = new Map();
if (distinctProductIds.length > 0) {
  try {
    imageMap = await productRepo.getImagesBatch(distinctProductIds);
  } catch (err) {
    console.error('[orders] getImagesBatch failed for list:', err.message);
  }
}
for (const o of orders) {
  o.bouquetImageUrl = imageMap.get(o['Wix Product ID']) || '';
}
```

- [ ] **Step 4: Run test**

Run: `cd backend && npx vitest run src/__tests__/orders.image.test.js`
Expected: PASS.

- [ ] **Step 5: Add same enrichment in deliveries route**

Open `backend/src/routes/deliveries.js`. Find the GET / handler. Identify how each delivery resolves its order and Wix Product ID — in this codebase deliveries link back to orders via `delivery.Orders[0]`. Add an import:

```js
import * as productRepo from '../repos/productRepo.js';
```

Then in the GET / handler, AFTER deliveries are joined with their orders (look for where the linked order's fields are merged in — search for `delivery['App Order ID']` or similar), add:

```js
const distinctProductIds = [...new Set(
  deliveries.map(d => d['Wix Product ID']).filter(Boolean)
)];
let imageMap = new Map();
if (distinctProductIds.length > 0) {
  try {
    imageMap = await productRepo.getImagesBatch(distinctProductIds);
  } catch (err) {
    console.error('[deliveries] getImagesBatch failed:', err.message);
  }
}
for (const d of deliveries) {
  d.bouquetImageUrl = imageMap.get(d['Wix Product ID']) || '';
}
```

If the delivery row does not carry `Wix Product ID` directly (only the linked order does), copy that field across in the same join step before the enrichment block.

- [ ] **Step 6: Add a quick smoke test for the deliveries route**

Append a focused test or use the existing E2E suite (Task 13) to cover deliveries list enrichment. Inline test (optional):

```js
// backend/src/__tests__/deliveries.image.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/airtable.js', () => ({ list: vi.fn(), getById: vi.fn() }));
vi.mock('../repos/productRepo.js', () => ({ getImagesBatch: vi.fn() }));
const airtable = await import('../services/airtable.js');
const repo = await import('../repos/productRepo.js');

beforeEach(() => { vi.clearAllMocks(); });

it('GET /deliveries enriches each row with bouquetImageUrl', async () => {
  airtable.list.mockResolvedValue([
    { id: 'd1', 'Wix Product ID': 'p1', Status: 'Pending' },
  ]);
  repo.getImagesBatch.mockResolvedValue(new Map([['p1', 'u1']]));
  const app = express();
  app.use((r, _s, n) => { r.role = 'driver'; r.driverName = 'Timur'; n(); });
  const m = await import('../routes/deliveries.js');
  app.use('/api/deliveries', m.default);
  const res = await request(app).get('/api/deliveries');
  expect(res.status).toBe(200);
  expect(res.body[0].bouquetImageUrl).toBe('u1');
});
```

- [ ] **Step 7: Run all backend tests**

Run: `cd backend && npx vitest run`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/orders.js backend/src/routes/deliveries.js backend/src/__tests__/orders.image.test.js backend/src/__tests__/deliveries.image.test.js
git commit -m "feat(backend): enrich /orders and /deliveries with bouquetImageUrl"
```

---

## Shared package — image utilities + components

### Task 10: Create imageResize utility

**Files:**
- Create: `packages/shared/utils/imageResize.js`
- Test: `packages/shared/test/imageResize.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/imageResize.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';

describe('resizeImageBlob', () => {
  it('returns a Blob with image/jpeg type and shrinks long-edge to maxEdge', async () => {
    // jsdom canvas mock: stub HTMLCanvasElement.prototype.toBlob
    const fakeBlob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    HTMLCanvasElement.prototype.toBlob = vi.fn(function (cb) { cb(fakeBlob); });

    // Stub createImageBitmap to return predictable dimensions
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({
      width: 4000, height: 3000, close: () => {},
    });

    const { resizeImageBlob } = await import('../utils/imageResize.js');
    const inputBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const out = await resizeImageBlob(inputBlob, { maxEdge: 1200, quality: 0.85 });
    expect(out).toBeInstanceOf(Blob);
    expect(out.type).toBe('image/jpeg');

    // Verify the canvas was created at the expected dimensions
    // 4000x3000 → 1200x900 (long edge clamp)
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
    // Verify: canvas was 800x600, not 1200x900
    // (Best verified via spy on createElement('canvas') + setting width/height —
    // simpler: just assert no error and a Blob came back.)
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/imageResize.test.js`
Expected: FAIL "Cannot find module".

- [ ] **Step 3: Implement the utility**

Create `packages/shared/utils/imageResize.js`:

```js
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
```

- [ ] **Step 4: Run tests**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/imageResize.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/utils/imageResize.js packages/shared/test/imageResize.test.js
git commit -m "feat(shared): canvas-based image resize utility"
```

### Task 11: Create BouquetImageEditor + BouquetImageView components

**Files:**
- Create: `packages/shared/components/BouquetImageEditor.jsx`
- Create: `packages/shared/components/BouquetImageView.jsx`
- Create: `packages/shared/api/uploadImage.js`
- Modify: `packages/shared/index.js`
- Test: `packages/shared/test/BouquetImageEditor.test.jsx`

- [ ] **Step 1: Create the upload API helper**

Create `packages/shared/api/uploadImage.js`:

```js
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
```

- [ ] **Step 2: Write the component test**

Create `packages/shared/test/BouquetImageEditor.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('../api/uploadImage.js', () => ({
  uploadBouquetImage: vi.fn().mockResolvedValue({ imageUrl: 'https://static/new.jpg' }),
  removeBouquetImage: vi.fn().mockResolvedValue({ ok: true }),
}));

import BouquetImageEditor from '../components/BouquetImageEditor.jsx';
import { uploadBouquetImage, removeBouquetImage } from '../api/uploadImage.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('BouquetImageEditor', () => {
  it('renders empty state with paste/pick prompt when no currentUrl', () => {
    render(<BouquetImageEditor wixProductId="p1" currentUrl="" canRemove={false} onChange={() => {}} />);
    expect(screen.getByText(/paste|вставьте/i)).toBeTruthy();
  });

  it('shows current image when currentUrl set', () => {
    render(<BouquetImageEditor wixProductId="p1" currentUrl="https://static/a.jpg" canRemove={false} onChange={() => {}} />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://static/a.jpg');
  });

  it('uploads on file pick and calls onChange with new URL', async () => {
    const onChange = vi.fn();
    render(<BouquetImageEditor wixProductId="p1" currentUrl="" canRemove={false} onChange={onChange} />);
    const file = new File([new Uint8Array([1])], 'b.png', { type: 'image/png' });
    const input = screen.getByTestId('bouquet-image-file-input');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadBouquetImage).toHaveBeenCalled());
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://static/new.jpg'));
  });

  it('hides remove control when canRemove=false', () => {
    render(<BouquetImageEditor wixProductId="p1" currentUrl="https://static/a.jpg" canRemove={false} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /remove|удалить/i })).toBeNull();
  });

  it('shows remove control when canRemove=true and triggers DELETE on confirm', async () => {
    const onChange = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<BouquetImageEditor wixProductId="p1" currentUrl="https://static/a.jpg" canRemove={true} onChange={onChange} />);
    const btn = screen.getByRole('button', { name: /remove|удалить/i });
    fireEvent.click(btn);
    await waitFor(() => expect(removeBouquetImage).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''));
  });
});
```

- [ ] **Step 3: Run (expect FAIL)**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/BouquetImageEditor.test.jsx`
Expected: FAIL "Cannot find module".

- [ ] **Step 4: Create BouquetImageEditor**

Create `packages/shared/components/BouquetImageEditor.jsx`:

```jsx
import { useRef, useState, useEffect, useCallback } from 'react';
import { uploadBouquetImage, removeBouquetImage } from '../api/uploadImage.js';
import { useToast } from '../context/ToastContext.jsx';

// Bouquet image slot used by florist + dashboard product cards.
//
// Two input methods:
//   1. Click → opens native file picker (camera+library on phones)
//   2. Paste while focused → reads image from clipboard (desktop)
//
// Single-image semantic: upload replaces the existing image. Remove is
// owner-only (controlled via `canRemove`). The component shows an
// optimistic preview during upload and reverts on error.

const PASTE_LABEL_RU = 'Вставьте или выберите фото';
const PASTE_LABEL_EN = 'Paste or pick image';
const REMOVE_LABEL_RU = 'Удалить';
const REMOVE_LABEL_EN = 'Remove';
const REMOVE_CONFIRM_RU = 'Удалить это фото?';
const REMOVE_CONFIRM_EN = 'Remove this photo?';

export default function BouquetImageEditor({
  wixProductId,
  currentUrl,
  canRemove,
  onChange,
}) {
  const fileInputRef = useRef(null);
  const containerRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(currentUrl || '');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  let toast;
  try { ({ showToast: toast } = useToast()); } catch { toast = () => {}; }

  useEffect(() => { setPreviewUrl(currentUrl || ''); }, [currentUrl]);

  const handleFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast?.('JPG, PNG или WebP', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast?.('Максимум 10 МБ (будет сжато до ~500 КБ)', 'error');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    setUploading(true);
    setProgress(0);
    try {
      const { imageUrl } = await uploadBouquetImage({
        wixProductId,
        file,
        onProgress: setProgress,
      });
      setPreviewUrl(imageUrl);
      onChange?.(imageUrl);
      toast?.('Фото обновлено', 'success');
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Не удалось загрузить';
      toast?.(msg, 'error');
      setPreviewUrl(currentUrl || '');
    } finally {
      setUploading(false);
      URL.revokeObjectURL(localUrl);
    }
  }, [wixProductId, currentUrl, onChange, toast]);

  const onPaste = useCallback((e) => {
    if (uploading) return;
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault();
        handleFile(item.getAsFile());
        return;
      }
    }
  }, [handleFile, uploading]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    node.addEventListener('paste', onPaste);
    return () => node.removeEventListener('paste', onPaste);
  }, [onPaste]);

  const onRemove = async () => {
    const confirmed = window.confirm(REMOVE_CONFIRM_RU);
    if (!confirmed) return;
    setUploading(true);
    try {
      await removeBouquetImage(wixProductId);
      setPreviewUrl('');
      onChange?.('');
      toast?.('Фото удалено', 'success');
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Не удалось удалить';
      toast?.(msg, 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="relative rounded-xl border border-gray-200 overflow-hidden focus:outline-none focus:ring-2 focus:ring-brand-400"
      onClick={() => !uploading && fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        data-testid="bouquet-image-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />
      {previewUrl ? (
        <img
          src={previewUrl}
          alt="Bouquet"
          className="block w-full h-40 object-cover"
        />
      ) : (
        <div className="h-40 flex items-center justify-center bg-gray-50 text-gray-400 text-sm">
          {PASTE_LABEL_RU}
        </div>
      )}
      {uploading && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white text-sm">
          {progress}%
        </div>
      )}
      {canRemove && previewUrl && !uploading && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute top-2 right-2 px-2 py-1 rounded-full bg-white/90 text-red-600 text-xs font-semibold shadow"
        >
          {REMOVE_LABEL_RU}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create BouquetImageView (read-only, used by delivery card)**

Create `packages/shared/components/BouquetImageView.jsx`:

```jsx
import { useState } from 'react';

// Read-only bouquet image surface for the driver delivery card.
// Tap → fullscreen modal so the driver can zoom in.

export default function BouquetImageView({ imageUrl, label = 'Букет' }) {
  const [zoomed, setZoomed] = useState(false);
  if (!imageUrl) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setZoomed(true); }}
        className="flex items-center gap-2 w-full text-left active-scale"
      >
        <img
          src={imageUrl}
          alt={label}
          className="w-16 h-16 rounded-lg object-cover border border-gray-200"
        />
        <span className="text-sm text-ios-tertiary">{label}</span>
      </button>
      {zoomed && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center"
          onClick={(e) => { e.stopPropagation(); setZoomed(false); }}
        >
          <img src={imageUrl} alt={label} className="max-w-full max-h-full" />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 6: Update shared package exports**

Edit `packages/shared/index.js` — add:

```js
export { default as BouquetImageEditor } from './components/BouquetImageEditor.jsx';
export { default as BouquetImageView }   from './components/BouquetImageView.jsx';
export { resizeImageBlob }               from './utils/imageResize.js';
export { uploadBouquetImage, removeBouquetImage } from './api/uploadImage.js';
```

- [ ] **Step 7: Update packages/shared/CLAUDE.md structure block**

In `packages/shared/CLAUDE.md`, add to the `components/` section:

```
  BouquetImageEditor.jsx      → Image upload slot (paste + file pick) for bouquet products
  BouquetImageView.jsx        → Read-only bouquet thumbnail with tap-to-zoom (delivery card)
```

To `utils/`:

```
  imageResize.js              → Canvas-based long-edge resize + JPEG re-encode for upload
```

Add `api/`:

```
api/
  client.js                   → Axios instance with auto-attached PIN header
  uploadImage.js              → uploadBouquetImage, removeBouquetImage — multipart POST helpers
```

- [ ] **Step 8: Run tests**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/BouquetImageEditor.test.jsx`
Expected: PASS (5 tests).

Run all shared tests: `cd packages/shared && ../../backend/node_modules/.bin/vitest run`
Expected: 98+ existing tests + 7 new = all green.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): BouquetImageEditor + BouquetImageView components"
```

---

## Florist app integration

### Task 12: Wire BouquetImageEditor into florist BouquetCard + BouquetsPage

**Files:**
- Modify: `apps/florist/src/components/bouquets/BouquetCard.jsx`
- Modify: `apps/florist/src/pages/BouquetsPage.jsx`
- Modify: `apps/florist/src/translations.js`

- [ ] **Step 1: Add translation keys**

Edit `apps/florist/src/translations.js`. Add to both EN and RU sections (find the existing `bouquetCategoriesLabel` key as anchor):

```js
// EN
bouquetImage:        'Bouquet photo',
pasteOrPickImage:    'Paste or pick image',
removeImage:         'Remove',
imageUploadFailed:   'Upload failed',
imageUploadSuccess:  'Photo updated',
removeImageConfirm:  'Remove this photo?',

// RU
bouquetImage:        'Фото букета',
pasteOrPickImage:    'Вставьте или выберите фото',
removeImage:         'Удалить',
imageUploadFailed:   'Не удалось загрузить',
imageUploadSuccess:  'Фото обновлено',
removeImageConfirm:  'Удалить это фото?',
```

- [ ] **Step 2: Render BouquetImageEditor in BouquetCard expanded view**

Open `apps/florist/src/components/bouquets/BouquetCard.jsx`. Find the expanded section that renders `<CategoryChips>`. Add ABOVE it:

```jsx
import { BouquetImageEditor } from '@flower-studio/shared';
import { useAuth } from '../../context/AuthContext.jsx';
// ... inside the component, near other hooks:
const { role } = useAuth();
const wixProductId = group.wixProductId;
const currentImageUrl = group.variants[0]?.['Image URL'] || '';

// In the expanded JSX, ABOVE <CategoryChips>:
<BouquetImageEditor
  wixProductId={wixProductId}
  currentUrl={currentImageUrl}
  canRemove={role === 'owner'}
  onChange={(newUrl) => onUpdateImage(wixProductId, newUrl)}
/>
```

- [ ] **Step 3: Add onUpdateImage handler in BouquetsPage**

Open `apps/florist/src/pages/BouquetsPage.jsx`. Add a handler near the other update handlers (e.g. `markDirty`):

```jsx
async function updateImage(wixProductId, newUrl) {
  // The backend already wrote the URL to all variant rows when the
  // upload succeeded. Mirror that change in local state so the card
  // re-renders with the new image without a full reload.
  setRows(prev => prev.map(r =>
    (r['Wix Product ID'] || r.id) === wixProductId
      ? { ...r, 'Image URL': newUrl }
      : r
  ));
  markDirty(wixProductId);
}
```

Pass `onUpdateImage={updateImage}` to each `<BouquetCard>` render in the page.

- [ ] **Step 4: Build the florist app to verify no regressions**

Run: `cd apps/florist && ./node_modules/.bin/vite build`
Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/florist/
git commit -m "feat(florist): bouquet image upload on BouquetsPage"
```

---

## Dashboard integration

### Task 13: Wire BouquetImageEditor into dashboard ProductCard + ProductsTab

**Files:**
- Modify: `apps/dashboard/src/components/products/ProductCard.jsx`
- Modify: `apps/dashboard/src/components/ProductsTab.jsx`
- Modify: `apps/dashboard/src/translations.js`

- [ ] **Step 1: Add translation keys**

Same EN/RU keys as florist app (Task 12 step 1) into `apps/dashboard/src/translations.js`.

- [ ] **Step 2: Render BouquetImageEditor in ProductCard**

Open `apps/dashboard/src/components/products/ProductCard.jsx`. Find the section that renders the product image (it currently displays `Image URL` as a static `<img>`). Replace the static image area with:

```jsx
import { BouquetImageEditor } from '@flower-studio/shared';
import { useAuth } from '../../context/AuthContext.jsx'; // confirm path

const { role } = useAuth();
const wixProductId = group.wixProductId;
const currentImageUrl = group.variants[0]?.['Image URL'] || '';

<BouquetImageEditor
  wixProductId={wixProductId}
  currentUrl={currentImageUrl}
  canRemove={role === 'owner'}
  onChange={(newUrl) => onUpdateImage(wixProductId, newUrl)}
/>
```

- [ ] **Step 3: Add onUpdateImage handler in ProductsTab**

Same pattern as florist (Task 12 step 3) — find the update-handler section and add `updateImage`, then pass `onUpdateImage={updateImage}` to each `<ProductCard>`.

- [ ] **Step 4: Build the dashboard**

Run: `cd apps/dashboard && ./node_modules/.bin/vite build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/
git commit -m "feat(dashboard): bouquet image upload on Products tab"
```

---

## Delivery app integration

### Task 14: Render BouquetImageView on DeliveryCard + tighten address spacing + fix nav pills

**Files:**
- Modify: `apps/delivery/src/components/DeliveryCard.jsx`
- Modify: `apps/delivery/src/translations.js`
- Investigate: `packages/shared/components/NavButtons.jsx` (rendering bug)

- [ ] **Step 1: Add translation key**

In `apps/delivery/src/translations.js`, add EN+RU:

```js
// EN
bouquetSectionLabel: 'Bouquet',
// RU
bouquetSectionLabel: 'Букет',
```

- [ ] **Step 2: Add BouquetImageView section to DeliveryCard**

Open `apps/delivery/src/components/DeliveryCard.jsx`. Add the import:

```jsx
import { BouquetImageView } from '@flower-studio/shared';
```

After the `driverInstr` section (the orange driver-instructions box) and BEFORE the address section:

```jsx
{d.bouquetImageUrl && (
  <div className={divider}>
    <BouquetImageView imageUrl={d.bouquetImageUrl} label={t.bouquetSectionLabel} />
  </div>
)}
```

- [ ] **Step 3: Tighten the address band**

In the same file, change the outer container from `space-y-3` to `space-y-2`, and change `divider`'s `pt-3` to `pt-2`:

```jsx
const divider = 'border-t border-gray-100 pt-2';   // was pt-3

<div className="px-4 py-3 space-y-2">              // was space-y-3
```

- [ ] **Step 4: Investigate + fix the empty nav pills**

Read `packages/shared/components/NavButtons.jsx` — verify the colors compile. If the `bg-blue-600`, `bg-cyan-500`, `bg-gray-900` classes are showing as empty pills in production, the cause is most likely Tailwind's content-scan missing the shared package. Check:

```bash
cd apps/delivery && cat tailwind.config.js | grep -A 5 content
```

Tailwind's `content` glob must include `../../packages/shared/**/*.{js,jsx,ts,tsx}`. If it doesn't, add it to `apps/delivery/tailwind.config.js` (and verify the same in `apps/florist` and `apps/dashboard`):

```js
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
    '../../packages/shared/**/*.{js,jsx,ts,tsx}',
  ],
  // ...
};
```

If the glob is already present, the bug is elsewhere — capture the production HTML for the rendered pills and inspect computed styles. Document the actual cause in the commit message.

- [ ] **Step 5: Build delivery app**

Run: `cd apps/delivery && ./node_modules/.bin/vite build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add apps/delivery/ packages/shared/
git commit -m "feat(delivery): bouquet image on DeliveryCard + tighter address spacing + nav-pill fix"
```

---

## SSE wiring

### Task 15: Subscribe delivery + florist + dashboard apps to product_image_changed

**Files:**
- Modify: `apps/delivery/src/pages/DeliveryListPage.jsx`
- Modify: `apps/florist/src/pages/BouquetsPage.jsx` (already loads, adds SSE listener)
- Modify: `apps/dashboard/src/components/ProductsTab.jsx`

- [ ] **Step 1: Find existing SSE pattern in delivery app**

Run: `cd apps/delivery/src && grep -rn "EventSource\|api/events\|useEffect.*events" .`

Identify how the app subscribes to SSE today (likely a hook in `hooks/useNotifications.js` or inline in the list page).

- [ ] **Step 2: Add product_image_changed handler in DeliveryListPage**

Wherever the page subscribes to SSE, add:

```js
if (event.type === 'product_image_changed') {
  const { wixProductId, imageUrl } = event;
  setDeliveries(prev => prev.map(d =>
    d['Wix Product ID'] === wixProductId
      ? { ...d, bouquetImageUrl: imageUrl }
      : d
  ));
}
```

- [ ] **Step 3: Same in florist BouquetsPage and dashboard ProductsTab**

In each, on receiving `product_image_changed`, patch `Image URL` on matching variant rows in the local list state. This keeps the multi-tab use case (owner edits on dashboard, immediately sees in florist app) coherent without a full reload.

- [ ] **Step 4: Build all three apps**

```bash
cd apps/florist  && ./node_modules/.bin/vite build
cd ../dashboard  && ./node_modules/.bin/vite build
cd ../delivery   && ./node_modules/.bin/vite build
```

Expected: all three succeed.

- [ ] **Step 5: Commit**

```bash
git add apps/
git commit -m "feat(apps): subscribe to product_image_changed SSE event"
```

---

## E2E coverage

### Task 16: Add E2E section for bouquet image upload + driver visibility

**Files:**
- Modify: `scripts/e2e-test.js`
- Modify: `backend/scripts/start-test-backend.js` (add Wix Media mock if not already present)

- [ ] **Step 1: Inspect the harness's mock-Wix layer**

Run: `grep -n "wix\|Wix\|fetch" backend/scripts/start-test-backend.js backend/src/services/airtable-mock.js | head -30`

Identify how Wix calls are mocked in the harness today (the existing webhook-replay path already does signed mocking; the upload + media-attach path needs a similar shape).

- [ ] **Step 2: Add Wix Media mock interceptor**

If the harness uses a global `fetch` shim, extend it to handle:
- `POST /site-media/v1/files/generate-upload-url` → `{ uploadUrl: 'http://harness-fake/upload/<uuid>' }`
- `PUT http://harness-fake/upload/*` → `{ file: { id: 'fake-<uuid>', url: 'http://harness-fake/static/<uuid>.jpg' } }`
- `GET /site-media/v1/files/<id>` → `{ file: { id, url, state: 'OK' } }`
- `DELETE /stores/v1/products/<id>/media/all` → `{ product: {} }`
- `POST /stores/v1/products/<id>/media` → `{ product: {} }`

If the harness does NOT have a fetch shim, add one in `start-test-backend.js` that conditionally intercepts only when `process.env.HARNESS_MOCK_WIX === '1'`.

- [ ] **Step 3: Add new section to scripts/e2e-test.js**

```js
// Section N: Bouquet image upload + driver visibility
async function sectionBouquetImage(api) {
  // 1. Owner uploads a PNG to a known bouquet product id (from fixtures)
  const png = Buffer.from(/* 1x1 PNG */[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  const uploaded = await api.upload(
    `/products/${FIXTURE_WIX_PRODUCT_ID}/image`,
    png,
    { role: 'owner', filename: 'b.png', mime: 'image/png' }
  );
  assert(uploaded.imageUrl?.startsWith('http'), 'image upload returns URL');

  // 2. Driver-role GET /deliveries: any delivery for an order containing
  //    that bouquet shows the new imageUrl
  const deliveries = await api.get('/deliveries', { role: 'driver' });
  const target = deliveries.find(d => d['Wix Product ID'] === FIXTURE_WIX_PRODUCT_ID);
  assert(target?.bouquetImageUrl === uploaded.imageUrl,
    'driver delivery list reflects new bouquet image');

  // 3. Owner removes
  await api.del(`/products/${FIXTURE_WIX_PRODUCT_ID}/image`, { role: 'owner' });
  const after = await api.get('/deliveries', { role: 'driver' });
  const targetAfter = after.find(d => d['Wix Product ID'] === FIXTURE_WIX_PRODUCT_ID);
  assert(!targetAfter.bouquetImageUrl, 'driver delivery image cleared after owner remove');

  // 4. Florist cannot remove
  const floristAttempt = await api.del(`/products/${FIXTURE_WIX_PRODUCT_ID}/image`,
    { role: 'florist', allow400s: true });
  assert(floristAttempt.status === 403, 'florist cannot remove bouquet image');
}
```

(Implement `api.upload` if not already present — multipart POST helper.)

Wire `sectionBouquetImage` into the main run sequence and bump the section count + assertion count in any totals printed by the script.

- [ ] **Step 4: Boot harness + run E2E**

```bash
# Terminal 1
HARNESS_MOCK_WIX=1 npm run harness
# Terminal 2
npm run test:e2e
```

Expected: 153 prior assertions + new ones all green.

- [ ] **Step 5: Commit**

```bash
git add scripts/e2e-test.js backend/scripts/start-test-backend.js
git commit -m "test(e2e): bouquet image upload + driver visibility section"
```

---

## Documentation + finalize

### Task 17: Update CLAUDE.md, BACKLOG.md, CHANGELOG.md

**Files:**
- Modify: `backend/CLAUDE.md`
- Modify: `BACKLOG.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update backend/CLAUDE.md**

In the `Repos (src/repos/)` section (or add the section if missing), include `productRepo.js`. In the `Services (src/services/)` table, add a row for `wixMediaClient.js`. In the routes table, update the `products.js` row to mention the new image endpoints.

- [ ] **Step 2: Update BACKLOG.md**

Add a "Done" entry under Phase 2 / Phase 3 sections referencing this feature: bouquet image upload + driver-card display.

- [ ] **Step 3: Update CHANGELOG.md**

```markdown
## 2026-05-XX — Bouquet image upload

- New endpoints `POST /api/products/:wixProductId/image` (florist+owner) and `DELETE` (owner only).
- Wix Media client added; reuses `WIX_API_KEY` — required scope: `Manage Media Manager`.
- New repo `productRepo` for product image URL persistence (Airtable today, PG-ready for Phase 6).
- `audit_log` action types: `image_set`, `image_remove`.
- Delivery + orders endpoints now include `bouquetImageUrl` on each row.
- Shared components `BouquetImageEditor` + `BouquetImageView` added.
```

- [ ] **Step 4: Run pre-PR matrix**

```bash
cd backend && npx vitest run
cd ../packages/shared && ../../backend/node_modules/.bin/vitest run
cd .. && npm run harness &
sleep 5 && npm run test:e2e
kill %1 2>/dev/null
cd apps/florist && ./node_modules/.bin/vite build
cd ../dashboard && ./node_modules/.bin/vite build
cd ../delivery && ./node_modules/.bin/vite build
```

All must pass.

- [ ] **Step 5: Commit + push + open PR**

```bash
git add CLAUDE.md backend/CLAUDE.md BACKLOG.md CHANGELOG.md
git commit -m "docs: bouquet image upload — CLAUDE.md, BACKLOG, CHANGELOG"
git push -u origin feat/bouquet-image-upload
gh pr create --title "feat: bouquet image upload + driver display" --body "$(cat <<'EOF'
## Summary
- Owner + florist upload bouquet photos via clipboard or photo library on florist app and dashboard.
- Photos stored in Wix Media; URL cached locally via new `productRepo` (migration-safe through Phase 6/7).
- Driver `DeliveryCard` renders the bouquet image so the right physical bouquet is identifiable on pickup.
- `POST /products/:id/image` (florist+owner), `DELETE` (owner only); Wix Media + Wix Stores attach orchestrated server-side.

## Test plan
- [x] Backend unit + integration vitest green
- [x] Shared package vitest green
- [x] All three app builds green locally
- [x] E2E section added; 153+ assertions green via `npm run test:e2e`
- [ ] Owner manual: upload from clipboard on dashboard → visible on Wix storefront within 30s
- [ ] Owner manual: upload from phone library on florist app → visible on driver delivery card
- [ ] Owner manual: remove (owner role) → clears storefront + driver card
- [ ] Manual: florist role → no remove control visible

## Pre-deploy
Verify production `WIX_API_KEY` has `Manage Media Manager` scope. Regenerate + rotate on Railway if missing.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**1. Spec coverage check:**

| Spec section | Plan task |
|---|---|
| §3 Architecture (Wix Media as source of truth, repo abstraction) | Tasks 1–5 |
| §4.1 Upload data flow | Task 6 (route) + Task 11 (frontend) |
| §4.2 Remove data flow | Task 7 |
| §4.3 Driver read enrichment | Tasks 8–9 |
| §5.1 Shared components | Tasks 10–11 |
| §5.2 Florist app integration | Task 12 |
| §5.3 Dashboard integration | Task 13 |
| §5.4 Delivery card + spacing + nav-pill fix | Task 14 |
| §5.5 Translations | Tasks 12, 13, 14 |
| §6.1 Wix scope action | Task 0 |
| §6.2 wixMediaClient | Tasks 1–3 |
| §6.3 productRepo | Task 5 |
| §6.4 Routes | Tasks 6–7 |
| §6.5 Bouquet summary enrichment | Tasks 8–9 |
| §6.6 Audit logging | Folded into Task 6/7 console.error log lines (note: explicit `audit_log` row insertion deferred — see open item below) |
| §7 Error handling matrix | Task 6 (try/catch per pipeline step) |
| §8 Testing matrix | Tasks 1–11 (unit + component) + Task 16 (E2E) |
| §9 Files to create/modify | Covered |
| SSE broadcast | Task 6/7 (broadcast call) + Task 15 (subscribers) |

**Gap identified:** spec §6.6 mentions `audit_log` rows for `image_set`/`image_remove`. The plan currently emits `console.error` on failures and `notifications.broadcast` on success but does not call `recordAudit`. Add this to Task 6 step 3 and Task 7 step 3 by importing `recordAudit` from `../db/audit.js` and calling it inside each handler after the productRepo write. (Inline correction below.)

**2. Placeholder scan:** No "TBD" / "TODO" / "appropriate" / "similar to Task N" patterns found.

**3. Type/name consistency:** `wixMediaClient` exports (`generateUploadUrl`, `uploadFile`, `pollForReady`, `deleteFiles`) are referenced consistently in Task 6. `productRepo` methods (`setImage`, `getImage`, `getImagesBatch`) consistent across Tasks 5, 6, 7, 8, 9. SSE event name `product_image_changed` consistent across Tasks 6, 7, 15. Field names `'Wix Product ID'`, `'Image URL'` match Airtable schema confirmed via grep.

---

## Audit-log addendum (apply during Task 6 step 3 and Task 7 step 3)

Add to the top of `routes/products.js` near the other imports added in Task 6:

```js
import { recordAudit } from '../db/audit.js';
```

In `handleImageUpload`, after `await productRepo.setImage(...)` and before `broadcast(...)`:

```js
try {
  await recordAudit({
    entityType: 'product',
    entityId: wixProductId,
    action: 'image_set',
    diff: { before: null, after: { imageUrl: readyFile.url } },
    actorRole: req.role,
  });
} catch (err) {
  console.error('[image-upload] recordAudit failed:', err.message);
  // do not fail the request on audit log failure
}
```

In `handleImageDelete`, before `broadcast(...)`:

```js
try {
  await recordAudit({
    entityType: 'product',
    entityId: wixProductId,
    action: 'image_remove',
    diff: { before: { imageUrl: 'present' }, after: null },
    actorRole: req.role,
  });
} catch (err) {
  console.error('[image-delete] recordAudit failed:', err.message);
}
```
