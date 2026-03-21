import { LanguageProvider as SharedProvider, useLanguage, LangToggle } from '@flower-studio/shared';
import { setLanguage } from '../translations.js';
import { setGuideLanguage } from '../guideContent.js';

export { useLanguage, LangToggle };

export function LanguageProvider({ children }) {
  return (
    <SharedProvider setLanguage={setLanguage} setGuideLanguage={setGuideLanguage}>
      {children}
    </SharedProvider>
  );
}
