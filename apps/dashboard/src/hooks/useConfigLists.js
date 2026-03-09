// useConfigLists — fetches dynamic supplier/category/payment/source lists from backend settings.
// Falls back to hardcoded defaults if the API call fails (resilient to network issues).

import { useState, useEffect } from 'react';
import client from '../api/client.js';

const DEFAULTS = {
  suppliers:      ['Stojek', '4f', 'Stefan', 'Mateusz', 'Other'],
  categories:     ['Roses', 'Tulips', 'Seasonal', 'Greenery', 'Accessories', 'Other'],
  paymentMethods: ['Cash', 'Card', 'Mbank', 'Monobank', 'Revolut', 'PayPal', 'Wix Online'],
  orderSources:   ['In-store', 'Instagram', 'WhatsApp', 'Telegram', 'Wix', 'Flowwow', 'Other'],
};

let cached = null;

export default function useConfigLists() {
  const [lists, setLists] = useState(cached || DEFAULTS);

  useEffect(() => {
    if (cached) return;
    client.get('/settings/lists')
      .then(r => {
        cached = r.data;
        setLists(r.data);
      })
      .catch(() => { /* use defaults */ });
  }, []);

  return lists;
}
