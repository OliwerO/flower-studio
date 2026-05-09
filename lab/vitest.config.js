import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'factories/**/*.test.js',
      'scenarios/**/*.test.js',
      'helpers/**/*.test.js',
      'tests/api/**/*.test.js',
    ],
    environment: 'node',
    testTimeout: 10_000,
  },
});
