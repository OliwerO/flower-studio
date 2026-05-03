// useNotifications — SSE listener for real-time order alerts.
// Like a radio receiver on the factory floor: stays tuned to the backend's
// event stream and triggers an alert when a new Wix order arrives.

import { useEffect, useRef } from 'react';
import { useToast } from '../context/ToastContext.jsx';
import { getClientPin } from '../api/client.js';
import t from '../translations.js';

// Simple notification sound — short chime using Web Audio API
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880; // A5 note
    osc.type = 'sine';
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // Audio not available — silent fallback
  }
}

/**
 * Hook that listens for SSE events from the backend.
 * Shows a toast notification + plays a sound when a new order arrives.
 *
 * @param {function} onNewOrder — optional callback when new order event received
 * @param {function} onEvent    — optional callback fired for EVERY event
 *                                (used by pages that need to react to types
 *                                beyond `new_order`, e.g. BouquetsPage
 *                                listening for `product_image_changed`).
 */
export function useNotifications(onNewOrder, onEvent) {
  const { showToast } = useToast();
  const onNewOrderRef = useRef(onNewOrder);
  onNewOrderRef.current = onNewOrder;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    // EventSource connects directly to Railway backend, bypassing Vercel's proxy.
    // Vercel rewrites work for REST calls but buffer/timeout SSE streams.
    // Like running a dedicated radio link instead of routing through the switchboard.
    const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
    const pin = getClientPin();
    const source = new EventSource(`${backendUrl}/api/events${pin ? `?pin=${pin}` : ''}`);

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'new_order') {
          const msg = `🌸 ${t.newOrder}: ${data.customerName || ''} (${data.source || ''})`;
          showToast(msg, 'success');
          playNotificationSound();

          // Call optional callback (e.g., to refresh order list)
          if (onNewOrderRef.current) {
            onNewOrderRef.current(data);
          }
        }

        if (data.type === 'stock_evaluation_ready') {
          showToast(`📦 ${t.stockEvalBanner}`, 'success');
          playNotificationSound();
        }

        if (data.type === 'substitute_reconciliation_needed') {
          const count = data.affectedOrders?.length || 0;
          showToast(`⚠ ${count} ${t.ordersNeedSwap}`, 'warning');
          playNotificationSound();
        }

        // Premade bouquet lifecycle events — silent-ish, no sound, but toast
        // the name so everyone knows inventory changed.
        if (data.type === 'premade_bouquet_created') {
          showToast(`💐 ${t.premadeBouquet}: ${data.name || ''}`, 'success');
        }
        if (data.type === 'premade_bouquet_matched') {
          showToast(`💐 ${t.premadeMatched}`, 'success');
        }
        if (data.type === 'premade_bouquet_returned') {
          showToast(`💐 ${t.premadeReturned}`, 'success');
        }

        // Generic per-event escape hatch — pages that subscribe via the
        // second arg get every event regardless of type. Used by
        // BouquetsPage to patch local state on `product_image_changed`.
        if (onEventRef.current) {
          onEventRef.current(data);
        }
      } catch {
        // Ignore parse errors (heartbeats, malformed events)
      }
    };

    source.onerror = () => {
      // EventSource will auto-reconnect after a brief delay.
      // No manual intervention needed — the browser handles it.
      console.warn('[SSE] Connection lost — will auto-reconnect');
    };

    return () => {
      source.close();
    };
  }, [showToast]);
}
