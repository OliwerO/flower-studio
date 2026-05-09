// lab/scripts/start-lab-dev.js
//
// One-command boot of the lab dev environment:
//   - lab backend on :3003
//   - florist app  on :5176 (proxied to lab backend)
//   - dashboard    on :5177
//   - delivery app on :5178
//
// Pre-req: `npm run lab:db:up && npm run lab:reset` (template must already exist).

import concurrently from 'concurrently';

const proxy = 'http://localhost:3003';
const ownerPin = '1111';

const { result } = concurrently([
  {
    name: 'backend',
    command: 'node lab/scripts/start-lab-backend.js',
    prefixColor: 'magenta',
  },
  {
    name: 'florist',
    command: `cd apps/florist && VITE_API_PROXY_TARGET=${proxy} VITE_OWNER_PIN=${ownerPin} node_modules/.bin/vite --port 5176 --strictPort`,
    prefixColor: 'cyan',
  },
  {
    name: 'dashboard',
    command: `cd apps/dashboard && VITE_API_PROXY_TARGET=${proxy} VITE_OWNER_PIN=${ownerPin} node_modules/.bin/vite --port 5177 --strictPort`,
    prefixColor: 'green',
  },
  {
    name: 'delivery',
    command: `cd apps/delivery && VITE_API_PROXY_TARGET=${proxy} VITE_OWNER_PIN=${ownerPin} node_modules/.bin/vite --port 5178 --strictPort`,
    prefixColor: 'yellow',
  },
], {
  killOthers: ['failure', 'success'],
  prefix: 'name',
});

result.catch(() => process.exit(1));
