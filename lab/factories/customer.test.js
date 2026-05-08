import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { makeCustomer } from './customer.js';

describe('makeCustomer', () => {
  beforeEach(() => faker.seed(42));

  it('returns a row matching the customers schema with realistic data', () => {
    const c = makeCustomer();
    expect(c.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);    // uuid
    expect(typeof c.name).toBe('string');
    expect(c.name.length).toBeGreaterThan(0);
    expect(typeof c.phone).toBe('string');
    expect(c.phone).toMatch(/^\+/);                         // E.164-ish
    expect(c.created_at).toBeInstanceOf(Date);
    expect(c.deleted_at).toBeNull();
  });

  it('is deterministic under the same faker seed', () => {
    faker.seed(42);
    const a = makeCustomer();
    faker.seed(42);
    const b = makeCustomer();
    expect(a).toEqual(b);
  });

  it('honours overrides', () => {
    const c = makeCustomer({ name: 'Maria Schmidt', phone: '+48123456789' });
    expect(c.name).toBe('Maria Schmidt');
    expect(c.phone).toBe('+48123456789');
  });
});
