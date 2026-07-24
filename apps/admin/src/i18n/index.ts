import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { RTL_LANGUAGES, SUPPORTED_LANGUAGES, type Language } from '@tailonix/shared';
import ar from './locales/ar.json';
import en from './locales/en.json';
import ur from './locales/ur.json';

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  ar: 'العربية',
  ur: 'اردو',
};

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
      ur: { translation: ur },
    },
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    // PRD §5: auto-detect from the browser, remember an explicit choice
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'tailonix-lang',
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
  });

export function isRtl(lang: string): boolean {
  return RTL_LANGUAGES.includes(lang.split('-')[0] as Language);
}

/** Mirrors the whole UI by flipping `dir` on <html> (wireframes §5). */
export function applyDirection(lang: string): void {
  const dir = isRtl(lang) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lang);
}

applyDirection(i18n.language);
i18n.on('languageChanged', applyDirection);

export default i18n;
