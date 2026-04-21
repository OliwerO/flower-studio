// CustomerDetailView — right pane of the Customer Tab v2.0 split view.
// Composes all profile sections and owns the data load (parallel customer +
// orders fetch).

import { useState, useEffect, useMemo } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import useConfigLists from '../hooks/useConfigLists.js';
import t from '../translations.js';
import InlineEdit from './InlineEdit.jsx';
import CustomerHeader from './CustomerHeader.jsx';
import CustomerTimeline from './CustomerTimeline.jsx';
import KeyPersonChips from './KeyPersonChips.jsx';

const SEGMENT_OPTIONS = ['', 'New', 'Constant', 'Rare', 'DO NOT CONTACT'];
const LANGUAGE_OPTIONS = ['', 'RU', 'UK', 'PL', 'EN', 'TR'];
// Matches the pill options in Step1Customer.jsx — keep in sync if the set changes.
const SEX_BIZ_OPTIONS = ['', 'Female', 'Male', 'Business'];

// Permissive validators: empty is valid (clearing the field); otherwise must match.
// Phone accepts digits, spaces, +, (), -; at least 5 chars so "1" isn't accepted.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s+()\-]{5,}$/;
const validateEmail = v => (!v || EMAIL_RE.test(v)) ? null : t.invalidEmail;
const validatePhone = v => (!v || PHONE_RE.test(v)) ? null : t.invalidPhone;

export default function CustomerDetailView({ customerId, onUpdate, onNavigate }) {
  const [cust, setCust]       = useState(null);
  const [orders, setOrders]   = useState([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [custRes, ordersRes] = await Promise.all([
          client.get(`/customers/${customerId}`),
          client.get(`/customers/${customerId}/orders`),
        ]);
        if (cancelled) return;
        setCust(custRes.data);
        setOrders(ordersRes.data);
      } catch {
        if (!cancelled) showToast(t.error, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [customerId, showToast]);

  async function patchField(field, value) {
    try {
      await client.patch(`/customers/${customerId}`, { [field]: value });
      setCust(prev => ({ ...prev, [field]: value }));
      onUpdate?.();
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-6 flex justify-center">
        <div className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!cust) return null;

  return (
    <div className="px-4 py-4 space-y-4">
      <CustomerHeader cust={cust} orders={orders} />

      <ContactQuickLinks cust={cust} />

      <StatStrip orders={orders} />

      <ProfileGrid cust={cust} onPatch={patchField} onInvalid={msg => showToast(msg, 'error')} />

      <KeyPersonChips cust={cust} onPatch={patchField} />

      <NotesSection cust={cust} onPatch={patchField} />

      <FlowersOrderedChips orders={orders} />

      <CustomerTimeline orders={orders} onNavigate={onNavigate} />
    </div>
  );
}

// --- Sub-sections kept inline below. Each is single-purpose and reads only
// what it needs from cust/orders. Extracted as named components for clarity
// but not exported — callers compose the whole view, not individual pieces.

function ContactQuickLinks({ cust }) {
  if (!cust.Phone && !cust.Email && !cust.Link) return null;
  return (
    <div className="bg-white/40 rounded-xl px-4 py-3 flex flex-wrap items-center gap-4">
      {cust.Phone && (
        <a
          href={`tel:${cust.Phone.replace(/\s/g, '')}`}
          className="flex items-center gap-1.5 text-sm text-ios-blue font-medium hover:underline"
        >
          <span>📱</span> {cust.Phone}
        </a>
      )}
      {cust.Email && (
        <a
          href={`mailto:${cust.Email}`}
          className="flex items-center gap-1.5 text-sm text-ios-blue font-medium hover:underline"
        >
          <span>✉</span> {cust.Email}
        </a>
      )}
      {cust.Link && (
        <a
          href={cust.Link.startsWith('http') ? cust.Link : `https://instagram.com/${cust.Link.replace(/^@/, '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm text-ios-blue font-medium hover:underline"
        >
          <span>🌐</span> {cust.Link}
        </a>
      )}
    </div>
  );
}

function StatStrip({ orders }) {
  const stats = useMemo(() => {
    if (orders.length === 0) return null;
    const totalSpend = orders.reduce((s, o) => s + (o.amount || 0), 0);
    const avgOrderValue = Math.round(totalSpend / orders.length);

    const sortedDates = orders
      .map(o => new Date(o.date))
      .filter(d => !isNaN(d))
      .sort((a, b) => a - b);
    let avgDaysBetween = 0;
    if (sortedDates.length > 1) {
      const gaps = [];
      for (let i = 1; i < sortedDates.length; i++) {
        gaps.push((sortedDates[i] - sortedDates[i - 1]) / 86400000);
      }
      avgDaysBetween = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
    }

    const sourceCounts = {};
    for (const o of orders) {
      const src = o.raw?.Source || (o.source === 'legacy' ? 'Legacy' : 'Unknown');
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
    }
    const preferredSource =
      Object.entries(sourceCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || '—';

    return { count: orders.length, avgOrderValue, avgDaysBetween, preferredSource };
  }, [orders]);

  if (!stats) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StatCard value={stats.count} label={t.orderCount} />
      <StatCard value={`${stats.avgOrderValue} ${t.zl}`} label={t.avgOrderVal} />
      <StatCard
        value={stats.avgDaysBetween > 0 ? `${stats.avgDaysBetween}${t.daysShort}` : '—'}
        label={t.avgTimeBetween}
      />
      <StatCard value={stats.preferredSource} label={t.preferredChannel} />
    </div>
  );
}

function StatCard({ value, label }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3 text-center">
      <div className="text-lg font-bold text-brand-700">{value}</div>
      <div className="text-xs text-ios-tertiary">{label}</div>
    </div>
  );
}

function ProfileGrid({ cust, onPatch, onInvalid }) {
  const { orderSources } = useConfigLists();

  // Airtable occasionally returns single-element arrays for fields that were
  // linked records at some point in the past — coerce to scalar before using.
  const commCurrent   = scalar(cust['Communication method']);
  const sourceCurrent = scalar(cust['Order Source']);

  // Preserve the currently stored value even if the owner later removed it
  // from Settings — otherwise the select would silently jump to another option.
  const commOptions = useMemo(
    () => dedupe(['', ...orderSources, commCurrent]),
    [orderSources, commCurrent]
  );
  const sourceOptions = useMemo(
    () => dedupe(['', ...orderSources, sourceCurrent]),
    [orderSources, sourceCurrent]
  );

  const sexBizLabels = {
    '':         '—',
    'Female':   t.female,
    'Male':     t.male,
    'Business': t.business,
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      <Field label={t.name}>
        <InlineEdit value={cust.Name || ''} onSave={v => onPatch('Name', v || null)} />
      </Field>
      <Field label={t.nickname}>
        <InlineEdit value={cust.Nickname || ''} onSave={v => onPatch('Nickname', v || null)} />
      </Field>
      <Field label={t.phone}>
        <InlineEdit
          value={cust.Phone || ''}
          type="tel"
          onSave={v => onPatch('Phone', v || null)}
          validate={validatePhone}
          onValidationError={onInvalid}
        />
      </Field>
      <Field label={t.email}>
        <InlineEdit
          value={cust.Email || ''}
          type="email"
          onSave={v => onPatch('Email', v || null)}
          validate={validateEmail}
          onValidationError={onInvalid}
        />
      </Field>
      <Field label={t.instagram}>
        <InlineEdit value={cust.Link || ''} onSave={v => onPatch('Link', v || null)} />
      </Field>
      <Field label={t.segment}>
        <SelectField
          value={cust.Segment}
          onChange={v => onPatch('Segment', v || null)}
          options={SEGMENT_OPTIONS.map(s => ({ value: s, label: s || '—' }))}
        />
      </Field>
      <Field label={t.homeAddress}>
        <InlineEdit value={cust['Home address'] || ''} onSave={v => onPatch('Home address', v || null)} />
      </Field>
      <Field label={t.language}>
        <SelectField
          value={cust.Language}
          onChange={v => onPatch('Language', v || null)}
          options={LANGUAGE_OPTIONS.map(l => ({ value: l, label: l || '—' }))}
        />
      </Field>
      <Field label={t.sex}>
        <SelectField
          value={cust['Sex / Business']}
          onChange={v => onPatch('Sex / Business', v || null)}
          options={SEX_BIZ_OPTIONS.map(s => ({ value: s, label: sexBizLabels[s] || s }))}
        />
      </Field>
      <Field label={t.communicationMethod}>
        <SelectField
          value={commCurrent}
          onChange={v => onPatch('Communication method', v || null)}
          options={commOptions.map(s => ({ value: s, label: s || '—' }))}
        />
      </Field>
      <Field label={t.orderSource}>
        <SelectField
          value={sourceCurrent}
          onChange={v => onPatch('Order Source', v || null)}
          options={sourceOptions.map(s => ({ value: s, label: s || '—' }))}
        />
      </Field>
      <Field label={t.foundUsFrom}>
        <InlineEdit value={cust['Found us from'] || ''} onSave={v => onPatch('Found us from', v || null)} />
      </Field>
    </div>
  );
}

// Controlled <select> wrapper. Coerces value to a scalar string so React
// never sees an array (which triggers a "must be scalar" warning).
function SelectField({ value, onChange, options }) {
  return (
    <select
      value={scalar(value)}
      onChange={e => onChange(e.target.value)}
      className="text-sm field-input w-full"
    >
      {options.map(o => (
        <option key={o.value || 'none'} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function dedupe(arr) {
  const seen = new Set();
  const out  = [];
  for (const v of arr) {
    const k = v == null ? '' : v;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

// Coerce Airtable's mixed scalar/array returns into a single string for
// controlled <select> elements. Empty arrays and nullish values become ''.
function scalar(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v[0] == null ? '' : String(v[0]);
  return String(v);
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs text-ios-tertiary mb-1">{label}</p>
      {children}
    </div>
  );
}

function NotesSection({ cust, onPatch }) {
  return (
    <div>
      <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
        {t.preferences}
      </p>
      <InlineEdit
        value={cust['Notes / Preferences'] || ''}
        onSave={v => onPatch('Notes / Preferences', v || null)}
        multiline
        placeholder={t.noNotes}
      />
    </div>
  );
}

// Aggregates "5x Roses, 3x Tulips" free-text summaries from app orders.
// Legacy orders typically don't parse (free-text descriptions), so the chips
// mostly reflect modern order data.
function FlowersOrderedChips({ orders }) {
  const flowerList = useMemo(() => {
    const map = {};
    for (const o of orders) {
      const summary = o.raw?.['Bouquet Summary'] || '';
      if (!summary) continue;
      for (const part of summary.split(',')) {
        const m = part.trim().match(/^(\d+)\s*[x×]\s*(.+)$/i);
        if (m) {
          const qty = parseInt(m[1], 10);
          const name = m[2].trim();
          map[name] = (map[name] || 0) + qty;
        }
      }
    }
    return Object.entries(map).sort(([, a], [, b]) => b - a).slice(0, 15);
  }, [orders]);

  if (flowerList.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
        {t.flowersOrdered}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {flowerList.map(([name, qty]) => (
          <span
            key={name}
            className="text-xs bg-brand-50 text-brand-700 px-2.5 py-1 rounded-full font-medium"
          >
            {qty}x {name}
          </span>
        ))}
      </div>
    </div>
  );
}
