import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: mockCreate }; } }));

// Mock the tool registry so the loop test is independent of real DB.
vi.mock('../services/assistantTools/index.js', () => ({
  TOOL_DEFS: [{ name: 'query_orders', description: 'd', input_schema: { type: 'object', properties: {} } }],
  TOOL_HANDLERS: { query_orders: vi.fn(async (input) => ({ matchedCount: 3, echo: input })) },
}));

const { mockUpsert, mockGetById, mockList, mockRename, mockRemove } = vi.hoisted(() => ({
  mockUpsert: vi.fn(async () => {}),
  mockGetById: vi.fn(async () => null),
  mockList: vi.fn(async () => []),
  mockRename: vi.fn(async () => null),
  mockRemove: vi.fn(async () => false),
}));
vi.mock('../repos/assistantConversationRepo.js', () => ({
  upsert: mockUpsert, getById: mockGetById, list: mockList, rename: mockRename, remove: mockRemove,
}));

import { ask, toDisplayTurns, listConversations, getConversation, renameConversation, deleteConversation } from '../services/assistantService.js';
import { TOOL_HANDLERS } from '../services/assistantTools/index.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('assistantService.ask', () => {
  it('runs a tool then returns the final text answer', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'query_orders', input: { from: '2026-05-01', to: '2026-05-31' } }],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'В мае было 3 заказа.' }],
      });

    const r = await ask({ message: 'Сколько заказов в мае?' });

    expect(TOOL_HANDLERS.query_orders).toHaveBeenCalledWith({ from: '2026-05-01', to: '2026-05-31' });
    expect(r.answer).toBe('В мае было 3 заказа.');
    expect(r.toolResults).toEqual([{ name: 'query_orders', input: { from: '2026-05-01', to: '2026-05-31' }, output: { matchedCount: 3, echo: { from: '2026-05-01', to: '2026-05-31' } } }]);
    expect(r.sessionId).toBeTruthy();
    // Second call must include the tool_result so the model can answer.
    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    expect(secondCallMessages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result'))).toBe(true);
  });

  it('passes tools + a date-grounded system prompt on the first call', async () => {
    mockCreate.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });
    await ask({ message: 'hi' });
    const call = mockCreate.mock.calls[0][0];
    expect(call.tools).toHaveLength(1);
    expect(call.system).toMatch(/\d{4}-\d{2}-\d{2}/); // today's date injected
  });

  it('continues an existing session by id', async () => {
    mockCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'a' }] });
    const first = await ask({ message: 'q1' });
    await ask({ sessionId: first.sessionId, message: 'q2' });
    const lastMessages = mockCreate.mock.calls.at(-1)[0].messages;
    expect(lastMessages.filter(m => m.role === 'user').length).toBeGreaterThanOrEqual(2);
  });

  it('stops after the iteration cap even if the model keeps calling tools', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu', name: 'query_orders', input: {} }],
    });
    const r = await ask({ message: 'loop' });
    // Cap-agnostic: the loop must terminate (1 initial + MAX_ITERATIONS round-trips,
    // default 12, env-overridable) rather than run forever, and still return an answer.
    const maxIters = Number(process.env.ASSISTANT_MAX_ITERATIONS) || 12;
    expect(mockCreate.mock.calls.length).toBeLessThanOrEqual(maxIters + 1);
    expect(mockCreate.mock.calls.length).toBeGreaterThan(1); // it did loop, not one-shot
    expect(r.answer).toBeTruthy();
  });

  it('session remains replayable after an iteration-cap hit (no dangling tool_use in history)', async () => {
    // Phase 1: force the cap — mockCreate always returns tool_use so the loop maxes out.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu', name: 'query_orders', input: {} }],
    });
    const first = await ask({ message: 'loop me' });
    expect(first.answer).toBeTruthy(); // cap fallback string, not a throw

    // Phase 2: use the same session — mockCreate now returns end_turn.
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });
    const second = await ask({ sessionId: first.sessionId, message: 'follow up' });

    // Must succeed and return the model's text.
    expect(second.answer).toBe('ok');

    // No assistant turn in the stored history may carry an unterminated tool_use block.
    // (Each such turn must be immediately followed by a user tool_result turn.)
    const finalMessages = mockCreate.mock.calls[0][0].messages;
    const danglingIdx = finalMessages.findIndex(
      (m, i) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some(b => b.type === 'tool_use') &&
        (i + 1 >= finalMessages.length || finalMessages[i + 1].role !== 'user' ||
          !Array.isArray(finalMessages[i + 1].content) ||
          !finalMessages[i + 1].content.some(b => b.type === 'tool_result'))
    );
    expect(danglingIdx).toBe(-1); // no dangling tool_use turn

    consoleSpy.mockRestore();
  });

  it('catches a tool handler throw and returns an error object in toolResults', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    TOOL_HANDLERS.query_orders.mockRejectedValueOnce(new Error('DB down'));
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'query_orders', input: {} }],
      })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'sorry' }] });
    const r = await ask({ message: 'test' });
    expect(r.toolResults[0].output).toEqual({ error: 'DB down' });
    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    expect(secondCallMessages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result'))).toBe(true);
    consoleSpy.mockRestore();
  });
});

describe('assistant chat history', () => {
  it('persists the conversation after a successful ask', async () => {
    mockCreate.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] });
    const r = await ask({ message: 'How many orders in May?' });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const arg = mockUpsert.mock.calls[0][0];
    expect(arg.id).toBe(r.sessionId);
    expect(arg.title).toBe('How many orders in May?'); // derived from first user message
    expect(Array.isArray(arg.messages)).toBe(true);
  });

  it('rehydrates a missing session from PG before answering', async () => {
    mockGetById.mockResolvedValueOnce({
      id: 'old-1', title: 't',
      messages: [{ role: 'user', content: 'earlier q' }, { role: 'assistant', content: [{ type: 'text', text: 'earlier a' }] }],
    });
    mockCreate.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'follow-up answer' }] });
    await ask({ sessionId: 'old-1', message: 'and June?' });
    expect(mockGetById).toHaveBeenCalledWith('old-1');
    const sentMessages = mockCreate.mock.calls[0][0].messages;
    expect(sentMessages[0]).toMatchObject({ role: 'user', content: 'earlier q' }); // prior turn restored
    expect(sentMessages.at(-1)).toMatchObject({ role: 'user', content: 'and June?' });
  });

  it('does not throw when persistence fails', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('db down'));
    mockCreate.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });
    await expect(ask({ message: 'q' })).resolves.toMatchObject({ answer: 'ok' });
  });

  it('toDisplayTurns keeps user text + assistant text, drops tool turns', () => {
    const turns = toDisplayTurns([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }] }, // pure tool_use → drop
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: '{}' }] },  // tool_result → drop
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
    ]);
    expect(turns).toEqual([{ role: 'user', text: 'q1' }, { role: 'assistant', text: 'answer' }]);
  });

  it('getConversation projects stored messages to display turns', async () => {
    mockGetById.mockResolvedValueOnce({ id: 'c1', title: 'T', messages: [{ role: 'user', content: 'hello' }] });
    expect(await getConversation('c1')).toEqual({ id: 'c1', title: 'T', messages: [{ role: 'user', text: 'hello' }] });
    mockGetById.mockResolvedValueOnce(null);
    expect(await getConversation('nope')).toBeNull();
  });

  it('list/rename/delete delegate to the repo', async () => {
    mockList.mockResolvedValueOnce([{ id: 'a', title: 't', updatedAt: 'x', messageCount: 2 }]);
    expect(await listConversations()).toHaveLength(1);
    mockRename.mockResolvedValueOnce({ id: 'a', title: 'new' });
    expect(await renameConversation('a', 'new')).toMatchObject({ title: 'new' });
    mockRemove.mockResolvedValueOnce(true);
    expect(await deleteConversation('a')).toBe(true);
  });
});
