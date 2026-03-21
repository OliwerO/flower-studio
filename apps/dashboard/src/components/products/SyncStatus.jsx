import t from '../../translations.js';

export default function SyncStatus({ logs }) {
  const lastPull = logs.find(l => l['Status']?.includes('pull'));
  const lastPush = logs.find(l => l['Status']?.includes('push'));
  const latest = logs[0];

  function formatAgo(log) {
    if (!log) return null;
    const ago = Math.round((Date.now() - new Date(log['Timestamp']).getTime()) / 60000);
    const failed = log['Status']?.includes('failed');
    let color = 'text-green-600';
    if (failed) color = 'text-red-500';
    else if (ago > 360) color = 'text-red-500';
    else if (ago > 60) color = 'text-amber-500';
    const timeStr = ago < 60 ? `${ago}m` : `${Math.round(ago / 60)}h`;
    return { color, timeStr, failed };
  }

  const pull = formatAgo(lastPull);
  const push = formatAgo(lastPush);

  if (!pull && !push && latest) {
    const f = formatAgo(latest);
    return <span className={`text-xs ${f.color}`}>{f.failed ? '\u2717' : '\u2713'} {t.prodLastSync}: {f.timeStr} {t.prodAgo}</span>;
  }

  return (
    <span className="text-xs text-gray-500 flex gap-3">
      {pull && <span className={pull.color}>{pull.failed ? '\u2717' : '\u2193'} Pull: {pull.timeStr} {t.prodAgo}</span>}
      {push && <span className={push.color}>{push.failed ? '\u2717' : '\u2191'} Push: {push.timeStr} {t.prodAgo}</span>}
    </span>
  );
}
