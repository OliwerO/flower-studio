import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../repos/driverTelegramRepo.js', () => ({ getDriver: vi.fn() }));
vi.mock('../services/telegram.js', () => ({
  sendToChat: vi.fn(),
  escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
}));
vi.mock('../repos/orderRepo.js', () => ({ getById: vi.fn() }));
vi.mock('../repos/stockOrderRepo.js', () => ({
  getById: vi.fn(),
  getLinesByPoId: vi.fn(),
}));

import { notifyDeliveryAssigned, notifyDeliveryDigest, notifyPoAssigned } from '../services/driverNotifyService.js';
import { getDriver } from '../repos/driverTelegramRepo.js';
import { sendToChat } from '../services/telegram.js';
import * as orderRepo from '../repos/orderRepo.js';
import * as stockOrderRepo from '../repos/stockOrderRepo.js';

const delivery = {
  orderId: 'o1',
  'Delivery Date': '2026-06-02',
  'Delivery Time': '10-12',
  'Delivery Address': 'ul. Kwiatowa 5',
};

describe('notifyDeliveryAssigned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orderRepo.getById.mockResolvedValue({ 'App Order ID': 'A-100' });
  });

  it('sends a Russian delivery message to a ru driver', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'ru' });
    await notifyDeliveryAssigned({ delivery, driverName: 'Nikita' });
    const [chatId, text] = sendToChat.mock.calls[0];
    expect(chatId).toBe('42');
    expect(text).toContain('назначена доставка');
    expect(text).toContain('A-100');
    expect(text).toContain('ul. Kwiatowa 5');
    expect(text).toContain('10-12');
  });

  it('sends an English message to an en driver', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'en' });
    await notifyDeliveryAssigned({ delivery, driverName: 'Bjorn' });
    expect(sendToChat.mock.calls[0][1]).toContain('assigned a delivery');
  });

  it('sends a Polish message to a pl driver', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'pl' });
    await notifyDeliveryAssigned({ delivery, driverName: 'Anna' });
    expect(sendToChat.mock.calls[0][1]).toContain('Przydzielono');
  });

  it('falls back to ru for an unknown lang', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'de' });
    await notifyDeliveryAssigned({ delivery, driverName: 'X' });
    expect(sendToChat.mock.calls[0][1]).toContain('назначена доставка');
  });

  it('suppresses notification on self-claim (actor === assignee)', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'ru' });
    await notifyDeliveryAssigned({ delivery, driverName: 'Nikita', actorName: 'Nikita' });
    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('skips (no throw) when the driver has no chat id', async () => {
    getDriver.mockResolvedValue({ chatId: null, lang: 'en' });
    await expect(notifyDeliveryAssigned({ delivery, driverName: 'Timur' })).resolves.toBeUndefined();
    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('skips (no throw) when the driver row is missing', async () => {
    getDriver.mockResolvedValue(null);
    await expect(notifyDeliveryAssigned({ delivery, driverName: 'Ghost' })).resolves.toBeUndefined();
    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('does nothing when driverName is empty', async () => {
    await notifyDeliveryAssigned({ delivery, driverName: '' });
    expect(getDriver).not.toHaveBeenCalled();
  });

  it('never throws into the caller when the send fails', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'ru' });
    sendToChat.mockRejectedValue(new Error('telegram down'));
    await expect(notifyDeliveryAssigned({ delivery, driverName: 'Nikita' })).resolves.toBeUndefined();
  });

  it('HTML-escapes special chars in address so Telegram does not reject with 400', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'en' });
    orderRepo.getById.mockResolvedValue({ 'App Order ID': 'A-100' });
    const badAddr = { ...delivery, 'Delivery Address': 'A & B <1>' };
    await notifyDeliveryAssigned({ delivery: badAddr, driverName: 'Nikita' });
    const text = sendToChat.mock.calls[0][1];
    expect(text).toContain('A &amp; B &lt;1&gt;');
    expect(text).not.toContain('A & B <1>');
  });
});

describe('notifyDeliveryDigest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orderRepo.getById.mockImplementation(async (id) => ({ 'App Order ID': `A-${id}` }));
  });

  it('sends ONE message summarising all assigned deliveries (driver lang)', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'en' });
    const deliveries = [
      { orderId: '1', 'Delivery Time': '10-12', 'Delivery Address': 'Addr 1' },
      { orderId: '2', 'Delivery Time': '12-14', 'Delivery Address': 'Addr 2' },
    ];
    await notifyDeliveryDigest({ driverName: 'Bjorn', deliveries });
    expect(sendToChat).toHaveBeenCalledTimes(1);
    const text = sendToChat.mock.calls[0][1];
    expect(text).toContain("today's driver");
    expect(text).toContain('2');
    expect(text).toContain('Addr 1');
    expect(text).toContain('Addr 2');
  });

  it('sends nothing for an empty delivery list', async () => {
    await notifyDeliveryDigest({ driverName: 'Nikita', deliveries: [] });
    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('skips an unregistered driver without throwing', async () => {
    getDriver.mockResolvedValue({ chatId: null, lang: 'ru' });
    await expect(
      notifyDeliveryDigest({ driverName: 'Timur', deliveries: [{ orderId: '1' }] })
    ).resolves.toBeUndefined();
    expect(sendToChat).not.toHaveBeenCalled();
  });
});

describe('notifyPoAssigned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stockOrderRepo.getById.mockResolvedValue({ _pgId: 'p1', 'Stock Order ID': 'PO-7', 'Planned Date': '2026-06-03' });
    stockOrderRepo.getLinesByPoId.mockResolvedValue([
      { 'Flower Name': 'Rose Red' }, { 'Flower Name': 'Peony Pink' },
    ]);
  });

  it('sends a Russian pickup message with PO ref, date and flower list', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'ru' });
    await notifyPoAssigned({ stockOrderId: 'PO-7', driverName: 'Nikita' });
    const text = sendToChat.mock.calls[0][1];
    expect(text).toContain('назначена закупка');
    expect(text).toContain('PO-7');
    expect(text).toContain('2026-06-03');
    expect(text).toContain('Rose Red');
    expect(text).toContain('Peony Pink');
  });

  it('sends an English pickup message to an en driver', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'en' });
    await notifyPoAssigned({ stockOrderId: 'PO-7', driverName: 'Bjorn' });
    expect(sendToChat.mock.calls[0][1]).toContain('purchase run');
  });

  it('skips an unregistered driver without throwing', async () => {
    getDriver.mockResolvedValue({ chatId: null, lang: 'ru' });
    await expect(notifyPoAssigned({ stockOrderId: 'PO-7', driverName: 'Timur' })).resolves.toBeUndefined();
    expect(sendToChat).not.toHaveBeenCalled();
  });
});
