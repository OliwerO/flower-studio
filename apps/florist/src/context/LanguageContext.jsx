// LanguageContext — a factory-wide switch that flips all display boards
// between Russian and English. Components don't need to know about it;
// they just read `t.keyName` as before — the Proxy handles the rest.

import { createContext, useContext, useState, useCallback } from 'react';
import { setLanguage } from '../translations.js';

const LanguageContext = createContext({ lang: 'ru', setLang: () => {} });

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(
    () => localStorage.getItem('blossom-lang') || 'ru'
  );

  const setLang = useCallback((newLang) => {
    setLanguage(newLang);
    localStorage.setItem('blossom-lang', newLang);
    setLangState(newLang);
  }, []);

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export function LangToggle() {
  const { lang, setLang } = useLanguage();
  return (
    <button
      onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
      className="text-xs font-bold px-2 py-1 rounded-lg bg-gray-100 text-ios-secondary
                 hover:bg-gray-200 active-scale uppercase tracking-wide"
      title="Switch language"
    >
      {lang === 'ru' ? 'EN' : 'RU'}
    </button>
  );
}
