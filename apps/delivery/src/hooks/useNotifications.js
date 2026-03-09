// useNotifications — SSE listener for the delivery app.
// Drivers get notified when a new order is created (incoming work)
// and when an order is marked "Ready" (time to pick up from studio).

import { useEffect, useRef } from 'react';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';

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
 * @param {function} onEvent — optional callback for any notification event
 */
export function useNotifications(enabled = true, onEvent) {
  const { showToast } = useToast();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
    const source = new EventSource(`${backendUrl}/api/events`);

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'new_order') {
          showToast(`📦 ${t.newOrderAlert}`, 'success');
          playNotificationSound();
        }

        if (data.type === 'order_ready') {
          showToast(`✅ ${t.orderReadyAlert}`, 'success');
          playNotificationSound();
        }

        if (onEventRef.current) {
          onEventRef.current(data);
        }
      } catch {
        // Ignore parse errors
      }
    };

    source.onerror = () => {
      console.warn('[SSE] Connection lost — will auto-reconnect');
    };

    return () => source.close();
  }, [showToast, enabled]);
}
