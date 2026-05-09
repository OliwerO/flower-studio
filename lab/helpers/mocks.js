// lab/helpers/mocks.js
//
// Deterministic stubs for Telegram + Claude AI. Lab tests use these
// helpers to assert behaviour without firing real third-party calls.
//
// Why not stub them globally like Wix? Telegram + Claude integrations
// fail-fast when the dummy API keys are used, which is the right
// default for lab boots (no accidental noise). Tests that need to
// assert "the system tried to send a Telegram alert" override the
// relevant service module's exports per-test using vitest's `vi.doMock`.
//
// Path notes: vi.doMock resolves paths relative to the module that calls
// it — which is this file (lab/helpers/mocks.js). Two levels up from
// lab/helpers/ reaches repo root; then backend/src/services/ as normal.

import { vi } from 'vitest';

/**
 * Stub all Telegram notification functions.
 *
 * Returns a `sent` array that accumulates calls so tests can assert:
 *   const { sent } = stubTelegram();
 *   // ... trigger an action ...
 *   expect(sent.some(m => m.text.includes('New order'))).toBe(true);
 *
 * Matches the real exports of backend/src/services/telegram.js:
 *   sendAlert(text)
 *   broadcastAlert(text)
 *   notifyNewOrder({ source, customerName, request, deliveryType, price })
 *   notifyWixSyncError({ direction, errors })
 *   notifyDeliveryComplete({ customerName, appOrderId, bouquetSummary,
 *                            recipientName, plannedSlot, deliveredAtIso, driver })
 *   _internals — exposed for unit tests; stub is a passthrough object.
 */
export function stubTelegram() {
  const sent = [];

  vi.doMock('../../backend/src/services/telegram.js', () => ({
    sendAlert: async (text) => {
      sent.push({ fn: 'sendAlert', text });
      return { ok: true };
    },
    broadcastAlert: async (text) => {
      sent.push({ fn: 'broadcastAlert', text });
      return { ok: true };
    },
    notifyNewOrder: async (payload) => {
      sent.push({ fn: 'notifyNewOrder', ...payload });
      return { ok: true };
    },
    notifyWixSyncError: async (payload) => {
      sent.push({ fn: 'notifyWixSyncError', ...payload });
      return { ok: true };
    },
    notifyDeliveryComplete: async (payload) => {
      sent.push({ fn: 'notifyDeliveryComplete', ...payload });
      return { ok: true };
    },
    // _internals is used in unit tests for parseSlot etc.; expose a no-op
    // object so any import doesn't throw.
    _internals: {},
  }));

  return { sent };
}

/**
 * Stub the Claude AI intake parser.
 *
 * `canned` is a map of { [inputText]: parsedResult }. Any text not in
 * the map returns a safe default { customer: 'Stub', lines: [] }.
 *
 * Matches the real exports of backend/src/services/intake-parser.js:
 *   parseRawText(text, stockItems)
 *   parseFlowwowEmail(emailBody, stockItems)
 *   matchStockItems(extractedItems, stockItems)
 *
 * Usage:
 *   stubClaudeParser({ 'Роза 5 штук': { customer: 'Иван', lines: [...] } });
 */
export function stubClaudeParser(canned = {}) {
  vi.doMock('../../backend/src/services/intake-parser.js', () => ({
    parseRawText: async (text, _stockItems) =>
      canned[text] ?? { customer: 'Stub', lines: [] },
    parseFlowwowEmail: async (emailBody, _stockItems) =>
      canned[emailBody] ?? { customer: 'Stub', lines: [] },
    matchStockItems: async (extractedItems, _stockItems) =>
      extractedItems.map((item) => ({ ...item, stockItemId: null })),
  }));
}
