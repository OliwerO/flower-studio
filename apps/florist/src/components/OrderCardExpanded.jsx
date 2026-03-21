import t from '../translations.js';
import fmtDate from '../utils/formatDate.js';
import DatePicker from './DatePicker.jsx';
import BouquetEditor from './BouquetEditor.jsx';
import { ALLOWED_TRANSITIONS, STATUS_LABELS } from './OrderCardSummary.jsx';

function Pills({ options, value, onChange, disabled }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o.value}
          onClick={(e) => { e.stopPropagation(); !disabled && onChange(o.value); }}
          disabled={disabled}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors active-scale disabled:opacity-40 ${
            value === o.value
              ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
              : 'bg-gray-100 text-ios-secondary border-gray-200 hover:bg-gray-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-ios-tertiary shrink-0">{label}</span>
      <span className="text-xs text-ios-label text-right">{value}</span>
    </div>
  );
}

function statusLabel(s) {
  return STATUS_LABELS[s]?.() || s;
}

export default function OrderCardExpanded({
  order, detail, d, editing, loading, saving, isDelivery, isTerminal, isOwner,
  currentStatus, currentPaid, currentPrice,
  timeSlots, drivers, payMethods,
  onPatch, onPatchDelivery, doSave, onSaveClick, onCollapse, onConvertToDelivery, setDetail,
}) {
  return (
    <div className="mt-4 pt-4 border-t border-gray-100 flex flex-col gap-4" onClick={e => e.stopPropagation()}>

      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : !detail ? (
        <p className="text-xs text-ios-tertiary text-center py-4">{t.errorLoadDetails}</p>
      ) : (
        <>
          {/* Order lines — bouquet editor */}
          {detail.orderLines?.length > 0 && (
            <BouquetEditor
              editing={editing}
              saving={saving}
              detail={detail}
              isTerminal={isTerminal}
              onSaveClick={onSaveClick}
              doSave={doSave}
            />
          )}

          {/* Order date */}
          {d['Order Date'] && (
            <div className="bg-gray-50 rounded-xl px-3 py-1">
              <Row label={t.labelOrderDate} value={fmtDate(d['Order Date'])} />
            </div>
          )}

          {/* Delivery details — date + time editable */}
          {isDelivery && detail.delivery && (
            <div>
              <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.labelDelivery}</p>
              <div className="bg-gray-50 rounded-xl px-3 py-2 space-y-2">
                <div className="flex items-center justify-between gap-2 py-1">
                  <span className="text-xs text-ios-tertiary shrink-0">{t.labelDate}</span>
                  <div className="relative z-10">
                    <DatePicker
                      value={detail.delivery['Delivery Date'] || ''}
                      onChange={val => onPatchDelivery({ 'Delivery Date': val })}
                      placeholder={t.optional || '—'}
                    />
                  </div>
                </div>
                <div className="py-1">
                  <span className="text-xs text-ios-tertiary block mb-1.5">{t.labelTime}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {timeSlots.map(slot => (
                      <button
                        key={slot}
                        onClick={() => onPatchDelivery({
                          'Delivery Time': detail.delivery['Delivery Time'] === slot ? '' : slot,
                        })}
                        disabled={saving}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors active-scale disabled:opacity-40 ${
                          detail.delivery['Delivery Time'] === slot
                            ? 'bg-brand-600 text-white shadow-sm'
                            : 'bg-white text-ios-secondary border border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                </div>
                <Row label={t.labelAddress}   value={detail.delivery['Delivery Address']} />
                <Row label={t.labelRecipient} value={detail.delivery['Recipient Name']} />
                <Row label={t.labelPhone}     value={detail.delivery['Recipient Phone']} />
                <Row label={t.labelFee}       value={detail.delivery['Delivery Fee'] ? `${detail.delivery['Delivery Fee']} zł` : null} />
              </div>
            </div>
          )}

          {/* Driver assignment */}
          {isDelivery && detail?.delivery && drivers.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.assignedDriver}</p>
              <div className="flex flex-wrap gap-1.5">
                {drivers.map(driver => (
                  <button
                    key={driver}
                    onClick={() => onPatchDelivery({ 'Assigned Driver': detail.delivery['Assigned Driver'] === driver ? '' : driver })}
                    disabled={saving}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors active-scale disabled:opacity-40 ${
                      detail.delivery['Assigned Driver'] === driver
                        ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                        : 'bg-gray-100 text-ios-secondary border-gray-200 hover:bg-gray-200'
                    }`}
                  >
                    {driver}
                  </button>
                ))}
              </div>
              {!detail.delivery['Assigned Driver'] && (
                <p className="text-xs text-ios-tertiary mt-1">{t.noDriver}</p>
              )}
            </div>
          )}

          {/* Greeting card text */}
          {detail['Greeting Card Text'] && (
            <div>
              <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.labelCardMsg}</p>
              <p className="text-lg text-ios-label bg-amber-50 rounded-xl px-4 py-3 leading-relaxed whitespace-pre-wrap">
                {detail['Greeting Card Text']}
              </p>
            </div>
          )}

          {/* Owner: Cost/Margin */}
          {isOwner && (() => {
            const costTotal = (detail.orderLines || []).reduce(
              (sum, l) => sum + Number(l['Cost Price Per Unit'] || 0) * Number(l['Quantity'] || 0), 0
            );
            const sellTotal = Number(detail['Price Override'] || 0)
              || (detail.orderLines || []).reduce(
                (sum, l) => sum + Number(l['Sell Price Per Unit'] || 0) * Number(l['Quantity'] || 0), 0
              );
            const effectivePrice = sellTotal + Number(detail['Delivery Fee'] || 0);
            if (!costTotal && !effectivePrice) return null;
            const marginAmt = effectivePrice - costTotal;
            const marginPct = effectivePrice > 0 ? Math.round((marginAmt / effectivePrice) * 100) : 0;
            return (
              <div>
                <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.owner.finances}</p>
                <div className="bg-gray-50 rounded-xl px-3 py-1">
                  <Row label={t.owner.cost} value={`${Math.round(costTotal)} zł`} />
                  <Row label={t.owner.margin} value={`${Math.round(marginAmt)} zł (${marginPct}%)`} />
                </div>
              </div>
            );
          })()}

          {/* Delivery type switch */}
          {!isTerminal && (
            <div>
              <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.deliveryType || 'Delivery type'}</p>
              <Pills
                value={d['Delivery Type'] || 'Pickup'}
                onChange={val => onConvertToDelivery(val)}
                disabled={saving}
                options={[
                  { value: 'Pickup',   label: t.pickup || 'Pickup' },
                  { value: 'Delivery', label: t.delivery || 'Delivery' },
                ]}
              />
            </div>
          )}

          {/* Status controls */}
          <div>
            <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.labelStatus}</p>
            {(() => {
              const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
              const visible = [currentStatus, ...allowed];
              return (
                <Pills
                  value={currentStatus}
                  onChange={val => onPatch({ 'Status': val })}
                  disabled={saving}
                  options={visible.map(s => ({ value: s, label: statusLabel(s) }))}
                />
              );
            })()}
          </div>

          {/* Payment controls */}
          <div>
            <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.labelPayment}</p>
            <div className="flex flex-col gap-2">
              <Pills
                value={d['Payment Status'] || 'Unpaid'}
                onChange={val => {
                  const updates = { 'Payment Status': val };
                  if (val === 'Unpaid') {
                    updates['Payment Method'] = '';
                    updates['Payment 1 Amount'] = null;
                    updates['Payment 1 Method'] = null;
                    updates['Payment 2 Amount'] = null;
                    updates['Payment 2 Method'] = null;
                  }
                  onPatch(updates);
                }}
                disabled={saving}
                options={[
                  { value: 'Unpaid',  label: t.unpaid },
                  { value: 'Paid',    label: t.paid },
                  { value: 'Partial', label: t.partial || 'Partial' },
                ]}
              />
              {currentPaid && (
                <Pills
                  value={d['Payment Method'] || ''}
                  onChange={val => onPatch({ 'Payment Method': val })}
                  disabled={saving}
                  options={payMethods.map(m => ({ value: m, label: m }))}
                />
              )}
              {/* Partial payment flow */}
              {d['Payment Status'] === 'Partial' && (() => {
                const effPrice = currentPrice || 0;
                const p1Amt = Number(d['Payment 1 Amount'] || 0);
                const p1Mtd = d['Payment 1 Method'] || '';
                const hasP1 = p1Amt > 0 && p1Mtd;
                const rem = effPrice - p1Amt;
                return (
                  <div className="bg-gray-50 rounded-xl px-3 py-3 space-y-3">
                    {effPrice > 0 && (
                      <p className="text-xs text-ios-tertiary">
                        {t.price || 'Total'}: <span className="font-semibold text-ios-label">{effPrice} zł</span>
                      </p>
                    )}
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-ios-tertiary uppercase">{t.payment1}</p>
                      <input
                        type="number"
                        value={d['Payment 1 Amount'] || ''}
                        onChange={e => {
                          const val = e.target.value === '' ? null : Number(e.target.value);
                          setDetail(prev => prev ? { ...prev, 'Payment 1 Amount': val } : prev);
                        }}
                        placeholder="0"
                        className="w-24 text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none"
                        disabled={saving}
                      />
                      <Pills
                        value={p1Mtd}
                        onChange={v => {
                          const amt = Number(detail?.['Payment 1 Amount'] || d['Payment 1 Amount'] || 0);
                          if (amt > 0) {
                            onPatch({ 'Payment 1 Amount': amt, 'Payment 1 Method': v });
                          } else {
                            setDetail(prev => prev ? { ...prev, 'Payment 1 Method': v } : prev);
                          }
                        }}
                        disabled={saving}
                        options={payMethods.map(m => ({ value: m, label: m }))}
                      />
                    </div>
                    {hasP1 && (
                      <div className="border-t border-gray-200 pt-2 space-y-1.5">
                        <p className="text-xs text-ios-tertiary">
                          {t.paidAmount}: <span className="text-green-600 font-medium">{p1Amt} zł</span>
                          {' · '}
                          {t.remaining}: <span className="text-orange-600 font-semibold">{rem > 0 ? rem : 0} zł</span>
                        </p>
                        {rem > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-semibold text-ios-tertiary uppercase">{t.payment2}</p>
                            <input
                              type="number"
                              value={d['Payment 2 Amount'] || rem || ''}
                              onChange={e => {
                                const val = e.target.value === '' ? null : Number(e.target.value);
                                setDetail(prev => prev ? { ...prev, 'Payment 2 Amount': val } : prev);
                              }}
                              placeholder={String(rem)}
                              className="w-24 text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none"
                              disabled={saving}
                            />
                            <Pills
                              value={d['Payment 2 Method'] || ''}
                              onChange={v => {
                                const amt = Number(detail?.['Payment 2 Amount'] || d['Payment 2 Amount'] || rem);
                                onPatch({
                                  'Payment 2 Amount': amt,
                                  'Payment 2 Method': v,
                                  'Payment Status': 'Paid',
                                });
                              }}
                              disabled={saving}
                              options={payMethods.map(m => ({ value: m, label: m }))}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Notes */}
          {detail['Notes Original'] && (
            <div>
              <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.labelNotes}</p>
              <p className="text-sm text-ios-label bg-gray-50 rounded-xl px-3 py-2">{detail['Notes Original']}</p>
            </div>
          )}
        </>
      )}

      {/* Collapse button */}
      <button
        onClick={(e) => { e.stopPropagation(); onCollapse(); }}
        className="text-xs text-ios-tertiary text-center py-1 active-scale"
      >
        ▲ {t.collapse}
      </button>
    </div>
  );
}
