import { useState, useRef, useEffect } from 'react';

/**
 * TierSwitchChip — owner / florist clicks the current sell price on a
 * bouquet line to switch the line to a different sell tier of the same
 * Variety. Tiers come from `useOrderEditing.getLineTiers(line)`; on pick
 * the host calls `useOrderEditing.switchLineTier(idx, stockId)`.
 *
 * When the line's Variety has 0 or 1 tier, the chip degrades to plain
 * text — there is nothing to switch to.
 *
 * Props:
 *   currentSell   — number — the line's current sell price
 *   tiers         — array from getLineTiers: [{ key, sell, stockIds[], totalQty }]
 *   onPick        — (newStockId) => void — host wires to switchLineTier(idx, ...)
 *   t             — translations (currency, switchTier)
 */
export default function TierSwitchChip({ currentSell, tiers, onPick, t }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const switchable = (tiers?.length ?? 0) > 1;
  const cur = Number(currentSell) || 0;

  useEffect(() => {
    if (!open) return;
    function handle(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
    };
  }, [open]);

  if (!switchable) {
    return <span className="tabular-nums">{cur.toFixed(0)} {t.currency ?? 'zł'}</span>;
  }

  return (
    <span className="relative inline-block" ref={wrapRef}>
      <button
        type="button"
        data-testid="tier-switch-chip"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className="tabular-nums underline decoration-dotted underline-offset-2 text-indigo-700 hover:text-indigo-900"
        aria-label={t.switchTier ?? 'Switch sell tier'}
      >
        {cur.toFixed(0)} {t.currency ?? 'zł'} ▾
      </button>
      {open && (
        <div
          data-testid="tier-switch-menu"
          className="absolute left-0 top-full mt-1 z-30 bg-white rounded-lg shadow-lg border border-gray-200 min-w-[10rem] py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {tiers.map((tier) => {
            const isCurrent = Math.abs(tier.sell - cur) < 0.005;
            return (
              <button
                key={tier.key}
                type="button"
                data-testid="tier-switch-option"
                data-tier-key={tier.key}
                onClick={() => {
                  onPick(tier.stockIds[0].id);
                  setOpen(false);
                }}
                className={[
                  'w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-3',
                  isCurrent ? 'bg-indigo-50 text-indigo-900 font-medium' : 'hover:bg-gray-50 text-gray-700',
                ].join(' ')}
              >
                <span className="tabular-nums">{tier.sell.toFixed(2)} {t.currency ?? 'zł'}</span>
                <span className="text-[10px] text-gray-400 tabular-nums">{tier.totalQty} {t.stems ?? 'stems'}</span>
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
