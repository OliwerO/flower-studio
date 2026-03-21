import { renderStockName } from '@flower-studio/shared';
import t from '../translations.js';

export default function BouquetEditor({ editing, saving, detail, isTerminal, onSaveClick, doSave }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">{t.labelBouquet}</p>
        {!isTerminal && !editing.editingBouquet && (
          <button onClick={() => editing.startEditing(detail.orderLines)}
            className="text-xs text-brand-600 font-medium">{t.edit || 'Edit'}</button>
        )}
      </div>

      {editing.editingBouquet ? (
        <div className="bg-gray-50 rounded-xl px-3 py-3 space-y-2">
          {editing.editLines.map((line, idx) => (
            <div key={line.id || idx} className="flex items-center gap-2">
              <span className="flex-1 text-sm text-ios-label truncate">{line.flowerName}</span>
              <input type="number" min="1" value={line.quantity}
                onChange={e => editing.updateLineQty(idx, e.target.value)}
                onBlur={() => editing.commitLineQty(idx)}
                onFocus={e => e.target.select()}
                className="w-14 text-center text-sm border border-gray-200 rounded-lg py-1.5" />
              <button onClick={() => editing.setRemoveDialogIdx(idx)} className="text-red-400 text-sm px-1">✕</button>
            </div>
          ))}

          {/* Add flower picker */}
          {!editing.addingFlower ? (
            <button onClick={() => editing.setAddingFlower(true)}
              className="w-full py-2 text-sm text-brand-600 font-medium bg-brand-50 rounded-lg active:bg-brand-100"
            >+ {t.addFlower || 'Add flower'}</button>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-2 space-y-1">
              <input type="text" value={editing.flowerSearch}
                onChange={e => editing.setFlowerSearch(e.target.value)}
                placeholder={t.flowerSearch || 'Search...'}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none"
                autoFocus />
              <div className="max-h-36 overflow-y-auto divide-y divide-gray-50">
                {editing.flowerSearch.length >= 1 && editing.getFilteredStock(editing.flowerSearch)
                  .slice(0, 6)
                  .map(s => (
                    <div key={s.id}
                      onPointerDown={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        editing.addFlowerFromStock(s);
                      }}
                      className="w-full text-left px-2 py-2.5 text-sm active:bg-gray-100 rounded cursor-pointer"
                    >
                      <span className="font-medium">{renderStockName(s['Display Name'], s['Last Restocked'])}</span>
                      <span className="text-xs text-ios-tertiary ml-1">
                        ({Number(s['Current Quantity']) || 0} pcs)
                      </span>
                    </div>
                  ))}
                {editing.flowerSearch.length >= 2 && !editing.stockItems.some(s =>
                  (s['Display Name'] || '').toLowerCase() === editing.flowerSearch.toLowerCase()
                ) && (
                  <div
                    onPointerDown={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      editing.addNewFlowerQuick(editing.flowerSearch);
                    }}
                    className="w-full text-left px-2 py-2.5 text-sm text-brand-600 font-medium border-t border-gray-100 cursor-pointer active:bg-brand-50 rounded"
                  >+ {t.addNewFlower || 'Add new'} "{editing.flowerSearch}"</div>
                )}
              </div>
              <button onClick={() => { editing.setAddingFlower(false); editing.setFlowerSearch(''); }}
                className="text-xs text-ios-tertiary">{t.cancel}</button>
            </div>
          )}

          {/* Remove flower dialog — return or write off */}
          {editing.removeDialogIdx != null && (
            <div className="bg-amber-50 rounded-xl px-3 py-2 space-y-2">
              <p className="text-sm text-amber-800">{editing.removeDialogLine?.flowerName}</p>
              <div className="flex gap-2">
                <button onClick={() => editing.confirmRemoveLine('return')}
                  className="flex-1 py-2 rounded-xl bg-green-600 text-white text-xs font-medium">
                  {t.returnToStock || 'Return'}
                </button>
                <button onClick={() => editing.confirmRemoveLine('writeoff')}
                  className="flex-1 py-2 rounded-xl bg-amber-600 text-white text-xs font-medium">
                  {t.writeOff || 'Write off'}
                </button>
              </div>
              <button onClick={() => editing.setRemoveDialogIdx(null)} className="text-xs text-ios-tertiary">{t.cancel}</button>
            </div>
          )}

          {/* Stock action dialog — shown when Save is tapped and quantities decreased */}
          {editing.stockAction === 'pending' && (() => {
            const reduced = editing.editLines.filter(l => l._originalQty > 0 && l.quantity < l._originalQty);
            const totalReduced = reduced.reduce((s, l) => s + (l._originalQty - l.quantity), 0);
            return totalReduced > 0 || editing.removedLines.length > 0 ? (
              <div className="bg-amber-50 rounded-xl px-3 py-3 space-y-2">
                <p className="text-sm font-medium text-amber-800">
                  {t.spareFlowersQuestion || 'What would you like to do with the spare flowers?'}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => doSave('return')}
                    className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium active-scale">
                    {t.returnToStock || 'Return to stock'}
                  </button>
                  <button onClick={() => doSave('writeoff')}
                    className="flex-1 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-medium active-scale">
                    {t.writeOff || 'Write off'}
                  </button>
                </div>
                <button onClick={() => editing.setStockAction(null)} className="text-xs text-ios-tertiary">{t.cancel}</button>
              </div>
            ) : null;
          })()}

          <div className="flex gap-2 pt-1">
            <button onClick={() => {
              const result = onSaveClick();
              if (result) result.then(data => { if (data) return; });
            }} disabled={saving || editing.saving}
              className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold"
            >{saving || editing.saving ? '...' : (t.save || 'Save')}</button>
            <button onClick={() => editing.cancelEditing()}
              className="px-4 py-2.5 rounded-xl bg-gray-100 text-ios-secondary text-sm"
            >{t.cancel}</button>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-xl overflow-hidden divide-y divide-gray-100">
          {detail.orderLines.map((line, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2">
              <div>
                <p className="text-sm font-medium text-ios-label">{line['Flower Name']}</p>
                <p className="text-xs text-ios-tertiary">
                  {line['Sell Price Per Unit']} zł × {line['Quantity']}
                </p>
              </div>
              <p className="text-sm font-semibold text-brand-600">
                {(Number(line['Sell Price Per Unit'] || 0) * Number(line['Quantity'] || 0)).toFixed(0)} zł
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
