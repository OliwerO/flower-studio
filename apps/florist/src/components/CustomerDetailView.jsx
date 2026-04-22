// CustomerDetailView — mobile single-column customer detail.
// Composes CustomerHeader, contact links, stats, profile grid, key people,
// notes, flowers ordered, and the timeline. Owns the parallel customer +
// orders fetch.
//
// Ported 2026-04-22 from apps/dashboard/src/components/CustomerDetailView.jsx
// with two florist-specific adaptations:
//
//   1. `canEdit` prop gates every InlineEdit/SelectField so florist role
//      sees the same data as owner but can't trigger a PATCH. When
//      canEdit=false, field values render as plain text spans. The gate
//      runs at the field level so any leaked edit affordance would stand
//      out in review — not relying on some higher-up conditional.
//
//   2. Grid collapses to 2 columns on mobile (dashboard used 2/3). The
//      rest of the JSX mirrors the dashboard so a future extraction to
//      @flower-studio/shared is mostly stylesheet work, not logic work.

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
const SEX_BIZ_OPTIONS = ['', 'Female', 'Male', 'Business'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s+()\-]{5,}$/;
const validateEmail = v => (!v || EMAIL_RE.test(v)) ? null : (t.invalidEmail || 'Invalid email');
const validatePhone = v => (!v || PHONE_RE.test(v)) ? null : (t.invalidPhone || 'Invalid phone');

export default function CustomerDetailView({
  customerId,
  canEdit = false,
  onLocalPatch,
  onNavigate,
}) {
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
        if (!cancelled) showToast(t.loadError || 'Failed to load', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [customerId, showToast]);

  async function patchField(field, value) {
    // Guard — belt-and-braces alongside the UI-level canEdit gate. If a
    // render slip ever calls patchField from a view-only context, this
    // stops the PATCH before it hits the wire.
    if (!canEdit) return;
    try {
      await client.patch(`/customers/${customerId}`, { [field]: value });
      setCust(prev => ({ ...prev, [field]: value }));
      onLocalPatch?.(customerId, { [field]: value });
    } catch (err) {
      showToast(err.response?.data?.error || (t.updateError || 'Update failed'), 'error');
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

      <ProfileGrid
        cust={cust}
        onPatch={patchField}
        onInvalid={msg => showToast(msg, 'error')}
        canEdit={canEdit}
      />

      <KeyPersonChips cust={cust} onPatch={patchField} canEdit={canEdit} />

      <NotesSection cust={cust} onPatch={patchField} canEdit={canEdit} />

      <FlowersOrderedChips orders={orders} />

      <CustomerTimeline orders={orders} onNavigate={onNavigate} />
    </div>
  );
}

// ── Inline sub-sections ─────────────────────────────────────

function ContactQuickLinks({ cust }) {
  if (!cust.Phone && !cust.Email && !cust.Link) return null;
  return (
    <div className="bg-white/40 rounded-xl px-4 py-3 flex flex-wrap items-center gap-4">
      {cust.Phone && (
        <a
          href={`tel:${cust.Phone.replace(/\s/g, '')}`}
          className="flex items-center gap-1.5 text-sm text-ios-blue font-medium active:underline"
        >
          <span>📱</span> {cust.Phone}
        </a>
      )}
      {cust.Email && (
        <a
          href={`mailto:${cust.Email}`}
          className="flex items-center gap-1.5 text-sm text-ios-blue font-medium active:underline"
        >
          <span>✉</span> {cust.Email}
        </a>
      )}
      {cust.Link && (
        <a
          href={cust.Link.startsWith('http') ? cust.Link : `https://instagram.com/${cust.Link.replace(/^@/, '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm text-ios-blue font-medium active:underline"
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
    <div className="grid grid-cols-2 gap-2">
      <StatCard value={stats.count} label={t.orderCount || 'Orders'} />
      <StatCard value={`${stats.avgOrderValue} ${t.zl || 'zł'}`} label={t.avgOrderVal || 'Avg value'} />
      <StatCard
        value={stats.avgDaysBetween > 0 ? `${stats.avgDaysBetween}${t.daysShort || 'd'}` : '—'}
        label={t.avgTimeBetween || 'Avg between'}
      />
      <StatCard value={stats.preferredSource} label={t.preferredChannel || 'Preferred'} />
    </div>
  );
}

function StatCard({ value, label }) {
  return (
    <div className="bg-gray-50 dark:bg-dark-elevated rounded-xl p-3 text-center">
      <div className="text-lg font-bold text-brand-700 dark:text-brand-400">{value}</div>
      <div className="text-[11px] text-ios-tertiary">{label}</div>
    </div>
  );
}

function ProfileGrid({ cust, onPatch, onInvalid, canEdit }) {
  const { orderSources } = useConfigLists();

  const commCurrent   = scalar(cust['Communication method']);
  const sourceCurrent = scalar(cust['Order Source']);

  const commOptions = useMemo(
    () => dedupe(['', ...(orderSources || []), commCurrent]),
    [orderSources, commCurrent]
  );
  const sourceOptions = useMemo(
    () => dedupe(['', ...(orderSources || []), sourceCurrent]),
    [orderSources, sourceCurrent]
  );

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t.labelName || 'Name'}>
        <EditOrText canEdit={canEdit} value={cust.Name}>
          <InlineEdit value={cust.Name || ''} onSave={v => onPatch('Name', v || null)} />
        </EditOrText>
      </Field>
      <Field label={t.nickname || 'Nickname'}>
        <EditOrText canEdit={canEdit} value={cust.Nickname}>
          <InlineEdit value={cust.Nickname || ''} onSave={v => onPatch('Nickname', v || null)} />
        </EditOrText>
      </Field>
      <Field label={t.labelPhone || 'Phone'}>
        <EditOrText canEdit={canEdit} value={cust.Phone}>
          <InlineEdit
            value={cust.Phone || ''}
            type="tel"
            onSave={v => onPatch('Phone', v || null)}
            validate={validatePhone}
            onValidationError={onInvalid}
          />
        </EditOrText>
      </Field>
      <Field label={t.customerEmail || 'Email'}>
        <EditOrText canEdit={canEdit} value={cust.Email}>
          <InlineEdit
            value={cust.Email || ''}
            type="email"
            onSave={v => onPatch('Email', v || null)}
            validate={validateEmail}
            onValidationError={onInvalid}
          />
        </EditOrText>
      </Field>
      <Field label={t.instagram || 'Instagram'}>
        <EditOrText canEdit={canEdit} value={cust.Link}>
          <InlineEdit value={cust.Link || ''} onSave={v => onPatch('Link', v || null)} />
        </EditOrText>
      </Field>
      <Field label={t.segment || 'Segment'}>
        <SelectOrText
          canEdit={canEdit}
          value={cust.Segment}
          options={SEGMENT_OPTIONS.map(s => ({ value: s, label: s || '—' }))}
          onChange={v => onPatch('Segment', v || null)}
        />
      </Field>
      <Field label={t.homeAddress || 'Home address'}>
        <EditOrText canEdit={canEdit} value={cust['Home address']}>
          <InlineEdit value={cust['Home address'] || ''} onSave={v => onPatch('Home address', v || null)} />
        </EditOrText>
      </Field>
      <Field label={t.language || 'Language'}>
        <SelectOrText
          canEdit={canEdit}
          value={cust.Language}
          options={LANGUAGE_OPTIONS.map(l => ({ value: l, label: l || '—' }))}
          onChange={v => onPatch('Language', v || null)}
        />
      </Field>
      <Field label={t.sexBusiness || t.sex || 'Sex / Business'}>
        <SelectOrText
          canEdit={canEdit}
          value={cust['Sex / Business']}
          options={SEX_BIZ_OPTIONS.map(s => ({ value: s, label: s || '—' }))}
          onChange={v => onPatch('Sex / Business', v || null)}
        />
      </Field>
      <Field label={t.commMethod || t.communicationMethod || 'Communication'}>
        <SelectOrText
          canEdit={canEdit}
          value={commCurrent}
          options={commOptions.map(s => ({ value: s, label: s || '—' }))}
          onChange={v => onPatch('Communication method', v || null)}
        />
      </Field>
      <Field label={t.orderSource || 'Order source'}>
        <SelectOrText
          canEdit={canEdit}
          value={sourceCurrent}
          options={sourceOptions.map(s => ({ value: s, label: s || '—' }))}
          onChange={v => onPatch('Order Source', v || null)}
        />
      </Field>
      <Field label={t.foundUsFrom || 'Found us from'}>
        <EditOrText canEdit={canEdit} value={cust['Found us from']}>
          <InlineEdit value={cust['Found us from'] || ''} onSave={v => onPatch('Found us from', v || null)} />
        </EditOrText>
      </Field>
    </div>
  );
}

// EditOrText: renders the edit UI when canEdit, else renders value as plain
// text. Keeps the view-only branch alongside the edit branch in every field
// so a scan of the grid spots any missing gate immediately.
function EditOrText({ canEdit, value, children }) {
  if (canEdit) return children;
  return <p className="text-sm text-ios-label">{value || '—'}</p>;
}

function SelectOrText({ canEdit, value, options, onChange }) {
  if (!canEdit) {
    const scalarVal = scalar(value);
    const matched = options.find(o => o.value === scalarVal);
    return <p className="text-sm text-ios-label">{matched?.label || scalarVal || '—'}</p>;
  }
  return (
    <select
      value={scalar(value)}
      onChange={e => onChange(e.target.value)}
      className="text-sm w-full px-2 py-1 rounded border border-gray-300 bg-white text-ios-label focus:border-brand-500 focus:outline-none"
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

function NotesSection({ cust, onPatch, canEdit }) {
  const notes = cust['Notes / Preferences'] || '';
  return (
    <div>
      <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
        {t.preferences || 'Preferences'}
      </p>
      {canEdit ? (
        <InlineEdit
          value={notes}
          onSave={v => onPatch('Notes / Preferences', v || null)}
          multiline
          placeholder={t.noNotes || 'No notes yet'}
        />
      ) : (
        <p className="text-sm text-ios-label whitespace-pre-wrap">
          {notes || (t.noNotes || 'No notes yet')}
        </p>
      )}
    </div>
  );
}

// Aggregates "5x Roses, 3x Tulips" free-text summaries from app orders.
// Pure display — no edit path, so no canEdit branch needed.
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
        {t.flowersOrdered || 'Flowers ordered'}
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
