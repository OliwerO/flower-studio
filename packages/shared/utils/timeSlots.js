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
