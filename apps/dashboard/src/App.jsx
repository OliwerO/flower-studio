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
  const [missingPin, setMissingPin] = useState(false);

  useEffect(() => {
    // Auto-set PIN from env var — no login screen needed.
    // NEVER fall back to a default PIN — that would be a security hole.
    const pin = import.meta.env.VITE_OWNER_PIN;
    if (!pin) {
      setMissingPin(true);
      return;
    }
    setClientPin(pin);
    setReady(true);
  }, []);

  // Listen for real-time notifications (new Wix orders, etc.)
  useNotifications();

  if (missingPin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <h1 className="text-xl font-bold text-red-600 mb-3">Configuration Error</h1>
          <p className="text-gray-700 mb-2">
            <code className="bg-gray-100 px-2 py-0.5 rounded text-sm">VITE_OWNER_PIN</code> environment variable is not set.
          </p>
          <p className="text-gray-500 text-sm">
            Add it to <code className="bg-gray-100 px-1 rounded">.env</code> or set it in your deployment environment.
          </p>
        </div>
      </div>
    );
  }

  if (!ready) return null;

  return (
    <>
      <Toast />
      <DashboardPage />
    </>
  );
}
