// Tests for the HTTP→audit-primitive bridge. Lives separately from
// audit.test.js because actor.js is the only place that knows about
// Express requests; keeping the boundary explicit in the test layout
// mirrors the boundary in the source.

import { describe, it, expect } from 'vitest';
import { actorFromReq } from '../utils/actor.js';

describe('actorFromReq', () => {
  it('returns the driver name as actorPinLabel for driver requests', () => {
    expect(actorFromReq({ role: 'driver', driverName: 'Timur' }))
      .toEqual({ actorRole: 'driver', actorPinLabel: 'Timur' });
  });

  it('keeps actorPinLabel null for owner / florist (no per-user identity beyond role)', () => {
    expect(actorFromReq({ role: 'owner' }))
      .toEqual({ actorRole: 'owner', actorPinLabel: null });
    expect(actorFromReq({ role: 'florist' }))
      .toEqual({ actorRole: 'florist', actorPinLabel: null });
  });

  it('falls back to system actor when req is undefined (webhooks, scheduled jobs)', () => {
    expect(actorFromReq()).toEqual({ actorRole: 'system', actorPinLabel: null });
    expect(actorFromReq(null)).toEqual({ actorRole: 'system', actorPinLabel: null });
  });

  it('falls back to system when role is missing on req', () => {
    expect(actorFromReq({})).toEqual({ actorRole: 'system', actorPinLabel: null });
  });

  it('handles driver req with no driverName by leaving actorPinLabel null', () => {
    expect(actorFromReq({ role: 'driver' }))
      .toEqual({ actorRole: 'driver', actorPinLabel: null });
  });
});
