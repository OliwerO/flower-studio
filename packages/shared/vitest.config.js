import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// @vitejs/plugin-react is not a direct dep of packages/shared but is available
// via the apps' node_modules — resolve it explicitly so JSX tests work.
const reactPluginPath = new URL(
  '../../apps/florist/node_modules/@vitejs/plugin-react/dist/index.js',
  import.meta.url
).pathname;
const { default: react } = await import(reactPluginPath);

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    setupFiles: ['./test/setup.js'],
    environment: 'jsdom',
  },
});
