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
  },
});
