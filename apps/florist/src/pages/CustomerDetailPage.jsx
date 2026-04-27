// CustomerDetailPage — mobile full-page customer detail.
// Reads :id from the route, resolves canEdit from role (owner → true,
// florist → false), and wraps CustomerDetailView. Back button routes
// to /customers (the list) so the owner's scroll position is preserved
// by React Router when returning.
//
// onNavigate is translated from the dashboard's `{ tab: 'orders', filter }`
// shape into a plain route push — the component doesn't care, it just
// hands us the orderId to open.

import { useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from '@flower-studio/shared';
import { useAuth } from '../context/AuthContext.jsx';
import CustomerDetailView from '../components/CustomerDetailView.jsx';
import t from '../translations.js';

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();

  const canEdit = role === 'owner';

  // Dashboard's onNavigate contract is `{ tab, filter: { orderId } }`.
  // On mobile we just push the route. CustomerTimeline only calls this
  // for app orders (not legacy), so a direct /orders/:id push always works.
  const onNavigate = useCallback((payload) => {
    const orderId = payload?.filter?.orderId;
    if (orderId) navigate(`/orders/${orderId}`);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-ios-bg dark:bg-dark-bg pb-16">
      {/* Sticky header */}
      <header className="sticky top-0 z-20 glass-nav safe-area-top px-2 py-2 flex items-center gap-2">
        <IconButton onClick={() => navigate('/customers')} ariaLabel={t.back || 'Back'}>
          <ArrowLeft size={22} />
        </IconButton>
        <h1 className="text-base font-semibold text-ios-label dark:text-dark-label flex-1">
          {t.customer || 'Customer'}
        </h1>
      </header>

      <CustomerDetailView
        customerId={id}
        canEdit={canEdit}
        onNavigate={onNavigate}
      />
    </div>
  );
}
