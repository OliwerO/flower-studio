/**
 * VarietyListItem — collapsible row for a single Variety in the Y-model Stock list.
 *
 * Glance-test design (owner runs flower shop under live-or-death pressure):
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ ▌ Pink  60cm  Sarah Bernhardt                            ✓ 12   🗑 │
 *   │ ▌ 33 on hand · 16 orders · 5 reserved                       free   │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 *   - Left border:  green (free) / amber (tight) / red (short).
 *   - Net is the primary number — large, coloured, status-iconified.
 *   - Identity line: Colour bold, Size medium, Cultivar italic light (#308 hierarchy).
 *   - Bucket chips only render when value > 0; zero-buckets stay in DOM as
 *     sr-only spans so the data-testid contract is stable.
 *   - Expand → Batch + Demand breakdown below.
 *
 * Props:
 *   variety, reservations, hideType, expanded, onToggle, onRowClick,
 *   onBatchClick (legacy), onWriteOff, onVarietyTrace, premadesByStockId, t.
 *
 *   Required translation keys: onHand, planned, reserved, net, stems, writeOff,
 *     batchKind, demandKind, statusFree, statusShort, statusTight.
 *
 * Pitfall #8: never inline qty − reserved subtraction; always use getVarietyTotals.
 */
import { useState } from 'react';
import { getVarietyTotals, getVarietyAvailability, arrivalsForVariety } from '../utils/stockMath.js';
import { formatDateDMY } from '../utils/formatDate.js';
import VarietyIdentity from './VarietyIdentity.jsx';
import DateTag from './DateTag.jsx';

export default function VarietyListItem({
  variety,
  reservations = new Map(),
  pendingPO = {},
  todayIso = new Date().toISOString().slice(0, 10),
  hideType = false,
  expanded = false,
  onToggle,
  onRowClick,
  onBatchClick, // legacy alias
  onWriteOff,
  onVarietyTrace, // (varietyKey) — called on header expand instead of onRowClick when provided
  onAdjust, // (stockId, delta) — per-Batch quick-adjust; only rendered on Batch rows
  premadesByStockId,
  isOwner = false, // CR-36: owner-only cost/sell/markup/supplier on expand
  t,
}) {
  const handleRowClick = onRowClick ?? onBatchClick;

  // Pick the row to surface for trace on header click: prefer the first Batch
  // (positive qty) so the owner sees real stock history; fall back to first row.
  const primaryRow =
    (variety.rows || []).find((r) => Number(r.current_quantity) > 0) ??
    (variety.rows || [])[0] ??
    null;

  // CR-37: tapping the header just expands (to reveal detail). Trace is now an
  // explicit button in the expand body — no more surprise trace-panel on every tap.
  function handleHeaderClick() {
    onToggle && onToggle();
  }

  function handleTraceClick(e) {
    e.stopPropagation();
    if (onVarietyTrace) onVarietyTrace(variety.key);
    else if (primaryRow && handleRowClick) handleRowClick(primaryRow.id);
  }

  const hasTrace = !!onVarietyTrace || (!!handleRowClick && !!primaryRow);

  const { onHand, planned, reservedForPremades, net } = getVarietyTotals(
    variety.rows,
    reservations,
  );

  // CR-03: incoming + effective for the stock panel header sub-line.
  const availability = getVarietyAvailability(
    variety.rows,
    reservations,
    arrivalsForVariety(variety.rows, pendingPO, todayIso),
  );
  const firstArrival = availability.arrivals[0] ?? null;

  // Status thresholds: shortfall > tight > free.
  const isShort = net < 0;
  const isTight = !isShort && net === 0 && (planned > 0 || reservedForPremades > 0);
  const borderClass = isShort ? 'border-l-red-400' : isTight ? 'border-l-amber-400' : 'border-l-emerald-400';
  const statusColour = isShort ? 'text-red-600' : isTight ? 'text-amber-600' : 'text-emerald-600';
  const statusGlyph = isShort ? '⚠' : isTight ? '○' : '✓';
  const statusLabel = isShort
    ? (t.statusShort ?? 'short')
    : isTight
      ? (t.statusTight ?? 'tight')
      : (t.statusFree ?? 'free');

  // Reserved-bucket interactivity.
  const [premadeOpen, setPremadeOpen] = useState(false);
  const reservedInteractive = reservedForPremades > 0 && !!premadesByStockId;

  const premadeLines = [];
  if (premadesByStockId) {
    for (const row of variety.rows) {
      const lines = premadesByStockId.get(row.id);
      if (lines) lines.forEach(pm => premadeLines.push(pm));
    }
  }

  function handleHeaderKey(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleHeaderClick();
    }
  }

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {/* ── Header row ── */}
      <div className={`flex items-stretch border-l-4 ${borderClass}`}>
        <div
          role="button"
          tabIndex={0}
          data-testid="variety-header"
          onClick={handleHeaderClick}
          onKeyDown={handleHeaderKey}
          className="flex-1 min-w-0 px-3 py-2 transition-colors active:bg-gray-50 cursor-pointer"
        >
          {/* Identity row — shared hierarchy via VarietyIdentity (#311). */}
          <VarietyIdentity variety={variety} showType={!hideType} />

          {/* Narrative bucket line. Zero buckets render sr-only so testids stay queryable. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <BucketChip testid="bucket-onHand"   value={onHand}              label={t.onHand}    tone="stock" />
            <BucketChip testid="bucket-planned"  value={planned}             label={t.planned}   tone="orders" />
            <BucketChip
              testid="bucket-reserved"
              value={reservedForPremades}
              label={t.reserved}
              tone="reserved"
              onClick={reservedInteractive ? (e) => { e.stopPropagation(); setPremadeOpen(o => !o); } : null}
            />
          </div>

          {/* CR-03: incoming PO sub-line — only when arrivals exist. */}
          {availability.incoming > 0 && firstArrival && (
            <div
              data-testid="variety-incoming"
              className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs"
            >
              <span className="text-blue-600 font-semibold tabular-nums">+{availability.incoming}</span>
              <DateTag
                date={firstArrival.date}
                kind="arriving"
                overdue={firstArrival.overdue}
                compact
                t={t}
              />
              <span className="text-gray-400">·</span>
              <span className="text-gray-600 tabular-nums">{availability.effective}</span>
              <span className="text-gray-400">{t.effective ?? 'Effective'}</span>
            </div>
          )}
        </div>

        {/* Net + status — primary signal */}
        <div className={`flex flex-col items-end justify-center px-3 py-2 leading-none ${statusColour}`}>
          <div className="flex items-baseline gap-1">
            <span className="text-base">{statusGlyph}</span>
            <span data-testid="bucket-net" className="text-lg font-bold tabular-nums">{net}</span>
          </div>
          <span className="text-[10px] text-gray-400 mt-0.5">{statusLabel}</span>
        </div>

        {/* Inline write-off */}
        {onWriteOff && (
          <button
            type="button"
            data-testid="variety-writeoff"
            onClick={(e) => { e.stopPropagation(); onWriteOff(variety); }}
            className="shrink-0 self-center mr-3 text-[11px] text-ios-red font-medium px-2 py-1 rounded-full bg-red-50 active:bg-red-100"
            aria-label={t.writeOff}
          >
            🗑
          </button>
        )}
      </div>

      {/* ── Premade sub-list (reserved-bucket tap) ── */}
      {premadeOpen && premadeLines.length > 0 && (
        <ul className="bg-indigo-50 border-t border-indigo-100 pl-4 py-1">
          {premadeLines.map(pm => (
            <li
              key={pm.id}
              data-testid={`premade-row-${pm.id}`}
              className="flex justify-between text-xs text-indigo-800 py-0.5 pr-4"
            >
              <span>{pm.name}</span>
              <span className="tabular-nums font-medium">{pm.qty}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ── Expansion body ── */}
      {expanded && (() => {
        const expansionRows = mergeExpansionRows(variety.rows);
        // Sell label is informative only when more than one Batch tier exists —
        // a single tier is redundant noise next to the Batch chip.
        const multiTier = expansionRows.filter((r) => r.kind === 'batch').length > 1;
        // CR-36: owner-only financials, representative from the primary Batch.
        const cost = Number(primaryRow?.current_cost_price) || 0;
        const sell = Number(primaryRow?.current_sell_price) || 0;
        const supplier = primaryRow?.supplier || primaryRow?.Supplier || null;
        const markup = cost > 0 ? (sell / cost).toFixed(1) : null;
        return (
        <ul className="bg-gray-50 border-t border-gray-100">
          {isOwner && (sell > 0 || cost > 0 || supplier) && (
            <li
              data-testid="variety-owner-financials"
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-2 text-xs text-gray-600 border-b border-gray-100"
            >
              <span>{t.costPrice ?? 'Cost'}: <span className="font-semibold tabular-nums text-gray-800">{cost.toFixed(2)}</span></span>
              <span>{t.sellPrice ?? 'Sell'}: <span className="font-semibold tabular-nums text-gray-800">{sell.toFixed(2)}</span></span>
              {markup && <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-medium tabular-nums">×{markup}</span>}
              {supplier && <span>{t.supplier ?? 'Supplier'}: <span className="text-gray-800">{supplier}</span></span>}
            </li>
          )}
          {expansionRows.map((row) => {
              const kind = row.kind;
              const isDemand = kind === 'demand';
              const kindLabel = isDemand ? (t.demandKind ?? 'Demand') : (t.batchKind ?? 'Batch');
              const dateLabel = isDemand && row.date ? formatDateDMY(row.date) : null;

              const rowClass = isDemand
                ? 'w-full flex items-center justify-between px-6 py-2 text-sm text-red-700 bg-red-50'
                : 'w-full flex items-center justify-between px-6 py-2 text-sm text-gray-700';
              const showAdjust = !!onAdjust && !isDemand;
              // For merged Batch rows: adjust acts on the FEFO-oldest underlying
              // stock_id so positive +/- credits/debits the row that'll be consumed next.
              const adjustTargetId = row.stockIds[0];

              return (
                <li key={row.key} className={rowClass} data-row-kind={kind}>
                  <button
                    type="button"
                    data-testid="stock-item-row"
                    data-row-kind={kind}
                    data-stock-ids={row.stockIds.join(',')}
                    onClick={() => handleRowClick && handleRowClick(row.stockIds[0])}
                    className={`flex items-center gap-2 min-w-0 flex-1 text-left rounded transition-colors ${
                      isDemand ? 'hover:bg-red-100 active:bg-red-100' : 'hover:bg-gray-100 active:bg-gray-100'
                    }`}
                  >
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        isDemand ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      {kindLabel}
                    </span>
                    {dateLabel && <span className="text-gray-500">{dateLabel}</span>}
                    {!isDemand && row.sell != null && multiTier && (
                      <span className="text-gray-500 tabular-nums">{row.sell.toFixed(2)} {t.currency ?? 'zł'}</span>
                    )}
                  </button>
                  <span className="flex items-center gap-2 shrink-0 ml-2">
                    {showAdjust && (
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          data-testid="variety-adjust-dec"
                          onClick={(e) => { e.stopPropagation(); onAdjust(adjustTargetId, -1); }}
                          className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-200 text-gray-700 text-sm leading-none active:bg-gray-300"
                          aria-label={t.decrease ?? 'Remove one stem'}
                        >
                          −
                        </button>
                        <button
                          type="button"
                          data-testid="variety-adjust-inc"
                          onClick={(e) => { e.stopPropagation(); onAdjust(adjustTargetId, 1); }}
                          className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-200 text-gray-700 text-sm leading-none active:bg-gray-300"
                          aria-label={t.increase ?? 'Add one stem'}
                        >
                          +
                        </button>
                      </span>
                    )}
                    <span className="tabular-nums">
                      {row.absQty} {t.stems} ›
                    </span>
                  </span>
                </li>
              );
            })}
          {hasTrace && (
            <li className="px-6 py-2 border-t border-gray-100">
              <button
                type="button"
                data-testid="variety-trace-btn"
                onClick={handleTraceClick}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 active:text-indigo-900"
              >
                {t.trace ?? 'Trace ›'}
              </button>
            </li>
          )}
        </ul>
        );
      })()}
    </div>
  );
}

// Merge Batch rows (positive qty) by sell price; keep Demand rows (negative
// qty) split by date — each is a distinct requirement date.
// Owner design 2026-05-31: stems with the same Variety + Sell price are
// fungible regardless of arrival date or supplier; show one merged Batch row.
function mergeExpansionRows(rows) {
  const batches = new Map(); // sellKey → merged Batch row
  const demands = [];
  // Track the receive-date of each underlying stock_id so we can sort the
  // merged row's `stockIds` by date asc (FEFO-oldest at index 0). Adjust +/-
  // and trace-open use `stockIds[0]`, so this ordering matters.
  const stockIdDates = new Map();
  for (const r of rows ?? []) {
    const qty = Number(r.current_quantity) || 0;
    if (qty < 0) {
      demands.push({
        kind:     'demand',
        key:      `d-${r.id}`,
        stockIds: [r.id],
        date:     r.date ?? null,
        absQty:   Math.abs(qty),
        sell:     null,
      });
      continue;
    }
    stockIdDates.set(r.id, r.date ?? null);
    const sell = readSellPrice(r);
    const sellKey = sell != null ? sell.toFixed(2) : 'null';
    const k = `b-${sellKey}`;
    let m = batches.get(k);
    if (!m) {
      m = {
        kind:       'batch',
        key:        k,
        stockIds:   [],
        date:       null, // not displayed for merged batches
        absQty:     0,
        sell,
      };
      batches.set(k, m);
    }
    m.stockIds.push(r.id);
    m.absQty += qty;
  }
  // Sort underlying stockIds by date asc (NULL last) so [0] = FEFO oldest.
  for (const m of batches.values()) {
    m.stockIds.sort((a, b) => {
      const da = stockIdDates.get(a);
      const db = stockIdDates.get(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    });
  }
  // Sort: demands by date asc (earliest requirement first), then batches by
  // sell price asc (cheapest tier first).
  demands.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const batchList = [...batches.values()].sort((a, b) => (a.sell ?? 0) - (b.sell ?? 0));
  return [...demands, ...batchList];
}

function readSellPrice(row) {
  const v = row['Current Sell Price'] ?? row.current_sell_price;
  if (v == null || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function BucketChip({ testid, value, label, tone, onClick }) {
  if (value === 0) {
    return <span data-testid={testid} className="sr-only">{value}</span>;
  }
  const toneClass = {
    stock:    'text-gray-700',
    orders:   'text-amber-700',
    reserved: 'text-indigo-700',
  }[tone] ?? 'text-gray-700';
  const valueClass = `font-semibold tabular-nums ${toneClass}`;

  if (onClick) {
    return (
      <button
        type="button"
        data-testid={testid}
        onClick={onClick}
        className={`inline-flex items-center underline decoration-dotted ${valueClass}`}
      >
        {value}
        <span className="ml-1 text-gray-400 font-normal">{label}</span>
      </button>
    );
  }
  return (
    <span data-testid={testid} className={`inline-flex items-center ${valueClass}`}>
      {value}
      <span className="ml-1 text-gray-400 font-normal">{label}</span>
    </span>
  );
}
