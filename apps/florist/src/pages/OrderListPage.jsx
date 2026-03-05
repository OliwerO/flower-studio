import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import client from '../api/client.js';
import OrderCard from '../components/OrderCard.jsx';
import OrderDetailSheet from '../components/OrderDetailSheet.jsx';
import t from '../translations.js';

const STATUSES = ['', 'New', 'In Progress', 'Ready', 'Delivered', 'Picked Up', 'Cancelled'];

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

export default function OrderListPage() {
  const navigate         = useNavigate();
  const { logout }       = useAuth();
  const [orders, setOrders]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [date, setDate]             = useState(todayISO());
  const [status, setStatus]         = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (status) params.status = status;
      if (date)   { params.dateFrom = date; params.dateTo = date; }
      const res = await client.get('/orders', { params });
      setOrders(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [date, status]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  return (
    <div className="min-h-screen">

      {/* Navigation bar */}
      <header className="glass-nav px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <img src="/logo.png" alt="Blossom" className="h-7" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/stock')}
              className="text-brand-600 text-sm font-medium px-3 py-1.5 rounded-full bg-brand-50 active:bg-brand-100"
            >
              {t.navStock}
            </button>
            <button
              onClick={logout}
              className="text-ios-tertiary text-sm px-2 py-1.5"
            >
              {t.logout}
            </button>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="px-4 py-3 max-w-2xl mx-auto flex gap-2 items-center flex-wrap">
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="h-9 px-3 rounded-full bg-white border border-ios-separator text-sm shadow-sm"
        />
        <div className="flex gap-1.5 bg-white rounded-full border border-ios-separator shadow-sm p-1 overflow-x-auto">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 h-7 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                status === s
                  ? 'bg-brand-600 text-white'
                  : 'text-ios-secondary active:bg-ios-fill'
              }`}
            >
              {s || t.allStatuses}
            </button>
          ))}
        </div>
        <button onClick={fetchOrders} className="h-9 w-9 rounded-full bg-white border border-ios-separator shadow-sm flex items-center justify-center text-ios-tertiary active:bg-ios-fill">
          ↻
        </button>
      </div>

      {/* List */}
      <main className="px-4 pb-28 max-w-2xl mx-auto">
        {loading ? (
          <div className="flex items-center justify-center mt-20">
            <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center mt-20">
            <p className="text-4xl mb-3">🌸</p>
            <p className="text-ios-tertiary">{t.noOrders}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 mt-1">
            {orders.map(order => (
              <OrderCard key={order.id} order={order} onClick={() => setSelectedId(order.id)} />
            ))}
          </div>
        )}
      </main>

      {/* FAB */}
      <button
        onClick={() => navigate('/orders/new')}
        className="fixed bottom-8 right-5 w-14 h-14 bg-brand-600 text-white text-3xl
                   rounded-full shadow-lg flex items-center justify-center
                   active:bg-brand-700 active-scale"
        aria-label={t.newOrder}
      >
        +
      </button>

      {/* Order detail sheet */}
      {selectedId && (
        <OrderDetailSheet
          orderId={selectedId}
          onClose={() => setSelectedId(null)}
          onOrderUpdated={(id, patch) => {
            setOrders(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));
          }}
        />
      )}
    </div>
  );
}
