import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../repos/driverTelegramRepo.js', () => ({
  setChatId: vi.fn(),
  getDriver: vi.fn(),
}));
vi.mock('../services/telegram.js', () => ({
  sendToChat: vi.fn(),
  escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
}));
vi.mock('../utils/driverPins.js', () => ({
  resolveDriverByPin: vi.fn(),
  resolveFloristByPin: vi.fn(),
}));
vi.mock('../repos/floristTelegramRepo.js', () => ({
  setFloristChatId: vi.fn(),
  getFloristLang: vi.fn(),
}));

import { handleDriverUpdate } from '../services/driverBot.js';
import * as repo from '../repos/driverTelegramRepo.js';
import { sendToChat } from '../services/telegram.js';
import { resolveDriverByPin, resolveFloristByPin } from '../utils/driverPins.js';
import { setFloristChatId, getFloristLang } from '../repos/floristTelegramRepo.js';

describe('handleDriverUpdate (/start registration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveDriverByPin.mockReturnValue('Nikita');
    resolveFloristByPin.mockReturnValue(null);
    repo.getDriver.mockResolvedValue({ chatId: '42', lang: 'ru' });
    getFloristLang.mockResolvedValue('ru');
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
    resolveDriverByPin.mockReturnValue(null);
    resolveFloristByPin.mockReturnValue(null);
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

  // florist branch
  it('registers the florist phone on /start <PIN_FLORIST> and confirms', async () => {
    resolveDriverByPin.mockReturnValue(null);
    resolveFloristByPin.mockReturnValue('florist');
    getFloristLang.mockResolvedValue('ru');
    await handleDriverUpdate({ message: { chat: { id: 555 }, text: '/start 2580' } });
    expect(setFloristChatId).toHaveBeenCalledWith('555');
    expect(sendToChat).toHaveBeenCalledWith('555', expect.stringContaining('🌸'));
  });

  it('does not register florist when neither driver nor florist PIN matches', async () => {
    resolveDriverByPin.mockReturnValue(null);
    resolveFloristByPin.mockReturnValue(null);
    await handleDriverUpdate({ message: { chat: { id: 555 }, text: '/start nope' } });
    expect(setFloristChatId).not.toHaveBeenCalled();
    expect(sendToChat).toHaveBeenCalledWith('555', expect.stringContaining('PIN'));
  });
});
