// Unit test for toDisplayTurns — the projection of the canonical Anthropic
// message array into UI display turns.
//
// Explorer v2 Wave 1 (#497): a reopened chat must keep the "Open in Orders" /
// "Open in Explorer" handoff button. The button renders from `toolResults` on
// the message; the live path attaches them to the final answer. On reopen the
// projection must reconstruct the same {name, output} for the signal tools from
// the stored tool_use / tool_result blocks, and attach them to the answer turn.
//
// The Anthropic SDK is mocked so importing assistantService doesn't build a
// live client (mirrors assistantTools.goldenQuestions.test.js).

import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: vi.fn() }; },
}));

const { toDisplayTurns } = await import('../services/assistantService.js');

// Helpers to build canonical stored turns the way ask() persists them.
const userText = (text) => ({ role: 'user', content: text });
const assistantText = (text) => ({ role: 'assistant', content: [{ type: 'text', text }] });
const assistantToolUse = (id, name, input = {}) => ({
  role: 'assistant',
  content: [{ type: 'tool_use', id, name, input }],
});
const toolResultTurn = (id, output) => ({
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(output) }],
});

describe('toDisplayTurns', () => {
  it('projects a plain Q&A with no tool blocks', () => {
    const turns = toDisplayTurns([userText('hi'), assistantText('hello')]);
    expect(turns).toEqual([
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'hello' },
    ]);
  });

  it('surfaces an open_orders_view signal onto the following answer turn', () => {
    const stored = [
      userText('which orders are unpaid?'),
      assistantToolUse('tu_1', 'open_orders_view', { paymentStatus: 'unpaid' }),
      toolResultTurn('tu_1', { view: 'orders', filter: { paymentStatus: 'unpaid' }, label: 'Неоплаченные заказы', labelEn: 'Unpaid orders' }),
      assistantText('You have 2 unpaid orders.'),
    ];
    const turns = toDisplayTurns(stored);
    expect(turns).toEqual([
      { role: 'user', text: 'which orders are unpaid?' },
      {
        role: 'assistant',
        text: 'You have 2 unpaid orders.',
        toolResults: [
          { name: 'open_orders_view', output: { view: 'orders', filter: { paymentStatus: 'unpaid' }, label: 'Неоплаченные заказы', labelEn: 'Unpaid orders' } },
        ],
      },
    ]);
  });

  it('surfaces an open_explorer_view signal onto the answer turn', () => {
    const spec = { entity: 'purchases', filters: [{ field: 'supplier', op: 'eq', value: 'X' }], sort: [] };
    const stored = [
      userText('purchases from X'),
      assistantToolUse('tu_9', 'open_explorer_view', { spec }),
      toolResultTurn('tu_9', { view: 'explorer', spec, label: 'Закупки', labelEn: 'Purchases' }),
      assistantText('Here they are.'),
    ];
    const turns = toDisplayTurns(stored);
    expect(turns[1].toolResults).toEqual([
      { name: 'open_explorer_view', output: { view: 'explorer', spec, label: 'Закупки', labelEn: 'Purchases' } },
    ]);
  });

  it('attaches BOTH signals when a turn emitted both', () => {
    const spec = { entity: 'orders', filters: [], sort: [] };
    const stored = [
      userText('unpaid orders'),
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'a', name: 'open_orders_view', input: {} },
          { type: 'tool_use', id: 'b', name: 'open_explorer_view', input: { spec } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'a', content: JSON.stringify({ view: 'orders', filter: {}, label: 'Заказы', labelEn: 'Orders' }) },
          { type: 'tool_result', tool_use_id: 'b', content: JSON.stringify({ view: 'explorer', spec, label: 'Заказы', labelEn: 'Orders' }) },
        ],
      },
      assistantText('done'),
    ];
    const names = toDisplayTurns(stored)[1].toolResults.map((r) => r.name);
    expect(names).toEqual(['open_orders_view', 'open_explorer_view']);
  });

  it('does NOT surface non-signal data tools (e.g. query_records)', () => {
    const stored = [
      userText('count orders'),
      assistantToolUse('tu_2', 'query_records', { entity: 'orders' }),
      toolResultTurn('tu_2', { rows: [], matchedCount: 0 }),
      assistantText('There are 0 orders.'),
    ];
    const turns = toDisplayTurns(stored);
    expect(turns[1].toolResults).toBeUndefined();
  });

  it('drops a signal whose tool_result is an error', () => {
    const stored = [
      userText('bad'),
      assistantToolUse('tu_3', 'open_explorer_view', { spec: {} }),
      toolResultTurn('tu_3', { error: 'invalid spec' }),
      assistantText('Sorry.'),
    ];
    const turns = toDisplayTurns(stored);
    expect(turns[1].toolResults).toBeUndefined();
  });

  it('does not emit a display turn for an intermediate tool_use-only turn', () => {
    const stored = [
      userText('q'),
      assistantToolUse('tu_4', 'open_orders_view', {}),
      toolResultTurn('tu_4', { view: 'orders', filter: {}, label: 'Заказы', labelEn: 'Orders' }),
      assistantText('a'),
    ];
    const turns = toDisplayTurns(stored);
    // user + single assistant answer only (no stray turn for the tool_use step)
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant']);
  });
});
