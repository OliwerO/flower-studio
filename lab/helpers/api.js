// lab/helpers/api.js
//
// Fetch wrapper for lab API tests + lab backend lifecycle helpers.
// Tests treat the lab backend like a black box — same wire format as prod.

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const BASE = process.env.LAB_API_URL ?? 'http://localhost:3003';

export function api(role = 'owner') {
  const PINS = { owner: '1111', florist: '2222', driver_timur: '3333', driver_nikita: '4444' };
  const pin = PINS[role];

  async function request(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-PIN': pin,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }

  return {
    get:    (p)    => request('GET',    p),
    post:   (p, b) => request('POST',   p, b),
    patch:  (p, b) => request('PATCH',  p, b),
    delete: (p)    => request('DELETE', p),
  };
}

let serverHandle = null;

export async function startLabBackend() {
  if (serverHandle) return;
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const script = resolve(__dirname, '../scripts/start-lab-backend.js');
  serverHandle = spawn('node', [script], { stdio: ['ignore', 'pipe', 'pipe'] });

  // Wait for /api/health to respond.
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok) return;
    } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Lab backend did not start within 30s');
}

export async function stopLabBackend() {
  if (!serverHandle) return;
  serverHandle.kill('SIGTERM');
  await new Promise(r => serverHandle.once('exit', r));
  serverHandle = null;
}
