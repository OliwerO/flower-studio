import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: mockCreate }; } }));

// Mock the tool registry so the loop test is independent of real DB.
vi.mock('../services/assistantTools/index.js', () => ({
  TOOL_DEFS: [{ name: 'query_orders', description: 'd', input_schema: { type: 'object', properties: {} } }],
  TOOL_HANDLERS: { query_orders: vi.fn(async (input) => ({ matchedCount: 3, echo: input })) },
}));

import { ask } from '../services/assistantService.js';
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
    expect(mockCreate.mock.calls.length).toBeLessThanOrEqual(7); // 1 initial + MAX_ITERATIONS(6)
    expect(r.answer).toBeTruthy();
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
