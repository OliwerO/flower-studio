// CustomerDetailView — right pane of the Customer Tab v2.0 split view.
// Composes all profile sections and owns the data load (parallel customer +
// orders fetch). Replaces the legacy CustomerDetailPanel.jsx once smoke-
// tested — kept side-by-side during the transition so the old component can
// be deleted in a single follow-up commit.

import { useState, useEffect, useMemo } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import InlineEdit from './InlineEdit.jsx';
import CustomerHeader from './CustomerHeader.jsx';
import CustomerTimeline from './CustomerTimeline.jsx';
import KeyPersonChips from './KeyPersonChips.jsx';

const SEGMENT_OPTIONS = ['', 'New', 'Constant', 'Rare', 'DO NOT CONTACT'];

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

      <ProfileGrid cust={cust} onPatch={patchField} />

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

function ProfileGrid({ cust, onPatch }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      <Field label={t.name}>
        <InlineEdit value={cust.Name || ''} onSave={v => onPatch('Name', v || null)} />
      </Field>
      <Field label={t.nickname}>
        <InlineEdit value={cust.Nickname || ''} onSave={v => onPatch('Nickname', v || null)} />
      </Field>
      <Field label={t.phone}>
        <InlineEdit value={cust.Phone || ''} onSave={v => onPatch('Phone', v || null)} />
      </Field>
      <Field label={t.email}>
        <InlineEdit value={cust.Email || ''} onSave={v => onPatch('Email', v || null)} />
      </Field>
      <Field label={t.instagram}>
        <InlineEdit value={cust.Link || ''} onSave={v => onPatch('Link', v || null)} />
      </Field>
      <Field label={t.segment}>
        <select
          value={cust.Segment || ''}
          onChange={e => onPatch('Segment', e.target.value || null)}
          className="text-sm field-input w-full"
        >
          {SEGMENT_OPTIONS.map(s => (
            <option key={s || 'none'} value={s}>{s || '—'}</option>
          ))}
        </select>
      </Field>
      <Field label={t.homeAddress}>
        <InlineEdit value={cust['Home address'] || ''} onSave={v => onPatch('Home address', v || null)} />
      </Field>
      <Field label={t.language}>
        <InlineEdit value={cust.Language || ''} onSave={v => onPatch('Language', v || null)} />
      </Field>
      <Field label={t.foundUsFrom}>
        <InlineEdit value={cust['Found us from'] || ''} onSave={v => onPatch('Found us from', v || null)} />
      </Field>
    </div>
  );
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
