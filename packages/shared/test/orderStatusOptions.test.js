import { describe, it, expect } from 'vitest';
import { getStatusOptions, ALL_ORDER_STATUSES } from '../utils/orderStatusOptions.js';

describe('getStatusOptions', () => {
  describe('owner (any → any)', () => {
    it('offers every other status as forward, no revert set', () => {
      const { forward, revert, all } = getStatusOptions({
        role: 'owner',
        currentStatus: 'Delivered',
        previousStatuses: ['New', 'Ready'],
      });
      expect(forward).toEqual(ALL_ORDER_STATUSES.filter(s => s !== 'Delivered'));
      expect(forward).toContain('Ready');
      expect(forward).toContain('New');
      expect(revert).toEqual([]);
      expect(all).not.toContain('Delivered'); // never offers current
    });

    it('owner can move from any terminal state', () => {
      const { all } = getStatusOptions({ role: 'owner', currentStatus: 'Cancelled' });
      expect(all).toContain('New');
      expect(all).toContain('Delivered');
    });
  });

  describe('florist forward path (unchanged happy path)', () => {
    it('New → Ready / Cancelled', () => {
      const { forward, revert } = getStatusOptions({ role: 'florist', currentStatus: 'New' });
      expect(forward).toEqual(['Ready', 'Cancelled']);
      expect(revert).toEqual([]);
    });

    it('Ready → Delivered / Picked Up / Cancelled (no Out for Delivery — driver job)', () => {
      const { forward } = getStatusOptions({ role: 'florist', currentStatus: 'Ready' });
      expect(forward).toEqual(['Delivered', 'Picked Up', 'Cancelled']);
      expect(forward).not.toContain('Out for Delivery');
    });
  });

  describe('florist revert (history-driven undo)', () => {
    it('Delivered with no history → no forward, no revert (still stuck without history)', () => {
      const { forward, revert, all } = getStatusOptions({
        role: 'florist',
        currentStatus: 'Delivered',
      });
      expect(forward).toEqual([]);
      expect(revert).toEqual([]);
      expect(all).toEqual([]);
    });

    it('Delivered → revert only to genuinely-held prior states', () => {
      const { forward, revert, all } = getStatusOptions({
        role: 'florist',
        currentStatus: 'Delivered',
        previousStatuses: ['New', 'Ready'],
      });
      expect(forward).toEqual([]); // Delivered is forward-terminal
      expect(revert).toEqual(['New', 'Ready']);
      expect(all).toEqual(['New', 'Ready']);
    });

    it('excludes the current status and de-dupes against the forward set', () => {
      // Ready: forward already includes Cancelled; history also lists Cancelled +
      // New + Ready(self). Revert should only add New.
      const { forward, revert } = getStatusOptions({
        role: 'florist',
        currentStatus: 'Ready',
        previousStatuses: ['Ready', 'New', 'Cancelled'],
      });
      expect(forward).toContain('Cancelled');
      expect(revert).toEqual(['New']);
      expect(revert).not.toContain('Ready');      // never offers current
      expect(revert).not.toContain('Cancelled');  // already in forward
    });

    it('Picked Up → revert to Ready when it was held', () => {
      const { revert } = getStatusOptions({
        role: 'florist',
        currentStatus: 'Picked Up',
        previousStatuses: ['New', 'Ready'],
      });
      expect(revert).toEqual(['New', 'Ready']);
    });

    it('does not invent a never-held status (skipped Out for Delivery stays out)', () => {
      const { all } = getStatusOptions({
        role: 'florist',
        currentStatus: 'Delivered',
        previousStatuses: ['New', 'Ready'], // OOD never held
      });
      expect(all).not.toContain('Out for Delivery');
    });
  });
});
