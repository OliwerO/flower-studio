/**
 * VarietyListItem — collapsible row for a single Variety in the Y-model Stock list.
 *
 * Layout (left → right):
 *   - Identity column: Colour / Size / Cultivar stacked vertically (lines omitted
 *     when null) so each attribute is scannable independently.
 *   - 4-bucket numeric grid: On hand / Planned / Reserved / Net.
 *   - Inline write-off button (when `onWriteOff` provided).
 *
 * Expanding the row reveals each Batch and Demand-Entry sub-row, each tagged with
 * a kind badge. Both row kinds are clickable and call `onRowClick(stockId)` so the
 * host can open BatchTraceModal — the same /stock/:id/usage endpoint surfaces the
 * trail of orders / writeoffs / purchases for Batches AND linked orders for DEs.
 *
 * Props:
 *   variety     {Object}   — Variety group { key, type_name, colour, size_cm, cultivar, rows[] }.
 *                            Each row must carry { id, current_quantity, date }.
 *   reservations {Map<string,number>} — stock-row id → reserved stem count.
 *   hideType    {boolean}  — when true (under TypeGroupHeader) drop the Type prefix.
 *   expanded    {boolean}  — whether the expansion is visible.
 *   onToggle    {Function} — header click handler.
 *   onRowClick  {Function} — called with stockId when a Batch/Demand row is tapped.
 *                            (Was previously `onBatchClick`; renamed because both
 *                            kinds open the same trace view via /stock/:id/usage.)
 *   onWriteOff  {Function} — called with the variety when the inline write-off
 *                            button is tapped. When omitted, the button is hidden.
 *   premadesByStockId {Map<string,Array>} — id → [{ id, name, qty }, ...]. Reserved
 *                            bucket becomes a button when supplied AND reserved>0.
 *   t           {Object}   — translation strings. Required keys:
 *                              onHand, planned, reserved, net, stems, writeOff,
 *                              batchKind, demandKind.
 *
 * IMPORTANT: Never inline qty − reserved subtraction here. Always call
 * `getVarietyTotals(variety.rows, reservations)`. Pitfall #8.
 */
import { useState } from 'react';
import { getVarietyTotals } from '../utils/stockMath.js';

export default function VarietyListItem({
  variety,
  reservations = new Map(),
  hideType = true,
  expanded = false,
  onToggle,
  onRowClick,
  onBatchClick, // legacy alias — kept for back-compat with un-migrated callers
  onWriteOff,
  premadesByStockId,
  t,
}) {
  const handleRowClick = onRowClick ?? onBatchClick;

  // Aggregate the 4 buckets — never inline; always go through the helper (pitfall #8).
  const { onHand, planned, reservedForPremades, net } = getVarietyTotals(
    variety.rows,
    reservations,
  );

  // Identity attrs — rendered inline with a typographic hierarchy:
  //   Type (optional, only when hideType=false) → small uppercase label
  //   Colour    → primary, bold dark
  //   Size      → secondary, medium gray, plain weight
  //   Cultivar  → tertiary, lighter gray, italic
  // Empties are omitted entirely so a row never shows a stray "—".
  const showType = !hideType && !!variety.type_name;
  const hasColour   = !!variety.colour;
  const hasSize     = variety.size_cm != null;
  const hasCultivar = !!variety.cultivar;
  const hasAnyIdentity = hasColour || hasSize || hasCultivar || showType;

  const netNegative = net < 0;

  // Reserved-bucket tap: local toggle state for the premade sub-list.
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
      onToggle && onToggle();
    }
  }

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {/* ── Header row ── */}
      <div
        role="button"
        tabIndex={0}
        data-testid="variety-header"
        onClick={onToggle}
        onKeyDown={handleHeaderKey}
        className="w-full flex items-center px-4 py-2 text-left transition-colors active:bg-gray-50 cursor-pointer gap-3"
      >
        {/* Identity column — single-line typographic hierarchy.
            Colour bold + dark, Size medium, Cultivar lighter + italic.
            Baseline-aligned so the size badge sits flush with the colour. */}
        <span className="flex-1 min-w-0 flex items-baseline gap-2 truncate">
          {showType && (
            <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">
              {variety.type_name}
            </span>
          )}
          {hasColour && (
            <span className="text-sm font-semibold text-gray-900 truncate">
              {variety.colour}
            </span>
          )}
          {hasSize && (
            <span className="text-xs text-gray-600 tabular-nums shrink-0">
              {variety.size_cm}cm
            </span>
          )}
          {hasCultivar && (
            <span className="text-xs text-gray-400 italic truncate">
              {variety.cultivar}
            </span>
          )}
          {!hasAnyIdentity && (
            <span className="text-sm text-gray-400">—</span>
          )}
        </span>

        {/* 4-bucket numeric grid */}
        <span className="grid grid-cols-4 gap-x-3 text-right shrink-0">
          <Bucket testid="bucket-onHand"   value={onHand}              label={t.onHand} />
          <Bucket testid="bucket-planned"  value={planned}             label={t.planned} />
          <Bucket
            testid="bucket-reserved"
            value={reservedForPremades}
            label={t.reserved}
            onClick={reservedInteractive ? (e) => { e.stopPropagation(); setPremadeOpen(o => !o); } : null}
            valueClass={reservedInteractive ? 'text-indigo-600 underline decoration-dotted' : 'text-gray-900'}
          />
          <Bucket
            testid="bucket-net"
            value={net}
            label={t.net}
            valueClass={netNegative ? 'text-red-600' : 'text-gray-900'}
          />
        </span>

        {/* Inline write-off button — host opts in via onWriteOff prop */}
        {onWriteOff && (
          <button
            type="button"
            data-testid="variety-writeoff"
            onClick={(e) => { e.stopPropagation(); onWriteOff(variety); }}
            className="shrink-0 text-[11px] text-ios-red font-medium px-2 py-1 rounded-full bg-red-50 active:bg-red-100"
            aria-label={t.writeOff}
          >
            🗑
          </button>
        )}
      </div>

      {/* ── Premade sub-list (tap on reserved bucket) ── */}
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
      {expanded && (
        <ul className="bg-gray-50 border-t border-gray-100">
          {[...variety.rows]
            .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
            .map((row) => {
              // ADR-0005 negative-qty derivation rule: negative qty → Demand Entry
              const kind = row.current_quantity < 0 ? 'demand' : 'batch';
              const absQty = Math.abs(row.current_quantity);
              const kindLabel = kind === 'batch' ? (t.batchKind ?? 'Batch') : (t.demandKind ?? 'Demand');
              const dateLabel = row.date ?? '—';

              const isDemand = kind === 'demand';
              const baseRow = 'w-full flex items-center justify-between px-6 py-2 text-sm transition-colors active:bg-gray-100';
              const rowClass = isDemand
                ? `${baseRow} text-red-700 bg-red-50 hover:bg-red-100`
                : `${baseRow} text-gray-700 hover:bg-gray-100`;

              return (
                <li key={row.id}>
                  <button
                    type="button"
                    data-testid="stock-item-row"
                    data-row-kind={kind}
                    onClick={() => handleRowClick && handleRowClick(row.id)}
                    className={rowClass}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          isDemand ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-700'
                        }`}
                      >
                        {kindLabel}
                      </span>
                      <span className="text-gray-500">{dateLabel}</span>
                    </span>
                    <span className="tabular-nums">
                      {absQty} {t.stems} ›
                    </span>
                  </button>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}

function Bucket({ testid, value, label, onClick, valueClass }) {
  const cls = `text-sm font-semibold tabular-nums ${valueClass ?? 'text-gray-900'}`;
  return (
    <span className="flex flex-col items-end">
      {onClick ? (
        <button type="button" data-testid={testid} onClick={onClick} className={cls}>
          {value}
        </button>
      ) : (
        <span data-testid={testid} className={cls}>{value}</span>
      )}
      <span className="text-[10px] text-gray-400 leading-none">{label}</span>
    </span>
  );
}
