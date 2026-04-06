import { LanguageProvider as SharedProvider, useLanguage, LangToggle as SharedLangToggle } from '@flower-studio/shared';
import { setLanguage } from '../translations.js';
import { setGuideLanguage } from '../guideContent.js';

export { useLanguage };

export function LanguageProvider({ children }) {
  return (
    <SharedProvider setLanguage={setLanguage} setGuideLanguage={setGuideLanguage}>
      {children}
    </SharedProvider>
  );
}

export function LangToggle() {
  return (
    <SharedLangToggle
      className="text-xs font-bold px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 active-scale uppercase tracking-wide"
    />
  );
}
