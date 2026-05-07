import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks (must be before imports) ────────────────────────────────────────────

// Use vi.hoisted so these variables are available inside vi.mock factories (which are hoisted)
const { mockCreate, valuesMock } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  valuesMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

vi.mock('../db/index.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: valuesMock }),
  },
}));
vi.mock('../db/schema.js', () => ({ feedbackReports: {} }));

global.fetch = vi.fn();
process.env.GITHUB_TOKEN = 'test-token';

// ── Helpers ───────────────────────────────────────────────────────────────────

function doneResponse(overrides = {}) {
  return {
    content: [{ text: JSON.stringify({
      done: true,
      type: 'bug',
      englishTitle: 'Button does not work on order screen',
      englishDescription: 'The save button on the Order edit screen does nothing when tapped.',
      acceptanceCriteria: ['Tapping Save on the Order edit screen saves changes'],
      originalQuote: 'кнопка не работает',
      russianSummary: 'Кнопка сохранения на экране редактирования заказа не работает.',
      ...overrides,
    }) }],
  };
}

function questionResponse(question) {
  return {
    content: [{ text: JSON.stringify({ done: false, question }) }],
  };
}

// ── Imports ───────────────────────────────────────────────────────────────────

import { startSession, publishSession, continueSession, previewSession, sessions } from '../services/feedbackService.js';
import { db } from '../db/index.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  sessions.clear();
  vi.clearAllMocks();
  mockCreate.mockResolvedValue(doneResponse());
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ number: 42, html_url: 'https://github.com/OliwerO/flower-studio/issues/42' }),
    text: async () => '',
  });
});

// ── startSession ──────────────────────────────────────────────────────────────

describe('startSession', () => {
  it('creates session and returns done:true when AI has enough info', async () => {
    const result = await startSession({
      text: 'кнопка не работает',
      reporterRole: 'florist',
      reporterName: 'Анна',
    });
    expect(result.sessionId).toBeDefined();
    expect(result.done).toBe(true);
    expect(sessions.get(result.sessionId).type).toBe('bug');
  });

  it('returns done:false + question when AI needs more info', async () => {
    mockCreate.mockResolvedValueOnce(questionResponse('На каком экране это произошло?'));

    const result = await startSession({
      text: 'что-то сломалось',
      reporterRole: 'owner',
      reporterName: 'Owner',
    });
    expect(result.done).toBe(false);
    expect(result.question).toBe('На каком экране это произошло?');
    expect(sessions.get(result.sessionId).done).toBe(false);
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

  it('strips markdown fences and parses JSON correctly', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: '```json\n' + JSON.stringify({
        done: true, type: 'feature',
        englishTitle: 'Filter orders by delivery date',
        englishDescription: 'Add date range filter for delivery/pickup dates.',
        acceptanceCriteria: ['Orders tab has delivery date filter'],
        originalQuote: 'filter by delivery date',
        russianSummary: 'Добавить фильтр по дате доставки.',
      }) + '\n```' }],
    });
    const result = await startSession({ text: 'filter by delivery date', reporterRole: 'owner', reporterName: 'Owner' });
    expect(result.done).toBe(true);
    expect(sessions.get(result.sessionId).type).toBe('feature');
  });

  it('falls back to Russian error only on truly unparseable response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: 'Sorry, I cannot help with that.' }], // plain prose — not JSON at all
    });
    const result = await startSession({ text: 'x', reporterRole: 'driver', reporterName: 'Timur' });
    expect(result.done).toBe(false);
    expect(result.question).toMatch(/Извините/);
  });
});

// ── continueSession ───────────────────────────────────────────────────────────

describe('continueSession', () => {
  it('sends full conversation history to AI', async () => {
    // Start with AI asking a question
    mockCreate.mockResolvedValueOnce(questionResponse('На каком экране это произошло?'));
    const { sessionId } = await startSession({
      text: 'кнопка не работает',
      reporterRole: 'florist',
      reporterName: 'Анна',
    });

    // Continue — AI now has enough info
    mockCreate.mockResolvedValueOnce(doneResponse());
    await continueSession(sessionId, 'На экране заказов');

    // Verify the messages sent to the AI on the second call
    const secondCall = mockCreate.mock.calls[1][0];
    expect(secondCall.messages).toEqual([
      { role: 'user', content: 'кнопка не работает' },
      { role: 'assistant', content: 'На каком экране это произошло?' },
      { role: 'user', content: 'На экране заказов' },
    ]);
  });

  it('does not corrupt session state if AI call throws', async () => {
    mockCreate.mockResolvedValueOnce(questionResponse('Какой экран?'));
    const { sessionId } = await startSession({
      text: 'проблема',
      reporterRole: 'florist',
      reporterName: 'Анна',
    });

    const originalMessages = [...sessions.get(sessionId).messages];
    const originalLastQuestion = sessions.get(sessionId).lastQuestion;

    // AI throws on next call
    mockCreate.mockRejectedValueOnce(new Error('Anthropic 503'));

    await expect(continueSession(sessionId, 'ответ')).rejects.toThrow('503');

    // Session state must be unchanged
    expect(sessions.get(sessionId).messages).toEqual(originalMessages);
    expect(sessions.get(sessionId).lastQuestion).toBe(originalLastQuestion);
    expect(sessions.get(sessionId).done).toBe(false);
  });

  it('marks session done and stores AI fields on completion', async () => {
    mockCreate.mockResolvedValueOnce(questionResponse('На каком экране?'));
    const { sessionId } = await startSession({ text: 'x', reporterRole: 'florist', reporterName: 'Анна' });

    await continueSession(sessionId, 'на экране заказов');

    expect(sessions.get(sessionId).done).toBe(true);
    expect(sessions.get(sessionId).type).toBe('bug');
  });

  it('returns done:true immediately if session already done', async () => {
    const { sessionId } = await startSession({ text: 'test', reporterRole: 'owner', reporterName: 'Owner' });
    const result = await continueSession(sessionId, 'extra');
    expect(result.done).toBe(true);
  });

  it('throws on unknown sessionId', async () => {
    await expect(continueSession('bad-id', 'text')).rejects.toThrow('not found');
  });
});

// ── previewSession ────────────────────────────────────────────────────────────

describe('previewSession', () => {
  it('returns russianSummary from completed session', async () => {
    const { sessionId } = await startSession({
      text: 'кнопка не работает',
      reporterRole: 'florist',
      reporterName: 'Анна',
    });
    const { summary } = await previewSession(sessionId);
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
  });

  it('throws on unknown sessionId', async () => {
    await expect(previewSession('bad-id')).rejects.toThrow('not found');
  });

  it('throws when session is not done', async () => {
    mockCreate.mockResolvedValueOnce(questionResponse('Какой экран?'));
    const { sessionId } = await startSession({ text: 'x', reporterRole: 'florist', reporterName: 'Анна' });
    await expect(previewSession(sessionId)).rejects.toThrow('not complete');
  });
});

// ── publishSession ────────────────────────────────────────────────────────────

describe('publishSession', () => {
  it('creates GitHub issue with correct fields and inserts DB row', async () => {
    const { sessionId } = await startSession({
      text: 'Не отображается кнопка',
      reporterRole: 'florist',
      reporterName: 'Анна',
    });

    const result = await publishSession(sessionId);

    // GitHub API called correctly
    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/repos/OliwerO/flower-studio/issues');
    expect(JSON.parse(opts.body)).toMatchObject({ labels: ['needs-triage'], title: expect.any(String) });

    // DB row written with correct payload
    expect(valuesMock).toHaveBeenCalledWith({
      githubIssueNumber: 42,
      reporterRole: 'florist',
      reporterName: 'Анна',
      telegramChatId: null,
    });

    expect(result.issueUrl).toContain('github.com');
    expect(result.issueNumber).toBe(42);
  });

  it('throws on unknown sessionId', async () => {
    await expect(publishSession('nonexistent')).rejects.toThrow('Session not found');
  });

  it('deletes session after successful publish', async () => {
    const { sessionId } = await startSession({ text: 'Test', reporterRole: 'driver', reporterName: 'Timur' });
    await publishSession(sessionId);
    expect(sessions.has(sessionId)).toBe(false);
  });

  it('throws when GITHUB_TOKEN is missing', async () => {
    const token = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const { sessionId } = await startSession({ text: 'x', reporterRole: 'owner', reporterName: 'Owner' });
    await expect(publishSession(sessionId)).rejects.toThrow('GITHUB_TOKEN');
    process.env.GITHUB_TOKEN = token;
  });

  it('uploads screenshot and embeds URL in issue body when imageBuffer provided', async () => {
    global.fetch
      .mockReset()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}), // image upload response
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ number: 99, html_url: 'https://github.com/OliwerO/flower-studio/issues/99' }),
        text: async () => '',
      });

    const { sessionId } = await startSession({ text: 'screenshot test', reporterRole: 'florist', reporterName: 'Анна' });
    const fakeBuffer = Buffer.from('fake image data');
    const result = await publishSession(sessionId, fakeBuffer, 'test.jpg');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    // First call is image upload (PUT to contents API)
    const [uploadUrl, uploadOpts] = global.fetch.mock.calls[0];
    expect(uploadUrl).toContain('/contents/feedback-screenshots/');
    expect(uploadOpts.method).toBe('PUT');
    const uploadBody = JSON.parse(uploadOpts.body);
    expect(uploadBody.content).toBe(fakeBuffer.toString('base64'));

    expect(result.issueNumber).toBe(99);
  });

  it('creates issue without screenshot when image upload fails', async () => {
    global.fetch
      .mockReset()
      .mockResolvedValueOnce({ ok: false, text: async () => 'upload error' })  // image upload fails
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ number: 100, html_url: 'https://github.com/OliwerO/flower-studio/issues/100' }),
        text: async () => '',
      });

    const { sessionId } = await startSession({ text: 'screenshot fail test', reporterRole: 'florist', reporterName: 'Анна' });
    const result = await publishSession(sessionId, Buffer.from('img'), 'test.png');

    expect(result.issueNumber).toBe(100); // issue still created
  });
});
