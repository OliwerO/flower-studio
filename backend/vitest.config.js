import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Set dummy env vars so Airtable client doesn't throw on import
    env: {
      AIRTABLE_API_KEY: 'test_key',
      AIRTABLE_BASE_ID: 'test_base',
      PIN_OWNER: '0000',
      PIN_FLORIST: '1111',
    },

    // The pglite harness boots a WASM Postgres (~600ms unloaded). Test files
    // run in parallel and each boots on its first test, so on a busy machine
    // — a 4-vCPU CI runner, or a laptop running the whole suite — those boots
    // queue behind each other, and a boot that normally takes under a second
    // can take many. Vitest's 10s default then fails the hook, which reads as
    // a broken test rather than a loaded machine (this is the flake class
    // behind the "just run it with --no-file-parallelism" folklore).
    // 30s is far above anything observed and still catches a genuine hang.
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
