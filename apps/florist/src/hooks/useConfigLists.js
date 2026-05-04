// useConfigLists — single source of truth for all dynamic config lists.
// Fetches suppliers, categories, payment methods, order sources, and time slots
// from backend settings. Falls back to hardcoded defaults if API fails.
// Module-level cache ensures only 1 API call per session, no matter how many
// components use the hook — like a shared parts catalog for the whole factory floor.

import { useState, useEffect } from 'react';
import { cachedGet } from '../api/client.js';

const DEFAULTS = {
  suppliers:      ['4f', 'Mateusz', 'Other', 'Stefan', 'Stojek'],
  categories:     ['Accessories', 'Greenery', 'Other', 'Roses', 'Seasonal', 'Tulips'],
  paymentMethods: ['Cash', 'Card', 'Mbank', 'Monobank', 'Revolut', 'PayPal', 'Wix Online'],
  orderSources:   ['In-store', 'Instagram', 'WhatsApp', 'Telegram', 'Wix', 'Flowwow', 'Other'],
  timeSlots:      ['10:00-12:00', '12:00-14:00', '14:00-16:00', '16:00-18:00'],
  drivers:        [],
  targetMarkup:   2.2,
  floristNames:   ['Anya', 'Daria'],
  rateTypes:      ['Standard', 'Wedding', 'Holidays'],
  floristRates:   {},
};

let cached = null;

export default function useConfigLists() {
  const [lists, setLists] = useState(cached || DEFAULTS);

  useEffect(() => {
    if (cached) return;
    // Fetch both endpoints in parallel — lists + config (for time slots)
    Promise.all([
      cachedGet('/settings/lists').catch(() => ({ data: {} })),
      cachedGet('/settings').catch(() => ({ data: {} })),
    ]).then(([listsRes, settingsRes]) => {
      const merged = {
        ...DEFAULTS,
        ...listsRes.data,
        timeSlots: settingsRes.data.config?.deliveryTimeSlots || DEFAULTS.timeSlots,
        drivers: settingsRes.data.drivers || DEFAULTS.drivers,
        targetMarkup: settingsRes.data.config?.targetMarkup || DEFAULTS.targetMarkup,
        floristNames: listsRes.data.floristNames || DEFAULTS.floristNames,
        rateTypes: listsRes.data.rateTypes || DEFAULTS.rateTypes,
        floristRates: listsRes.data.floristRates || DEFAULTS.floristRates,
        slotLeadTimeMinutes: settingsRes.data.config?.slotLeadTimeMinutes || 30,
      };
      if (merged.categories) merged.categories = [...merged.categories].sort((a, b) => a.localeCompare(b));
      if (merged.suppliers) merged.suppliers = [...merged.suppliers].sort((a, b) => a.localeCompare(b));
      // Time slots must sort by start time, not lexicographically — "08:00-10:00"
      // still sorts right as plain string, but explicit parse is safer if a slot
      // like "9:00-11:00" (no leading zero) is ever entered.
      if (merged.timeSlots) {
        merged.timeSlots = [...merged.timeSlots].sort((a, b) => {
          const [ah, am] = (a.split('-')[0] || '').split(':').map(Number);
          const [bh, bm] = (b.split('-')[0] || '').split(':').map(Number);
          return (ah * 60 + (am || 0)) - (bh * 60 + (bm || 0));
        });
      }
      cached = merged;
      setLists(cached);
    });
  }, []);

  return lists;
}
