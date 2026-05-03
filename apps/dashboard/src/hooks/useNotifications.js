// useNotifications — SSE listener for the dashboard.
// Same concept as the florist hook — listens for new order events.

import { useEffect, useRef } from 'react';
import { useToast } from '../context/ToastContext.jsx';
import { getClientPin } from '../api/client.js';

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // Audio not available
  }
}

/**
 * @param {function} onNewOrder — optional callback for new order events
 * @param {function} onEvent    — optional callback fired for EVERY event
 *                                (used by tabs that need to react to types
 *                                beyond `new_order`, e.g. ProductsTab
 *                                listening for `product_image_changed`).
 */
export function useNotifications(onNewOrder, onEvent) {
  const { showToast } = useToast();
  const onNewOrderRef = useRef(onNewOrder);
  onNewOrderRef.current = onNewOrder;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    // Connect directly to Railway backend for SSE (Vercel proxy buffers streams)
    const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
    const pin = getClientPin();
    const source = new EventSource(`${backendUrl}/api/events${pin ? `?pin=${pin}` : ''}`);

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'new_order') {
          const msg = `🌸 New ${data.source || ''} order: ${data.customerName || 'Customer'}`;
          showToast(msg, 'success');
          playNotificationSound();

          if (onNewOrderRef.current) {
            onNewOrderRef.current(data);
          }
        }

        // Generic per-event escape hatch — tabs that subscribe via the
        // second arg get every event regardless of type. Used by
        // ProductsTab to patch local state on `product_image_changed`.
        if (onEventRef.current) {
          onEventRef.current(data);
        }
      } catch {
        // Ignore
      }
    };

    source.onerror = () => {
      console.warn('[SSE] Connection lost — will auto-reconnect');
    };

    return () => source.close();
  }, [showToast]);
}
