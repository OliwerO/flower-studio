// backend/src/__tests__/assistant.route.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/assistantService.js', () => ({
  ask: vi.fn(async ({ message }) => ({ sessionId: 's1', answer: `echo:${message}`, toolResults: [] })),
}));

import assistantRouter from '../routes/assistant.js';
import { ask } from '../services/assistantService.js';

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
