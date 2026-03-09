import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import StockItem from '../components/StockItem.jsx';
import ReceiveStockForm from '../components/ReceiveStockForm.jsx';
import HelpPanel from '../components/HelpPanel.jsx';
import t from '../translations.js';

export default function StockPanelPage() {
  const navigate          = useNavigate();
  const { showToast }     = useToast();
  const { role }          = useAuth();
  const [stock, setStock] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showReceive, setShowReceive] = useState(false);
  const [editMode, setEditMode]       = useState(false);
  const [showHelp, setShowHelp]       = useState(false);

  async function fetchStock() {
    setLoading(true);
    try {
      const res = await client.get('/stock');
      setStock(res.data);
    } catch { showToast(t.adjustError, 'error'); }
    finally   { setLoading(false); }
  }

  useEffect(() => { fetchStock(); }, []);

  async function handleAdjust(id, delta) {
    try {
      const res = await client.post(`/stock/${id}/adjust`, { delta });
      setStock(prev => prev.map(s => s.id === id ? { ...s, ...res.data } : s));
    } catch { showToast(t.adjustError, 'error'); }
  }

  async function handleWriteOff(id, quantity, reason) {
    try {
      const res = await client.post(`/stock/${id}/write-off`, { quantity, reason: reason || undefined });
      setStock(prev => prev.map(s => s.id === id ? { ...s, ...res.data } : s));
      showToast(`${quantity} stems written off`, 'success');
    } catch { showToast(t.writeOffError, 'error'); }
  }

  async function handleReceive(data) {
    try {
      await client.post('/stock-purchases', data);
      showToast(t.success, 'success');
      setShowReceive(false);
      fetchStock();
    } catch { showToast(t.receiveError, 'error'); }
  }

  const grouped = stock.reduce((acc, s) => {
    const cat = s['Category'] || 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  return (
    <div className="min-h-screen">

      {/* Nav */}
      <header className="glass-nav px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <button onClick={() => navigate('/orders')} className="text-brand-600 font-medium text-base active-scale">
            ‹ {t.navOrders}
          </button>
          <h1 className="text-base font-semibold text-ios-label">{t.stockTitle}</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHelp(true)}
              className="text-xs font-bold w-7 h-7 rounded-lg bg-gray-100 text-ios-secondary
                         hover:bg-gray-200 active-scale flex items-center justify-center"
            >?</button>
            <button onClick={fetchStock} className="text-ios-tertiary text-base active-scale">↻</button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 pb-28">

        {/* Receive stock */}
        <button
          onClick={() => setShowReceive(!showReceive)}
          className={`w-full mb-4 h-12 rounded-2xl text-base font-semibold transition-colors ${
            showReceive
              ? 'bg-ios-fill2 text-ios-secondary'
              : 'bg-brand-600 text-white shadow-sm active:bg-brand-700'
          }`}
        >
          {showReceive ? `✕ ${t.cancel}` : `+ ${t.receiveStock}`}
        </button>

        {showReceive && (
          <div className="mb-5">
            <ReceiveStockForm stock={stock} onSave={handleReceive} onCancel={() => setShowReceive(false)} />
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center mt-20">
            <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : (
          Object.entries(grouped).map(([category, items]) => (
            <div key={category} className="mb-5">
              <p className="ios-label">{category}</p>
              <div className="ios-card overflow-hidden divide-y divide-ios-separator/40">
                {items.map(item => (
                  <StockItem key={item.id} item={item} editMode={editMode} onAdjust={delta => handleAdjust(item.id, delta)} onWriteOff={(qty, reason) => handleWriteOff(item.id, qty, reason)} />
                ))}
              </div>
            </div>
          ))
        )}

        {/* Owner-only edit mode toggle */}
        {role === 'owner' && !loading && (
          <button
            onClick={() => setEditMode(!editMode)}
            className={`w-full mt-4 h-11 rounded-2xl text-sm font-semibold transition-colors ${
              editMode
                ? 'bg-brand-600 text-white active:bg-brand-700'
                : 'bg-ios-fill2 text-ios-secondary active:bg-ios-separator'
            }`}
          >
            {editMode ? `✓ ${t.doneEditing}` : `✎ ${t.editStock}`}
          </button>
        )}
      </main>

      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
    </div>
  );
}
