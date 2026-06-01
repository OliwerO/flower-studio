import { describe, it, expect } from 'vitest';
import { makeDriverTelegramChat } from './driverTelegramChat.js';

describe('makeDriverTelegramChat', () => {
  it('returns a row matching the driver_telegram_chats schema', () => {
    const r = makeDriverTelegramChat();
    expect(typeof r.driver_name).toBe('string');
    expect(r.driver_name.length).toBeGreaterThan(0);
    expect(typeof r.chat_id).toBe('string');
    expect(['ru', 'en', 'pl']).toContain(r.lang);
  });

  it('honours overrides', () => {
    const r = makeDriverTelegramChat({ driver_name: 'Timur', chat_id: '99999', lang: 'en' });
    expect(r.driver_name).toBe('Timur');
    expect(r.chat_id).toBe('99999');
    expect(r.lang).toBe('en');
  });

  it('allows chat_id to be null (pre-registration lang set by Owner)', () => {
    const r = makeDriverTelegramChat({ chat_id: null });
    expect(r.chat_id).toBeNull();
  });
});
