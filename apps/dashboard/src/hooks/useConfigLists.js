// useConfigLists — single source of truth for all dynamic config lists.
// Fetches suppliers, categories, payment methods, order sources, and time slots
// from backend settings. Falls back to hardcoded defaults if API fails.
// Module-level cache ensures only 1 API call per session.

import { useState, useEffect } from 'react';
import client from '../api/client.js';

const DEFAULTS = {
  suppliers:      ['4f', 'Mateusz', 'Other', 'Stefan', 'Stojek'],
  categories:     ['Accessories', 'Greenery', 'Other', 'Roses', 'Seasonal', 'Tulips'],
  paymentMethods: ['Cash', 'Card', 'Mbank', 'Monobank', 'Revolut', 'PayPal', 'Wix Online'],
  orderSources:   ['In-store', 'Instagram', 'WhatsApp', 'Telegram', 'Wix', 'Flowwow', 'Other'],
  timeSlots:      ['10:00-12:00', '12:00-14:00', '14:00-16:00', '16:00-18:00'],
  floristNames:   ['Anya', 'Daria'],
  targetMarkup:   2.2,
};

let cached = null;

export default function useConfigLists() {
  const [lists, setLists] = useState(cached || DEFAULTS);

  useEffect(() => {
    if (cached) return;
    Promise.all([
      client.get('/settings/lists').catch(() => ({ data: {} })),
      client.get('/settings').catch(() => ({ data: {} })),
    ]).then(([listsRes, settingsRes]) => {
      const merged = {
        ...DEFAULTS,
        ...listsRes.data,
        timeSlots: settingsRes.data.config?.deliveryTimeSlots || DEFAULTS.timeSlots,
        floristNames: listsRes.data.floristNames || DEFAULTS.floristNames,
        targetMarkup: settingsRes.data.config?.targetMarkup || DEFAULTS.targetMarkup,
        slotLeadTimeMinutes: settingsRes.data.config?.slotLeadTimeMinutes || 30,
      };
      if (merged.categories) merged.categories = [...merged.categories].sort((a, b) => a.localeCompare(b));
      if (merged.suppliers) merged.suppliers = [...merged.suppliers].sort((a, b) => a.localeCompare(b));
      // Time slots sorted by start time so the picker renders chronologically
      // regardless of the order they were added in Airtable settings.
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
