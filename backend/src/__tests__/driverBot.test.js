import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../repos/driverTelegramRepo.js', () => ({
  setChatId: vi.fn(),
  getDriver: vi.fn(),
}));
vi.mock('../services/telegram.js', () => ({ sendToChat: vi.fn() }));

import { handleDriverUpdate } from '../services/driverBot.js';
import * as repo from '../repos/driverTelegramRepo.js';
import { sendToChat } from '../services/telegram.js';

describe('handleDriverUpdate (/start registration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PIN_DRIVER_NIKITA = '5678';
    repo.getDriver.mockResolvedValue({ chatId: '42', lang: 'ru' });
  });

  it('registers a valid PIN and confirms in the stored language', async () => {
    await handleDriverUpdate({ message: { chat: { id: 42 }, text: '/start 5678' } });
    expect(repo.setChatId).toHaveBeenCalledWith('Nikita', '42');
    expect(sendToChat).toHaveBeenCalledWith('42', expect.stringContaining('Nikita'));
  });

  it('confirms in English when the driver lang is en', async () => {
    repo.getDriver.mockResolvedValue({ chatId: '42', lang: 'en' });
    await handleDriverUpdate({ message: { chat: { id: 42 }, text: '/start 5678' } });
    expect(sendToChat).toHaveBeenCalledWith('42', expect.stringContaining('Nikita'));
    expect(sendToChat.mock.calls[0][1]).toMatch(/connected|notifications/i);
  });

  it('rejects a wrong PIN without storing anything', async () => {
    await handleDriverUpdate({ message: { chat: { id: 42 }, text: '/start 0000' } });
    expect(repo.setChatId).not.toHaveBeenCalled();
    expect(sendToChat).toHaveBeenCalledWith('42', expect.stringContaining('PIN'));
  });

  it('ignores non-/start messages', async () => {
    await handleDriverUpdate({ message: { chat: { id: 42 }, text: 'hello' } });
    expect(repo.setChatId).not.toHaveBeenCalled();
  });

  it('ignores updates without a text message', async () => {
    await handleDriverUpdate({ edited_message: {} });
    expect(repo.setChatId).not.toHaveBeenCalled();
  });

  it('sends error message and does not confirm when setChatId rejects', async () => {
    repo.setChatId.mockRejectedValue(new Error('DB connection failed'));
    await handleDriverUpdate({ message: { chat: { id: 42 }, text: '/start 5678' } });
    expect(sendToChat).toHaveBeenCalledTimes(1);
    expect(sendToChat).toHaveBeenCalledWith('42', expect.stringContaining('зарегистрировать'));
    // success confirmation must NOT be sent
    expect(sendToChat.mock.calls[0][1]).not.toContain('Nikita');
  });

  it('registers successfully when /start has double space before PIN', async () => {
    repo.setChatId.mockResolvedValue(undefined);
    await handleDriverUpdate({ message: { chat: { id: 42 }, text: '/start  5678' } });
    expect(repo.setChatId).toHaveBeenCalledWith('Nikita', '42');
    expect(sendToChat).toHaveBeenCalledWith('42', expect.stringContaining('Nikita'));
  });
});
