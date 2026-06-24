// Route-level tests for /api/issues — the dashboard's GitHub issue tracker.
//
// The router talks to the GitHub REST API via global `fetch`. We mount the
// REAL router (real route wiring + validation) and mock only the auth
// boundary and `fetch`. Asserts the two behaviours that are easy to get
// wrong:
//   • GET /issues strips pull requests (GitHub's /issues endpoint returns
//     PRs too — every PR is also an issue).
//   • POST /labels/ensure-priorities only creates the priority labels that
//     are missing (idempotent seeding).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../middleware/auth.js', () => ({
  authorize: () => (req, _res, next) => { req.role = 'owner'; next(); },
}));

function ghOk(data) {
  return { ok: true, status: 200, json: async () => data };
}

async function buildApp() {
  const app = express();
  app.use(express.json());
  const routes = (await import('../routes/issues.js')).default;
  app.use('/api/issues', routes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('GITHUB_TOKEN', 'test-token');
});

describe('GET /api/issues', () => {
  it('filters out pull requests, returning only real issues', async () => {
    const payload = [
      { number: 1, title: 'Real issue', state: 'open', labels: [] },
      { number: 2, title: 'A PR', state: 'open', labels: [], pull_request: { url: 'x' } },
      { number: 3, title: 'Another issue', state: 'open', labels: [] },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ghOk(payload)));
    const app = await buildApp();

    const res = await request(app).get('/api/issues');

    expect(res.status).toBe(200);
    expect(res.body.map(i => i.number)).toEqual([1, 3]);
    // forwarded the default open-state query to GitHub
    expect(fetch.mock.calls[0][0]).toContain('/issues?');
    expect(fetch.mock.calls[0][0]).toContain('state=open');
  });

  it('passes a label filter through to GitHub', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ghOk([])));
    const app = await buildApp();

    await request(app).get('/api/issues?state=all&labels=priority%3Ahigh');

    expect(fetch.mock.calls[0][0]).toContain('state=all');
    expect(fetch.mock.calls[0][0]).toContain('labels=priority');
  });
});

describe('POST /api/issues/labels/ensure-priorities', () => {
  it('creates only the missing priority labels', async () => {
    const fetchMock = vi.fn((url, opts = {}) => {
      if (url.endsWith('/labels?per_page=100') && (!opts.method || opts.method === 'GET')) {
        return Promise.resolve(ghOk([{ name: 'priority:high', color: 'd73a4a' }]));
      }
      // POST /labels create
      return Promise.resolve(ghOk({ name: 'created' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp();

    const res = await request(app).post('/api/issues/labels/ensure-priorities');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const created = fetchMock.mock.calls
      .filter(([, opts]) => opts?.method === 'POST')
      .map(([, opts]) => JSON.parse(opts.body).name);
    expect(created.sort()).toEqual(['priority:low', 'priority:medium']);
    expect(created).not.toContain('priority:high');
  });
});

describe('POST /api/issues', () => {
  it('rejects a blank title with 400 before calling GitHub', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp();

    const res = await request(app).post('/api/issues').send({ title: '   ' });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates an issue and returns 201', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ghOk({ number: 99, title: 'New' })));
    const app = await buildApp();

    const res = await request(app)
      .post('/api/issues')
      .send({ title: 'New', body: 'desc', labels: ['priority:low'] });

    expect(res.status).toBe(201);
    expect(res.body.number).toBe(99);
    const [, opts] = fetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toMatchObject({ title: 'New', body: 'desc', labels: ['priority:low'] });
  });
});

describe('PATCH /api/issues/:number', () => {
  it('forwards a label update to GitHub', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ghOk({ number: 5, labels: [] })));
    const app = await buildApp();

    const res = await request(app)
      .patch('/api/issues/5')
      .send({ labels: ['priority:high', 'bug'] });

    expect(res.status).toBe(200);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toContain('/issues/5');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body).labels).toEqual(['priority:high', 'bug']);
  });

  it('rejects an empty patch with 400', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp();

    const res = await request(app).patch('/api/issues/5').send({});

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
