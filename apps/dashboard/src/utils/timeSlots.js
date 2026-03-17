// Smart time slot filtering — disables slots that are too close to current time.
// Like a production scheduling rule: you can't start a batch run if the
// shift is about to end — there's a minimum lead time buffer.

/**
 * Returns slot objects with availability status.
 * @param {string[]} allSlots - e.g. ['10:00-12:00', '14:00-16:00']
 * @param {string}   selectedDate - YYYY-MM-DD
 * @param {number}   leadMinutes - buffer before slot start (default 30)
 * @returns {{ slot: string, available: boolean }[]}
 */
export function getAvailableSlots(allSlots, selectedDate, leadMinutes = 30) {
  if (!allSlots || allSlots.length === 0) return [];

  const today = new Date().toISOString().split('T')[0];
  const isToday = selectedDate === today;

  if (!isToday) {
    return allSlots.map(slot => ({ slot, available: true }));
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + leadMinutes;

  return allSlots.map(slot => {
    const startTime = slot.split('-')[0]; // "14:00" from "14:00-16:00"
    const [h, m] = startTime.split(':').map(Number);
    const slotMinutes = h * 60 + m;
    return { slot, available: slotMinutes > nowMinutes };
  });
}
