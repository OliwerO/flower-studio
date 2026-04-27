// AdminTab — owner-only raw-data view backed by Postgres.
//
// Phase 2.5 shipped the audit-log viewer. Phase 3 adds:
//   • Stock backend mode banner (airtable / shadow / postgres) so the
//     owner can see the cutover state at a glance.
//   • Stock raw-data table (top 50 by updated_at) — proves the PG row
//     mirrors what's in Airtable during shadow.
//   • Parity dashboard — counts by mismatch kind plus a Recheck button
//     that triggers a full diff (slow; for quiet hours).
//
// Why this tab exists: when something looks wrong in the regular UI, the
// owner needs a way to see the underlying row + its history without
// dropping into psql. The audit log is the ground truth; parity_log
// proves shadow-write is safe to flip.

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

function ModeBadge({ mode }) {
  const cfg = {
    airtable: { color: 'bg-gray-100 text-gray-700',   label: t.adminBackendModeAirtable },
    shadow:   { color: 'bg-amber-100 text-amber-800', label: t.adminBackendModeShadow   },
    postgres: { color: 'bg-green-100 text-green-700', label: t.adminBackendModePostgres },
  };
  const c = cfg[mode] || cfg.airtable;
  return (
    <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${c.color}`}>
      {c.label}
    </div>
  );
}

export default function AdminTab() {
  const [rows, setRows]                 = useState([]);
  const [stats, setStats]               = useState(null);
  const [status, setStatus]             = useState(null);
  const [stockRows, setStockRows]       = useState([]);
  const [parity, setParity]             = useState({ rows: [], countsByKind: {} });
  const [parityRunning, setParityRunning] = useState(false);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [postgresUp, setPostgresUp]     = useState(true);
  const [expandedId, setExpandedId]     = useState(null);

  const entities = listEntities();
  const stockMode = status?.backends?.stock || 'airtable';

  async function loadAll() {
    try {
      setLoading(true);
      const [auditRes, statsRes, statusRes, stockRes, parityRes] = await Promise.all([
        api.get('/admin/audit?limit=100'),
        api.get('/admin/audit/stats'),
        api.get('/admin/status'),
        api.get('/admin/stock?limit=50').catch(() => ({ data: [] })),
        api.get('/admin/parity/stock').catch(() => ({ data: { rows: [], countsByKind: {} } })),
      ]);
      setRows(auditRes.data);
      setStats(statsRes.data);
      setStatus(statusRes.data);
      setStockRows(stockRes.data);
      setParity(parityRes.data);
      setError(null);
      setPostgresUp(true);
    } catch (err) {
      if (err.response?.status === 503) {
        setPostgresUp(false);
      } else {
        setError(err.response?.data?.error || t.error);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function runParityRecheck() {
    setParityRunning(true);
    try {
      await api.post('/admin/parity/stock/recheck');
      const fresh = await api.get('/admin/parity/stock');
      setParity(fresh.data);
    } catch (err) {
      setError(err.response?.data?.error || t.error);
    } finally {
      setParityRunning(false);
    }
  }

  if (!postgresUp) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 max-w-2xl">
        <h2 className="text-lg font-semibold text-amber-900 mb-2">{t.adminPgMissingTitle}</h2>
        <p className="text-sm text-amber-800">{t.adminPgMissingBody}</p>
      </div>
    );
  }

  const totalParityIssues = Object.values(parity.countsByKind || {}).reduce((sum, n) => sum + n, 0);

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h2 className="text-xl font-bold">{t.adminTitle}</h2>
        <div className="text-sm text-ios-secondary">
          {stats && <span>{t.adminTotalEvents}: <b>{stats.total}</b></span>}
        </div>
      </header>

      {/* ── Backend mode banner (Phase 3) ── */}
      <section className="bg-white border border-ios-border rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold mb-1">{t.adminBackendModeTitle}</h3>
            <ModeBadge mode={stockMode} />
          </div>
          <div className="text-sm text-ios-secondary">
            {entities.length === 0
              ? t.adminNoEntitiesYet
              : entities.map(e => `${e.labelEn} (${e.key})`).join(' · ')}
          </div>
        </div>
      </section>

      {/* ── Stock parity dashboard (Phase 3) ── */}
      <section className="bg-white border border-ios-border rounded-xl p-4">
        <header className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{t.adminParityTitle}</h3>
          <button
            type="button"
            onClick={runParityRecheck}
            disabled={parityRunning}
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
          >
            {parityRunning ? t.adminParityRunning : t.adminParityRecheckBtn}
          </button>
        </header>
        {totalParityIssues === 0 ? (
          <p className="text-sm text-green-700">{t.adminParityNoMismatches}</p>
        ) : (
          <ul className="text-sm space-y-1">
            {parity.countsByKind.missing_pg     ? <li>{t.adminParityKindMissingPg}: <b>{parity.countsByKind.missing_pg}</b></li> : null}
            {parity.countsByKind.missing_at     ? <li>{t.adminParityKindMissingAt}: <b>{parity.countsByKind.missing_at}</b></li> : null}
            {parity.countsByKind.field_mismatch ? <li>{t.adminParityKindFieldMismatch}: <b>{parity.countsByKind.field_mismatch}</b></li> : null}
            {parity.countsByKind.write_failed   ? <li>{t.adminParityKindWriteFailed}: <b>{parity.countsByKind.write_failed}</b></li> : null}
          </ul>
        )}
      </section>

      {/* ── Stock raw-data table (Phase 3) ── */}
      <section className="bg-white border border-ios-border rounded-xl overflow-hidden">
        <header className="px-4 py-3 border-b border-ios-border">
          <h3 className="font-semibold">{t.adminStockTableTitle}</h3>
        </header>
        {stockRows.length === 0 ? (
          <div className="p-6 text-sm text-ios-secondary">{t.adminStockEmpty}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-ios-secondary uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">{t.adminStockColName}</th>
                <th className="text-left px-3 py-2">{t.adminStockColCategory}</th>
                <th className="text-right px-3 py-2">{t.adminStockColQty}</th>
                <th className="text-right px-3 py-2">{t.adminStockColCost}</th>
                <th className="text-right px-3 py-2">{t.adminStockColSell}</th>
                <th className="text-left px-3 py-2">{t.adminStockColUpdated}</th>
                <th className="text-left px-3 py-2">{t.adminStockColAirtableId}</th>
              </tr>
            </thead>
            <tbody>
              {stockRows.map(row => (
                <tr key={row.id} className="border-t border-ios-border hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">{row.display_name}</td>
                  <td className="px-3 py-2 text-ios-secondary">{row.category || ''}</td>
                  <td className={`px-3 py-2 text-right ${row.current_quantity < 0 ? 'text-red-600 font-semibold' : ''}`}>
                    {row.current_quantity}
                  </td>
                  <td className="px-3 py-2 text-right">{row.current_cost_price ?? ''}</td>
                  <td className="px-3 py-2 text-right">{row.current_sell_price ?? ''}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ios-secondary">{formatDate(row.updated_at)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ios-tertiary">{row.airtable_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Audit log (Phase 2.5) ── */}
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
