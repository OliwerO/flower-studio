// Smart time slot filtering — disables slots that are too close to current time.

/**
 * Returns slot objects with availability status.
 * @param {string[]} allSlots - e.g. ['10:00-12:00', '14:00-16:00']
 * @param {string}   selectedDate - YYYY-MM-DD
 * @param {number}   leadMinutes - buffer before slot start (default 30)
 * @returns {{ slot: string, available: boolean }[]}
 */
export function getAvailableSlots(allSlots, selectedDate, leadMinutes = 30) {
  if (!allSlots || allSlots.length === 0) return [];

  // Sort slots in ascending order by start time
  const sorted = [...allSlots].sort((a, b) => {
    const [ah, am] = a.split('-')[0].split(':').map(Number);
    const [bh, bm] = b.split('-')[0].split(':').map(Number);
    return (ah * 60 + am) - (bh * 60 + bm);
  });

  const today = new Date().toISOString().split('T')[0];
  const isToday = selectedDate === today;

  if (!isToday) {
    return sorted.map(slot => ({ slot, available: true }));
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + leadMinutes;

  return sorted.map(slot => {
    const startTime = slot.split('-')[0]; // "14:00" from "14:00-16:00"
    const [h, m] = startTime.split(':').map(Number);
    const slotMinutes = h * 60 + m;
    return { slot, available: slotMinutes > nowMinutes };
  });
}

/**
 * Splits a client delivery window ("HH:MM-HH:MM") into the 1-hour courier slots
 * that fit inside it. The client picks a wide window (e.g. 10:00-12:00); the
 * courier is then assigned one of these tighter 1h slots. A trailing partial
 * slot is emitted when the window isn't a whole number of hours, so no part of
 * the window is unreachable.
 * @param {string} clientWindow - e.g. "10:00-12:00"
 * @returns {string[]} e.g. ["10:00-11:00", "11:00-12:00"]; [] for invalid input
 */
export function getCourierSlots(clientWindow) {
  if (typeof clientWindow !== 'string') return [];
  const parts = clientWindow.split('-');
  if (parts.length !== 2) return [];

  const toMinutes = hm => {
    const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(hm);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };

  const start = toMinutes(parts[0]);
  const end = toMinutes(parts[1]);
  if (start == null || end == null || end <= start) return [];

  const fmt = total => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

  const slots = [];
  for (let cursor = start; cursor < end; ) {
    const next = Math.min(cursor + 60, end);
    slots.push(`${fmt(cursor)}-${fmt(next)}`);
    cursor = next;
  }
  return slots;
}
