// useNotifications — SSE listener for the dashboard.
// Same concept as the florist hook — listens for new order events.

import { useEffect, useRef } from 'react';
import { useToast } from '../context/ToastContext.jsx';

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
 */
export function useNotifications(onNewOrder) {
  const { showToast } = useToast();
  const onNewOrderRef = useRef(onNewOrder);
  onNewOrderRef.current = onNewOrder;

  useEffect(() => {
    const source = new EventSource('/api/events');

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
