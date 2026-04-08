// LoginPage — PIN numpad for drivers.
// After successful login, shows "Hello, Piotr" greeting before navigating.
// Same pattern as florist login, but stores driverName in auth context.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import client from '../api/client.js';
import { setClientPin } from '../api/client.js';
import t from '../translations.js';

const DIGITS = [[1,2,3],[4,5,6],[7,8,9]];

export default function LoginPage() {
  const [pin, setPin]         = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const { login }             = useAuth();
  const navigate              = useNavigate();

  async function handleSubmit() {
    if (pin.length < 4) return;
    setError('');
    setLoading(true);
    setClientPin(pin);
    try {
      const res = await client.post('/auth/verify', { pin });
      const { role, driverName } = res.data;
      // Only drivers and owner can use the delivery app — florists have their own app
      if (role === 'florist') {
        throw new Error('wrong_role');
      }
      login(pin, role, driverName);
      navigate('/deliveries', { replace: true });
    } catch {
      setClientPin(null);
      setPin('');
      setError(t.invalidPin);
    } finally {
      setLoading(false);
    }
  }

  function tap(d) {
    if (pin.length < 6) setPin(p => p + d);
  }
  function del() { setPin(p => p.slice(0, -1)); }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      {/* Logo */}
      <div className="mb-10 text-center">
        <img src="/logo.png" alt="Blossom" className="w-44 mx-auto mb-5" />
        <p className="text-ios-tertiary text-base">{t.enterPin}</p>
      </div>

      {/* PIN dots */}
      <div className="flex gap-5 mb-8">
        {[0,1,2,3].map(i => (
          <div
            key={i}
            className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
              i < pin.length ? 'bg-brand-600 scale-110' : 'bg-ios-separator'
            }`}
          />
        ))}
      </div>

      {/* Error */}
      {error && (
        <p className="text-ios-red text-sm text-center mb-6 font-medium">{error}</p>
      )}

      {/* Numpad — large tap targets for phone use */}
      <div className="flex flex-col gap-3 w-full max-w-[280px]">
        {DIGITS.map(row => (
          <div key={row[0]} className="flex gap-3 justify-center">
            {row.map(d => (
              <button
                key={d}
                onPointerDown={() => tap(String(d))}
                className="w-[72px] h-[72px] rounded-full glass-btn text-2xl font-light
                           text-ios-label active:bg-ios-fill2 transition-colors select-none"
              >
                {d}
              </button>
            ))}
          </div>
        ))}
        <div className="flex gap-3 justify-center">
          <div className="w-[72px] h-[72px]" />
          <button
            onPointerDown={() => tap('0')}
            className="w-[72px] h-[72px] rounded-full glass-btn text-2xl font-light
                       text-ios-label active:bg-ios-fill2 transition-colors select-none"
          >
            0
          </button>
          <button
            onPointerDown={del}
            className="w-[72px] h-[72px] rounded-full bg-transparent text-2xl text-ios-tertiary
                       active:bg-ios-fill2 transition-colors select-none flex items-center justify-center"
          >
            ⌫
          </button>
        </div>
      </div>

      {/* Login button */}
      <div className={`mt-8 w-full max-w-[280px] transition-all duration-200 ${
        pin.length >= 4 ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}>
        <button
          onPointerDown={handleSubmit}
          disabled={loading}
          className="w-full h-14 rounded-2xl bg-brand-600 text-white text-base font-semibold
                     active:bg-brand-700 transition-colors shadow-lg"
        >
          {loading ? '...' : t.login}
        </button>
      </div>
    </div>
  );
}
