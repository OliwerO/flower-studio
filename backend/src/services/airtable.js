// Airtable service shim — picks the real client or the in-memory mock at
// module load time, then re-exports a stable API surface so callers
// (`stockRepo`, `orderService`, every route) don't know which is in play.
//
// The real implementation lives byte-for-byte at ./airtable-real.js. This
// file only exists to gate which one gets loaded. Production sets no
// TEST_BACKEND env var, so the real client loads as before.
//
// Why dynamic import: when `TEST_BACKEND=mock-airtable`, the real module
// (and its `config/airtable.js` which constructs `new Airtable(...)` at
// load) must never execute — fewer surprises with undefined env vars,
// no SDK initialised against a fake key. Static imports would load both
// modules regardless of the toggle. ESM top-level await makes this clean.
//
// Footgun guard: TEST_BACKEND is fatal in production. Two layers of
// defence catch a stray env var in Railway:
//   1. NODE_ENV === 'production' + TEST_BACKEND set → process.exit(1)
//   2. Boot banner (logged below) makes the mode visible in any deploy log.

const TEST_BACKEND = process.env.TEST_BACKEND;
const useMock = TEST_BACKEND === 'mock-airtable';

if (TEST_BACKEND && process.env.NODE_ENV === 'production') {
  console.error(
    `[FATAL] TEST_BACKEND=${TEST_BACKEND} is set in NODE_ENV=production. ` +
    `Refusing to boot — this is a guard against accidentally pointing prod at the in-memory mock. ` +
    `Unset TEST_BACKEND or change NODE_ENV.`
  );
  process.exit(1);
}

if (TEST_BACKEND && !useMock) {
  console.error(`[FATAL] Unknown TEST_BACKEND value: ${TEST_BACKEND}. Expected 'mock-airtable' or unset.`);
  process.exit(1);
}

if (useMock) {
  console.log('\x1b[31m[MOCK AIRTABLE] Using in-memory fixture — NOT touching production Airtable.\x1b[0m');
}

const impl = useMock
  ? await import('./airtable-mock.js')
  : await import('./airtable-real.js');

// Re-export the same surface area as airtable-real.js so callers don't change.
export const list              = impl.list;
export const getById           = impl.getById;
export const create            = impl.create;
export const update            = impl.update;
export const deleteRecord      = impl.deleteRecord;
export const atomicStockAdjust = impl.atomicStockAdjust;
