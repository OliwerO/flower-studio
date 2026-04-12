import { useState } from 'react';
import t from '../../translations.js';

export default function SyncLogSection({ logs }) {
  const [expanded, setExpanded] = useState(false);

  if (!logs || logs.length === 0) return null;

  return (
    <div className="mt-6 border-t border-gray-100 pt-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <span>{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="font-medium">{t.prodSyncLog}</span>
        <span className="text-xs text-gray-400">({logs.length})</span>
      </button>

      {expanded && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-100">
                <th className="text-left py-1.5 pr-3">{t.date}</th>
                <th className="text-left py-1.5 px-3">{t.status}</th>
                <th className="text-right py-1.5 px-2">{t.prodNewProducts}</th>
                <th className="text-right py-1.5 px-2">{t.prodUpdated}</th>
                <th className="text-right py-1.5 px-2">{t.prodDeactivated}</th>
                <th className="text-right py-1.5 px-2">{t.prodPriceSyncs}</th>
                <th className="text-right py-1.5 px-2">{t.prodStockSyncs}</th>
                <th className="text-left py-1.5 pl-3">{t.prodErrors}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const ts = new Date(log['Timestamp']);
                const status = log['Status'] || '';
                const ok = status.includes('success');
                const partial = status.includes('partial');
                const errMsg = log['Error Message'];
                return (
                  <tr key={log.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap">
                      {ts.toLocaleDateString()} {ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-1.5 px-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${ok ? 'bg-green-50 text-green-700' : partial ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
                        {ok ? '\u2713' : partial ? '\u26A0' : '\u2717'} {log['Status']}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right text-gray-700">{log['New Products'] || 0}</td>
                    <td className="py-1.5 px-2 text-right text-gray-700">{log['Updated'] || 0}</td>
                    <td className="py-1.5 px-2 text-right text-gray-700">{log['Deactivated'] || 0}</td>
                    <td className="py-1.5 px-2 text-right text-gray-700">{log['Price Syncs'] || 0}</td>
                    <td className="py-1.5 px-2 text-right text-gray-700">{log['Stock Syncs'] || 0}</td>
                    <td className="py-1.5 pl-3 text-red-500 max-w-[200px] truncate" title={errMsg || ''}>{errMsg || '\u2014'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
