// DeliveryListPage — the driver's dispatch board.
// Shows today's deliveries grouped by status: Pending → Out for Delivery → Delivered.
// Think of it as a Kanban board with three columns, but displayed as a scrollable phone list.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { LangToggle } from '../context/LanguageContext.jsx';
import client from '../api/client.js';
import t from '../translations.js';
import DeliveryCard from '../components/DeliveryCard.jsx';
import DeliverySheet from '../components/DeliverySheet.jsx';
import DeliveryResultPicker from '../components/DeliveryResultPicker.jsx';
import { DeliveryListSkeleton } from '../components/Skeleton.jsx';
import MapView from '../components/MapView.jsx';
import HelpPanel from '../components/HelpPanel.jsx';
import { useNotifications } from '../hooks/useNotifications.js';

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function formatDateHeader() {
  const d = new Date();
  const days = t.dayNamesShort;
  const months = t.monthNamesShort;
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

export default function DeliveryListPage() {
  const navigate = useNavigate();
  const { driverName, logout } = useAuth();
  const { showToast } = useToast();

  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [showMap, setShowMap]       = useState(false);
  const [showHelp, setShowHelp]     = useState(false);
  const [pickupCount, setPickupCount] = useState(0);
  // Track which delivery is awaiting a result selection (replaces window.confirm)
  const [resultPickerId, setResultPickerId] = useState(null);

  const fetchDeliveries = useCallback(async () => {
    setLoading(true);
    try {
      // Range fetch: today onward, restricted to this driver. Backend supports
      // `from` without `to` as "from this date forward" so future-assigned
      // deliveries also show up — the driver sees their full upcoming queue.
      const params = { from: todayStr() };
      if (driverName) params.driver = driverName;
      const res = await client.get('/deliveries', { params });
      setDeliveries(res.data);
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [driverName, showToast]);

  useEffect(() => { fetchDeliveries(); }, [fetchDeliveries]);

  // Auto-refresh when tab becomes visible (driver switches back from Maps/WhatsApp)
  useEffect(() => {
    function onVisible() {
      if (!document.hidden) fetchDeliveries();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchDeliveries]);

  // Refresh delivery list when status changes come via SSE from other apps
  useNotifications(!!driverName, (event) => {
    if (event.type === 'order_status_changed' || event.type === 'order_ready') {
      fetchDeliveries();
    }
    // Owner uploaded/removed a bouquet thumbnail in the dashboard or florist
    // app — patch every delivery whose linked order points at this Wix
    // product so the new image (or its absence) shows up without reload.
    if (event.type === 'product_image_changed') {
      setDeliveries(prev => prev.map(d =>
        d.wixProductId && d.wixProductId === event.wixProductId
          ? { ...d, bouquetImageUrl: event.imageUrl || '' }
          : d
      ));
    }
  });

  // Check for assigned stock pickups
  useEffect(() => {
    Promise.all([
      client.get('/stock-orders?status=Sent').catch(() => ({ data: [] })),
      client.get('/stock-orders?status=Shopping').catch(() => ({ data: [] })),
    ]).then(([sent, shopping]) => {
      setPickupCount(sent.data.length + shopping.data.length);
    });
  }, []);

  // Split deliveries into "today" vs "upcoming" first, then group today by status.
  // Today gets the rich Pending/Out/Delivered breakdown the driver works against;
  // upcoming is a flat date-grouped preview of future-assigned work.
  const today = todayStr();
  const { todayGrouped, upcomingByDate } = useMemo(() => {
    const todayList = [];
    const futureList = [];
    for (const d of deliveries) {
      const ddate = d['Delivery Date'] || '';
      if (!ddate || ddate === today) todayList.push(d);
      else if (ddate > today) futureList.push(d);
      // Past dates with this driver could appear if a delivery slipped — surface
      // them with today so they aren't silently dropped.
      else todayList.push(d);
    }

    const groups = {
      'Pending':          [],
      'Out for Delivery': [],
      'Delivered':        [],
    };
    todayList.forEach(d => {
      const status = d['Status'] || 'Pending';
      if (groups[status]) groups[status].push(d);
      else groups['Pending'].push(d);
    });
    const prioritySort = (a, b) => {
      const aIsMine = a['Assigned Driver'] === driverName ? 0 : 1;
      const bIsMine = b['Assigned Driver'] === driverName ? 0 : 1;
      if (aIsMine !== bIsMine) return aIsMine - bIsMine;
      return (a['Delivery Time'] || '').localeCompare(b['Delivery Time'] || '');
    };
    groups['Pending'].sort(prioritySort);
    groups['Out for Delivery'].sort(prioritySort);
    groups['Delivered'].sort(prioritySort);

    // Group future deliveries by date so the driver sees Tomorrow / Day after / ...
    const byDate = {};
    futureList.sort((a, b) =>
      (a['Delivery Date'] || '').localeCompare(b['Delivery Date'] || '') ||
      (a['Delivery Time'] || '').localeCompare(b['Delivery Time'] || '')
    );
    for (const d of futureList) {
      const k = d['Delivery Date'];
      if (!byDate[k]) byDate[k] = [];
      byDate[k].push(d);
    }

    return { todayGrouped: groups, upcomingByDate: byDate };
  }, [deliveries, driverName, today]);

  const grouped = todayGrouped;

  const selectedDelivery = deliveries.find(d => d.id === selectedId);

  // Standard status change — optimistic update, revert on failure
  async function updateStatus(id, newStatus) {
    const patch = { Status: newStatus };
    if (newStatus === 'Delivered') patch['Delivery Result'] = 'Success';
    // Optimistic: apply immediately
    const prevDeliveries = deliveries;
    setDeliveries(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
    if (newStatus === 'Delivered') setSelectedId(null);
    try {
      const res = await client.patch(`/deliveries/${id}`, patch);
      setDeliveries(prev => prev.map(d => d.id === id ? { ...d, ...res.data } : d));
    } catch (err) {
      // Revert on failure
      setDeliveries(prevDeliveries);
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  // "Problem" button → opens result picker for non-success outcomes
  function openProblemPicker(id) {
    setResultPickerId(id);
  }

  // Called when driver picks a problem reason from the DeliveryResultPicker
  async function handleDeliveryProblem(result) {
    const id = resultPickerId;
    setResultPickerId(null);
    const patch = { Status: 'Delivered', 'Delivery Result': result };
    // Optimistic
    const prevDeliveries = deliveries;
    setDeliveries(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
    setSelectedId(null);
    try {
      const res = await client.patch(`/deliveries/${id}`, patch);
      setDeliveries(prev => prev.map(d => d.id === id ? { ...d, ...res.data } : d));
    } catch (err) {
      setDeliveries(prevDeliveries);
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  async function saveNote(id, note) {
    try {
      await client.patch(`/deliveries/${id}`, { 'Driver Notes': note });
      setDeliveries(prev => prev.map(d => d.id === id ? { ...d, 'Driver Notes': note } : d));
      showToast(t.noteSaved);
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  // Deliveries that need to appear on the map (not yet delivered)
  const activeDeliveries = useMemo(
    () => deliveries.filter(d => d['Status'] !== 'Delivered'),
    [deliveries]
  );

  const pendingCount = grouped['Pending'].length;
  const outCount     = grouped['Out for Delivery'].length;
  const doneCount    = grouped['Delivered'].length;

  if (showMap) {
    return (
      <MapView
        deliveries={activeDeliveries}
        onBack={() => setShowMap(false)}
      />
    );
  }

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <div className="glass-nav sticky top-0 z-30 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-ios-label">{t.deliveries}</h1>
            <p className="text-xs text-ios-tertiary">{formatDateHeader()} · {driverName || t.driver}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowHelp(true)}
              className="text-xs font-bold w-7 h-7 rounded-lg bg-gray-100 text-ios-secondary
                         hover:bg-gray-200 active-scale flex items-center justify-center"
            >?</button>
            <LangToggle />
            <button
              onClick={fetchDeliveries}
              className="text-xs text-brand-600 font-medium px-2 py-1 rounded-lg active:bg-gray-100 active-scale"
            >
              ↻ {t.refreshList}
            </button>
            <button
              onClick={logout}
              className="text-xs text-ios-tertiary font-medium px-2 py-1 rounded-lg active:bg-gray-100"
            >
              {t.logout}
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-5">
        {/* Stock pickup banner */}
        {pickupCount > 0 && (
          <button
            onClick={() => navigate('/stock-pickup')}
            className="w-full flex items-center justify-between bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 active-scale"
          >
            <span className="text-sm font-semibold text-blue-700">
              {pickupCount} {t.stockPickupBanner}
            </span>
            <span className="text-blue-600 text-sm font-medium">{t.goToPickup} →</span>
          </button>
        )}

        {loading ? (
          <DeliveryListSkeleton count={4} />
        ) : deliveries.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">📦</p>
            <p className="text-ios-tertiary">{t.noDeliveries}</p>
          </div>
        ) : (
          <>
            {/* Pending */}
            {grouped['Pending'].length > 0 && (
              <section>
                <p className="ios-label flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-ios-orange" />
                  {t.pending} ({pendingCount})
                </p>
                <div className="space-y-2">
                  {grouped['Pending'].map(d => (
                    <DeliveryCard
                      key={d.id}
                      delivery={d}
                      onTap={() => setSelectedId(d.id)}
                      onStatusChange={(status) => updateStatus(d.id, status)}
                      onProblem={() => openProblemPicker(d.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Out for Delivery */}
            {grouped['Out for Delivery'].length > 0 && (
              <section>
                <p className="ios-label flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-ios-blue" />
                  {t.outForDelivery} ({outCount})
                </p>
                <div className="space-y-2">
                  {grouped['Out for Delivery'].map(d => (
                    <DeliveryCard
                      key={d.id}
                      delivery={d}
                      onTap={() => setSelectedId(d.id)}
                      onStatusChange={(status) => updateStatus(d.id, status)}
                      onProblem={() => openProblemPicker(d.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Delivered */}
            {grouped['Delivered'].length > 0 && (
              <section>
                <p className="ios-label flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-ios-green" />
                  {t.delivered} ({doneCount})
                </p>
                <div className="space-y-2">
                  {grouped['Delivered'].map(d => (
                    <DeliveryCard
                      key={d.id}
                      delivery={d}
                      onTap={() => setSelectedId(d.id)}
                      dimmed
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Upcoming — future-dated deliveries assigned to this driver,
                grouped by date so they can plan ahead. */}
            {Object.keys(upcomingByDate).length > 0 && (
              <section>
                <p className="ios-label flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  {t.upcoming}
                </p>
                {Object.entries(upcomingByDate).map(([date, list]) => (
                  <div key={date} className="space-y-2 mb-4">
                    <p className="text-xs font-semibold text-ios-tertiary uppercase mt-2">
                      {date} ({list.length})
                    </p>
                    {list.map(d => (
                      <DeliveryCard
                        key={d.id}
                        delivery={d}
                        onTap={() => setSelectedId(d.id)}
                        dimmed
                      />
                    ))}
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>

      {/* Bottom bar — Map view button */}
      {activeDeliveries.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 p-4 pb-6 bg-gradient-to-t from-[#F0F2F5] to-transparent">
          <button
            onClick={() => setShowMap(true)}
            className="w-full h-12 rounded-2xl bg-brand-600 text-white text-sm font-semibold
                       flex items-center justify-center gap-2 active:bg-brand-700 active-scale shadow-lg"
          >
            🗺 {t.viewOnMap}
          </button>
        </div>
      )}

      {/* Detail sheet */}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}

      {selectedDelivery && (
        <DeliverySheet
          delivery={selectedDelivery}
          onClose={() => setSelectedId(null)}
          onStatusChange={(status) => updateStatus(selectedDelivery.id, status)}
          onProblem={() => openProblemPicker(selectedDelivery.id)}
          onSaveNote={(note) => saveNote(selectedDelivery.id, note)}
        />
      )}

      {/* Problem picker — shown when driver taps "Problem" button */}
      {resultPickerId && (
        <DeliveryResultPicker
          onSelect={handleDeliveryProblem}
          onCancel={() => setResultPickerId(null)}
        />
      )}
    </div>
  );
}
