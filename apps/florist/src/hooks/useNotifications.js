// useNotifications — SSE listener for real-time order alerts.
// Like a radio receiver on the factory floor: stays tuned to the backend's
// event stream and triggers an alert when a new Wix order arrives.

import { useEffect, useRef } from 'react';
import { useToast } from '../context/ToastContext.jsx';

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
 */
export function useNotifications(onNewOrder) {
  const { showToast } = useToast();
  const onNewOrderRef = useRef(onNewOrder);
  onNewOrderRef.current = onNewOrder;

  useEffect(() => {
    // EventSource auto-reconnects on disconnect — built into the browser API
    const source = new EventSource('/api/events');

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'new_order') {
          const msg = `🌸 New ${data.source || ''} order: ${data.customerName || 'Customer'}`;
          showToast(msg, 'success');
          playNotificationSound();

          // Call optional callback (e.g., to refresh order list)
          if (onNewOrderRef.current) {
            onNewOrderRef.current(data);
          }
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
