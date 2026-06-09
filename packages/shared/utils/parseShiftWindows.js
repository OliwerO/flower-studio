// parseShiftWindows — recover a florist's worked time windows from an hours entry.
//
// When a florist logs hours (apps/florist FloristHoursForm), the FROM→TO windows
// they enter are persisted as the FIRST segment of the entry's Notes string and
// the total Hours is derived from them at log time, e.g.
//     "10:30-15:30, 16:30-18:30 | covered for Anya"
// The windows themselves were never displayed back — the owner only saw the total.
// This util extracts them so the owner can see WHEN someone worked on a given day,
// not just the absolute hours.

// A single "HH:MM-HH:MM" window (whitespace around the dash tolerated).
const WINDOW_RE = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/;

// Parse an hours-entry Notes string into { windows: [{ from, to }], note }.
// The leading "|"-segment is treated as windows only when EVERY comma-separated
// token in it is a valid window — otherwise the whole string is returned as note
// (covers manually-entered notes that never had windows). The note keeps any
// pipes beyond the first segment.
export function parseShiftWindows(notes) {
  const raw = (notes || '').trim();
  if (!raw) return { windows: [], note: '' };

  const segments = raw.split('|').map((s) => s.trim());
  const tokens = segments[0].split(',').map((s) => s.trim()).filter(Boolean);

  const matches = tokens.map((tok) => tok.match(WINDOW_RE));
  const allWindows = matches.length > 0 && matches.every(Boolean);

  if (!allWindows) return { windows: [], note: raw };

  const windows = matches.map((m) => ({ from: m[1], to: m[2] }));
  return { windows, note: segments.slice(1).join(' | ').trim() };
}

// Format parsed windows for display: "10:30–15:30, 16:30–18:30" (en-dash). Empty → ''.
export function formatShiftWindows(windows) {
  return (windows || []).map((w) => `${w.from}–${w.to}`).join(', ');
}

// Convenience: a raw Notes string → its display window label (or '' when none).
export function shiftWindowsLabel(notes) {
  return formatShiftWindows(parseShiftWindows(notes).windows);
}
