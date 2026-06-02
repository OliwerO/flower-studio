import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../repos/floristTelegramRepo.js');
vi.mock('../services/telegram.js', async (orig) => ({
  ...(await orig()),
  sendToChat: vi.fn(),
}));
import { getFloristChatId, getFloristLang } from '../repos/floristTelegramRepo.js';
import { sendToChat } from '../services/telegram.js';
import { notifyFloristNewOrder } from '../services/floristNotifyService.js';

beforeEach(() => { vi.clearAllMocks(); });

it('skips when no florist phone is registered', async () => {
  getFloristChatId.mockResolvedValue(null);
  await notifyFloristNewOrder({ order: { 'App Order ID': '123' } });
  expect(sendToChat).not.toHaveBeenCalled();
});

it('sends a Russian message with order number to the registered phone', async () => {
  getFloristChatId.mockResolvedValue('555');
  getFloristLang.mockResolvedValue('ru');
  await notifyFloristNewOrder({
    order: { 'App Order ID': '123', 'Required By': '2026-06-03', 'Delivery Time': '12:00-14:00', 'Customer Request': 'Розы' },
    deliveryType: 'Delivery', source: 'Wix',
  });
  expect(sendToChat).toHaveBeenCalledTimes(1);
  const [chatId, text] = sendToChat.mock.calls[0];
  expect(chatId).toBe('555');
  expect(text).toContain('123');
  expect(text).toContain('Новый заказ');
});

it('escapes HTML in user-controlled fields', async () => {
  getFloristChatId.mockResolvedValue('555');
  getFloristLang.mockResolvedValue('ru');
  await notifyFloristNewOrder({ order: { 'App Order ID': '1', 'Customer Request': '<b>x</b>' } });
  expect(sendToChat.mock.calls[0][1]).toContain('&lt;b&gt;');
});

it('never throws when sendToChat rejects', async () => {
  getFloristChatId.mockResolvedValue('555');
  getFloristLang.mockResolvedValue('ru');
  sendToChat.mockRejectedValue(new Error('telegram down'));
  await expect(notifyFloristNewOrder({ order: { 'App Order ID': '1' } })).resolves.toBeUndefined();
});
