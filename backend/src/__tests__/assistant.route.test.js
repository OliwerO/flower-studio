// backend/src/__tests__/assistant.route.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/assistantService.js', () => ({
  ask: vi.fn(async ({ message }) => ({ sessionId: 's1', answer: `echo:${message}`, toolResults: [] })),
  listConversations: vi.fn(async () => [{ id: 'c1', title: 'T', updatedAt: '2026-06-29', messageCount: 2 }]),
  getConversation: vi.fn(async (id) => (id === 'c1' ? { id: 'c1', title: 'T', messages: [{ role: 'user', text: 'q' }] } : null)),
  renameConversation: vi.fn(async (id, title) => (id === 'c1' ? { id: 'c1', title } : null)),
  deleteConversation: vi.fn(async (id) => id === 'c1'),
}));

import assistantRouter from '../routes/assistant.js';
import { ask, listConversations, getConversation, renameConversation, deleteConversation } from '../services/assistantService.js';

function appWithRole(role) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.role = role; next(); }); // simulate authenticate()
  app.use('/api/assistant', assistantRouter);
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/assistant/message', () => {
  it('returns the assistant answer for the owner', async () => {
    const res = await request(appWithRole('owner')).post('/api/assistant/message').send({ message: 'привет' });
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe('echo:привет');
    expect(ask).toHaveBeenCalledWith({ sessionId: undefined, message: 'привет' });
  });
  it('rejects a florist with 403', async () => {
    const res = await request(appWithRole('florist')).post('/api/assistant/message').send({ message: 'x' });
    expect(res.status).toBe(403);
    expect(ask).not.toHaveBeenCalled();
  });
  it('400 when message missing', async () => {
    const res = await request(appWithRole('owner')).post('/api/assistant/message').send({});
    expect(res.status).toBe(400);
  });
});

describe('Ask Blossom conversation history routes', () => {
  it('GET /conversations lists for the owner', async () => {
    const res = await request(appWithRole('owner')).get('/api/assistant/conversations');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 'c1', messageCount: 2 });
  });

  it('GET /conversations is owner-only (403 florist)', async () => {
    const res = await request(appWithRole('florist')).get('/api/assistant/conversations');
    expect(res.status).toBe(403);
    expect(listConversations).not.toHaveBeenCalled();
  });

  it('GET /conversations/:id returns 200 then 404', async () => {
    expect((await request(appWithRole('owner')).get('/api/assistant/conversations/c1')).status).toBe(200);
    expect((await request(appWithRole('owner')).get('/api/assistant/conversations/nope')).status).toBe(404);
  });

  it('PATCH /conversations/:id renames; 400 empty; 404 missing', async () => {
    const ok = await request(appWithRole('owner')).patch('/api/assistant/conversations/c1').send({ title: 'New name' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: 'c1', title: 'New name' });
    expect((await request(appWithRole('owner')).patch('/api/assistant/conversations/c1').send({ title: '  ' })).status).toBe(400);
    expect((await request(appWithRole('owner')).patch('/api/assistant/conversations/nope').send({ title: 'x' })).status).toBe(404);
  });

  it('DELETE /conversations/:id returns 204 then 404', async () => {
    expect((await request(appWithRole('owner')).delete('/api/assistant/conversations/c1')).status).toBe(204);
    expect((await request(appWithRole('owner')).delete('/api/assistant/conversations/nope')).status).toBe(404);
  });
});
