// ThemeContext — dark mode toggle with system preference detection + localStorage persistence.
// Like a light switch with memory: remembers your last setting, defaults to ambient light level.

import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext({ dark: false, toggle: () => {} });

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches || false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add('dark');
      document.body.style.background = '#1C1C1E';
    } else {
      root.classList.remove('dark');
      document.body.style.background = '#F0F2F5';
    }
  }, [dark]);

  // Listen for system preference changes (auto mode)
  useEffect(() => {
    const stored = localStorage.getItem('theme');
    if (stored) return; // manual override — don't follow system
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  function toggle() {
    setDark(prev => {
      const next = !prev;
      localStorage.setItem('theme', next ? 'dark' : 'light');
      return next;
    });
  }

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
