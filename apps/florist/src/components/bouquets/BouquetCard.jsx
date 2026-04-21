import { useState } from 'react';
import { ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { activeCount, allActive, anyActive, priceRange, groupCategories } from '@flower-studio/shared';
import t from '../../translations.js';
import VariantList from './VariantList.jsx';

// One bouquet = one Wix product = N variants. The card collapses the variants
// into a single-tap control (toggle-all) for the common case, and expands on
// demand so the owner can manage individual sizes without leaving the page.

export default function BouquetCard({ group, onToggleAll, onToggleVariant }) {
  const [expanded, setExpanded] = useState(false);
  const count = activeCount(group);
  const total = group.variants.length;
  const allOn = allActive(group);
  const anyOn = anyActive(group);
  const cats = groupCategories(group);
  const range = priceRange(group);
  const needsReview = !anyOn && cats.length === 0;
  const isMono = group.variants.length === 1 ||
                 group.variants.every(v => (v['Variant Name'] || '').toLowerCase().includes('default'));

  // Active-count pill color mirrors the dashboard: green = all on, amber = partial,
  // red = none. Puts the glance-state right next to the name.
  let pillClass = 'bg-gray-100 text-gray-500';
  if (allOn) pillClass = 'bg-emerald-100 text-emerald-700';
  else if (anyOn) pillClass = 'bg-amber-100 text-amber-700';
  else pillClass = 'bg-red-50 text-red-600';

  return (
    <div className="rounded-2xl overflow-hidden bg-white dark:bg-dark-card border border-gray-100 dark:border-dark-separator mb-2">
      {/* Header row — card body expands when tapped. */}
      <div className="flex items-center gap-3 px-3 py-3">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left active-scale"
        >
          {group.imageUrl ? (
            <img
              src={group.imageUrl}
              alt=""
              className="w-14 h-14 rounded-xl object-cover bg-gray-100"
              loading="lazy"
            />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-gray-100 dark:bg-dark-elevated flex items-center justify-center text-[10px] text-ios-tertiary">
              {t.bouquetNoImage}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-ios-label dark:text-dark-label truncate">
                {group.name}
              </h3>
              {needsReview && (
                <AlertCircle size={14} className="text-amber-500 shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-ios-tertiary">
              <span>{isMono ? t.bouquetMono : t.bouquetMix}</span>
              <span>·</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${pillClass}`}>
                {count}/{total} {t.bouquetsActive}
              </span>
              {cats.length > 0 && (
                <>
                  <span>·</span>
                  <span className="truncate">{cats.slice(0, 2).join(', ')}</span>
                </>
              )}
            </div>
            {range && (
              <div className="text-[11px] tabular-nums text-ios-tertiary mt-0.5">
                {range[0] === range[1]
                  ? `${range[0].toFixed(0)} zł`
                  : `${range[0].toFixed(0)}–${range[1].toFixed(0)} zł`}
              </div>
            )}
          </div>

          {expanded
            ? <ChevronUp size={18} className="text-ios-tertiary shrink-0" />
            : <ChevronDown size={18} className="text-ios-tertiary shrink-0" />}
        </button>

        {/* Single-tap toggle for the whole bouquet. Tap target is comfortably
            wider than 44 px so thumbs don't mis-hit the card-expand area. */}
        <button
          onClick={() => onToggleAll(group, !allOn)}
          aria-label={allOn ? t.bouquetDeactivateAll : t.bouquetActivateAll}
          className={`relative w-12 h-7 rounded-full transition-colors shrink-0
                     ${allOn ? 'bg-emerald-500' : anyOn ? 'bg-amber-400' : 'bg-gray-300 dark:bg-gray-600'}`}
        >
          <span
            className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform
                       ${allOn ? 'translate-x-5' : 'translate-x-0.5'}`}
          />
        </button>
      </div>

      {expanded && (
        <VariantList variants={group.variants} onToggleVariant={onToggleVariant} />
      )}
    </div>
  );
}
