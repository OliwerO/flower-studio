// Split "Rose Red (14.Mar.)" into { name: "Rose Red", batch: "14.Mar." }
export default function parseBatchName(displayName) {
  const m = (displayName || '').match(/^(.+?)\s*\((\d{1,2}\.\w{3,4}\.?)\)$/);
  return m ? { name: m[1], batch: m[2] } : { name: displayName, batch: null };
}
