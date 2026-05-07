import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock DB — must be before importing the service
vi.mock('../db/index.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
vi.mock('../db/schema.js', () => ({ feedbackReports: {} }));

// Mock Anthropic — returns a complete "done" response by default
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ text: JSON.stringify({
          done: true,
          type: 'bug',
          englishTitle: 'Button does not work on order screen',
          englishDescription: 'The save button on the Order edit screen does nothing when tapped.',
          acceptanceCriteria: ['Tapping Save on the Order edit screen saves changes'],
          originalQuote: 'кнопка не работает',
          russianSummary: 'Кнопка сохранения на экране редактирования заказа не работает.',
        }) }],
      }),
    };
  },
}));

// Mock fetch for GitHub API
global.fetch = vi.fn();

// Set required env
process.env.GITHUB_TOKEN = 'test-token';

import { startSession, publishSession, sessions } from '../services/feedbackService.js';
import { db } from '../db/index.js';

beforeEach(() => {
  sessions.clear();
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ number: 42, html_url: 'https://github.com/OliwerO/flower-studio/issues/42' }),
    text: async () => '',
  });
});

describe('startSession', () => {
  it('creates a session and returns sessionId + done:true', async () => {
    const result = await startSession({
      text: 'Кнопка не работает',
      reporterRole: 'florist',
      reporterName: 'Анна',
    });

    expect(result.sessionId).toBeDefined();
    expect(result.done).toBe(true);
    expect(sessions.has(result.sessionId)).toBe(true);
    expect(sessions.get(result.sessionId).type).toBe('bug');
  });

  it('stores appArea when provided', async () => {
    const { sessionId } = await startSession({
      text: 'Проблема',
      reporterRole: 'owner',
      reporterName: 'Owner',
      appArea: 'dashboard',
    });
    expect(sessions.get(sessionId).appArea).toBe('dashboard');
  });
});

describe('publishSession', () => {
  it('creates a GitHub issue and inserts a DB row', async () => {
    const { sessionId } = await startSession({
      text: 'Не отображается кнопка',
      reporterRole: 'florist',
      reporterName: 'Анна',
    });

    const result = await publishSession(sessionId);

    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/repos/OliwerO/flower-studio/issues');
    expect(JSON.parse(opts.body)).toMatchObject({
      labels: ['needs-triage'],
      title: expect.any(String),
    });

    expect(result.issueUrl).toContain('github.com');
    expect(result.issueNumber).toBe(42);

    // Assert DB insert was called with correct payload
    const insertMock = db.insert.mock.results[0].value.values;
    expect(insertMock).toHaveBeenCalledWith({
      githubIssueNumber: 42,
      reporterRole: 'florist',
      reporterName: 'Анна',
      telegramChatId: null,
    });
  });

  it('throws if sessionId is not found', async () => {
    await expect(publishSession('nonexistent')).rejects.toThrow('Session not found');
  });

  it('deletes session after successful publish', async () => {
    const { sessionId } = await startSession({
      text: 'Test',
      reporterRole: 'driver',
      reporterName: 'Timur',
    });
    await publishSession(sessionId);
    expect(sessions.has(sessionId)).toBe(false);
  });

  it('throws if GITHUB_TOKEN is missing', async () => {
    const token = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const { sessionId } = await startSession({ text: 'x', reporterRole: 'owner', reporterName: 'Owner' });
    await expect(publishSession(sessionId)).rejects.toThrow('GITHUB_TOKEN');
    process.env.GITHUB_TOKEN = token;
  });
});
