// App.jsx — Dashboard auto-authenticates with the owner PIN.
// No login screen needed — only the owner accesses this app.
// The PIN is read from VITE_OWNER_PIN env var (set in .env or at deploy time).

import { useEffect, useState } from 'react';
import { setClientPin } from './api/client.js';
import { useNotifications } from './hooks/useNotifications.js';
import DashboardPage from './pages/DashboardPage.jsx';
import Toast from './components/Toast.jsx';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Auto-set PIN from env var — no login screen needed
    const pin = import.meta.env.VITE_OWNER_PIN || '1234';
    setClientPin(pin);
    setReady(true);
  }, []);

  // Listen for real-time notifications (new Wix orders, etc.)
  useNotifications();

  if (!ready) return null;

  return (
    <>
      <Toast />
      <DashboardPage />
    </>
  );
}
