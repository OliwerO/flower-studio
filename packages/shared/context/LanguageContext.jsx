import { createContext, useContext, useState, useCallback } from 'react';

const LanguageContext = createContext({ lang: 'ru', setLang: () => {} });

export function LanguageProvider({ children, setLanguage, setGuideLanguage }) {
  const [lang, setLangState] = useState(
    () => localStorage.getItem('blossom-lang') || 'ru'
  );

  const setLang = useCallback((newLang) => {
    setLanguage(newLang);
    if (setGuideLanguage) setGuideLanguage(newLang);
    localStorage.setItem('blossom-lang', newLang);
    setLangState(newLang);
  }, [setLanguage, setGuideLanguage]);

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export function LangToggle({ className }) {
  const { lang, setLang } = useLanguage();
  return (
    <button
      onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
      className={className || "text-xs font-bold px-2 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 active:scale-95 uppercase tracking-wide"}
      title="Switch language"
    >
      {lang === 'ru' ? 'EN' : 'RU'}
    </button>
  );
}
