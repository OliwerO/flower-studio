// AdminTab — owner-only raw-data view backed by Postgres.
// Phase 2.5 scope: read-only audit-log viewer. Per-entity raw-edit
// panels arrive in Phase 3+ as entities migrate to PG (each new entity
// is registered in components/admin/entityRegistry.js).
//
// Why this tab exists: when something looks wrong in the regular UI, the
// owner needs a way to see the underlying row + its history without
// dropping into psql. The audit log is the ground truth — every PG-side
// write lands there in the same transaction as the entity write.

import { Fragment, useEffect, useState } from 'react';
import api from '../api/client.js';
import t from '../translations.js';
import { listEntities } from './admin/entityRegistry.js';

function formatDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function ActionPill({ action }) {
  const colors = {
    create:  'bg-green-100 text-green-700',
    update:  'bg-blue-100 text-blue-700',
    delete:  'bg-red-100 text-red-700',
    restore: 'bg-amber-100 text-amber-700',
    purge:   'bg-gray-200 text-gray-700',
  };
  const cls = colors[action] || 'bg-gray-100 text-gray-700';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {action}
    </span>
  );
}

export default function AdminTab() {
  const [rows, setRows]           = useState([]);
  const [stats, setStats]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [postgresUp, setPostgresUp] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  const entities = listEntities();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const [auditRes, statsRes] = await Promise.all([
          api.get('/admin/audit?limit=100'),
          api.get('/admin/audit/stats'),
        ]);
        if (cancelled) return;
        setRows(auditRes.data);
        setStats(statsRes.data);
        setError(null);
        setPostgresUp(true);
      } catch (err) {
        if (cancelled) return;
        if (err.response?.status === 503) {
          setPostgresUp(false);
        } else {
          setError(err.response?.data?.error || t.error);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (!postgresUp) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 max-w-2xl">
        <h2 className="text-lg font-semibold text-amber-900 mb-2">{t.adminPgMissingTitle}</h2>
        <p className="text-sm text-amber-800">{t.adminPgMissingBody}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h2 className="text-xl font-bold">{t.adminTitle}</h2>
        <div className="text-sm text-ios-secondary">
          {stats && <span>{t.adminTotalEvents}: <b>{stats.total}</b></span>}
        </div>
      </header>

      <section className="bg-white border border-ios-border rounded-xl p-4">
        <h3 className="font-semibold mb-2">{t.adminEntitiesTitle}</h3>
        {entities.length === 0 ? (
          <p className="text-sm text-ios-secondary">{t.adminNoEntitiesYet}</p>
        ) : (
          <ul className="text-sm space-y-1">
            {entities.map(e => (
              <li key={e.key} className="text-ios-label">{e.labelEn} <span className="text-ios-tertiary">({e.key})</span></li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white border border-ios-border rounded-xl overflow-hidden">
        <header className="px-4 py-3 border-b border-ios-border flex items-center justify-between">
          <h3 className="font-semibold">{t.adminAuditLogTitle}</h3>
          <span className="text-xs text-ios-tertiary">{t.adminAuditLogHint}</span>
        </header>

        {loading && <div className="p-6 text-sm text-ios-secondary">{t.loading}</div>}
        {error   && <div className="p-6 text-sm text-red-600">{error}</div>}

        {!loading && !error && rows.length === 0 && (
          <div className="p-6 text-sm text-ios-secondary">{t.adminAuditLogEmpty}</div>
        )}

        {!loading && !error && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-ios-secondary uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">{t.adminColTime}</th>
                <th className="text-left px-3 py-2">{t.adminColEntity}</th>
                <th className="text-left px-3 py-2">{t.adminColAction}</th>
                <th className="text-left px-3 py-2">{t.adminColActor}</th>
                <th className="text-left px-3 py-2">{t.adminColEntityId}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const idStr = String(row.id);
                const expanded = expandedId === idStr;
                return (
                  <Fragment key={idStr}>
                    <tr
                      className="border-t border-ios-border hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandedId(expanded ? null : idStr)}
                    >
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-ios-secondary">
                        {formatDate(row.createdAt)}
                      </td>
                      <td className="px-3 py-2 font-medium">{row.entityType}</td>
                      <td className="px-3 py-2"><ActionPill action={row.action} /></td>
                      <td className="px-3 py-2 text-ios-secondary">
                        {row.actorRole}{row.actorPinLabel ? ` / ${row.actorPinLabel}` : ''}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-ios-tertiary">{row.entityId}</td>
                    </tr>
                    {expanded && (
                      <tr className="bg-gray-50 border-t border-ios-border">
                        <td colSpan={5} className="px-3 py-2">
                          <pre className="text-xs whitespace-pre-wrap break-all text-ios-label">
                            {JSON.stringify(row.diff, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
