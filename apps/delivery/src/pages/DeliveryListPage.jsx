// DeliveryListPage — the driver's dispatch board.
// Shows today's deliveries grouped by status: Pending → Out for Delivery → Delivered.
// Think of it as a Kanban board with three columns, but displayed as a scrollable phone list.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import client from '../api/client.js';
import t from '../translations.js';
import DeliveryCard from '../components/DeliveryCard.jsx';
import DeliverySheet from '../components/DeliverySheet.jsx';
import MapView from '../components/MapView.jsx';

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function formatDateHeader() {
  const d = new Date();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

export default function DeliveryListPage() {
  const { driverName, logout } = useAuth();
  const { showToast } = useToast();

  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [showMap, setShowMap]       = useState(false);

  const fetchDeliveries = useCallback(async () => {
    setLoading(true);
    try {
      const params = { date: todayStr() };
      const res = await client.get('/deliveries', { params });
      setDeliveries(res.data);
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [driverName, showToast]);

  useEffect(() => { fetchDeliveries(); }, [fetchDeliveries]);

  // Group deliveries by status — like sorting items into three bins
  const grouped = useMemo(() => {
    const groups = {
      'Pending':          [],
      'Out for Delivery': [],
      'Delivered':        [],
    };
    deliveries.forEach(d => {
      const status = d['Status'] || 'Pending';
      if (groups[status]) groups[status].push(d);
      else groups['Pending'].push(d);
    });
    // Sort non-delivered by time
    const timeSort = (a, b) => (a['Delivery Time'] || '').localeCompare(b['Delivery Time'] || '');
    groups['Pending'].sort(timeSort);
    groups['Out for Delivery'].sort(timeSort);
    groups['Delivered'].sort(timeSort);
    return groups;
  }, [deliveries]);

  const selectedDelivery = deliveries.find(d => d.id === selectedId);

  async function updateStatus(id, newStatus) {
    try {
      const res = await client.patch(`/deliveries/${id}`, { Status: newStatus });
      setDeliveries(prev => prev.map(d => d.id === id ? { ...d, ...res.data } : d));
      showToast(`${newStatus}!`);
      if (newStatus === 'Delivered') setSelectedId(null);
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  async function saveNote(id, note) {
    try {
      await client.patch(`/deliveries/${id}`, { 'Driver Notes': note });
      setDeliveries(prev => prev.map(d => d.id === id ? { ...d, 'Driver Notes': note } : d));
      showToast('Note saved');
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
            <p className="text-xs text-ios-tertiary">{formatDateHeader()} · {driverName || 'Driver'}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchDeliveries}
              className="text-xs text-brand-600 font-medium px-2 py-1 rounded-lg active:bg-white/40 active-scale"
            >
              ↻ {t.refreshList}
            </button>
            <button
              onClick={logout}
              className="text-xs text-ios-tertiary font-medium px-2 py-1 rounded-lg active:bg-white/40"
            >
              {t.logout}
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-5">
        {loading ? (
          <p className="text-center text-ios-tertiary py-12">{t.loading}</p>
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
          </>
        )}
      </div>

      {/* Bottom bar — Map view button */}
      {activeDeliveries.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 p-4 pb-6 bg-gradient-to-t from-[#F2CAD5] to-transparent">
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
      {selectedDelivery && (
        <DeliverySheet
          delivery={selectedDelivery}
          onClose={() => setSelectedId(null)}
          onStatusChange={(status) => updateStatus(selectedDelivery.id, status)}
          onSaveNote={(note) => saveNote(selectedDelivery.id, note)}
        />
      )}
    </div>
  );
}
