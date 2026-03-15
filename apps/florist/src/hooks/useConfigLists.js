// useConfigLists — single source of truth for all dynamic config lists.
// Fetches suppliers, categories, payment methods, order sources, and time slots
// from backend settings. Falls back to hardcoded defaults if API fails.
// Module-level cache ensures only 1 API call per session, no matter how many
// components use the hook — like a shared parts catalog for the whole factory floor.

import { useState, useEffect } from 'react';
import client from '../api/client.js';

const DEFAULTS = {
  suppliers:      ['Stojek', '4f', 'Stefan', 'Mateusz', 'Other'],
  categories:     ['Roses', 'Tulips', 'Seasonal', 'Greenery', 'Accessories', 'Other'],
  paymentMethods: ['Cash', 'Card', 'Mbank', 'Monobank', 'Revolut', 'PayPal', 'Wix Online'],
  orderSources:   ['In-store', 'Instagram', 'WhatsApp', 'Telegram', 'Wix', 'Flowwow', 'Other'],
  timeSlots:      ['10:00-12:00', '12:00-14:00', '14:00-16:00', '16:00-18:00'],
  drivers:        [],
  targetMarkup:   2.2,
};

let cached = null;

export default function useConfigLists() {
  const [lists, setLists] = useState(cached || DEFAULTS);

  useEffect(() => {
    if (cached) return;
    // Fetch both endpoints in parallel — lists + config (for time slots)
    Promise.all([
      client.get('/settings/lists').catch(() => ({ data: {} })),
      client.get('/settings').catch(() => ({ data: {} })),
    ]).then(([listsRes, settingsRes]) => {
      cached = {
        ...DEFAULTS,
        ...listsRes.data,
        timeSlots: settingsRes.data.config?.deliveryTimeSlots || DEFAULTS.timeSlots,
        drivers: settingsRes.data.drivers || DEFAULTS.drivers,
        targetMarkup: settingsRes.data.config?.targetMarkup || DEFAULTS.targetMarkup,
      };
      setLists(cached);
    });
  }, []);

  return lists;
}
