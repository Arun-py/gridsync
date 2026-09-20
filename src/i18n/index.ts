/**
 * Internationalisation.
 *
 * English and Tamil ship now; the structure supports adding languages without
 * touching components. Keys are namespaced by area (nav.*, common.*, ...).
 *
 * HONEST SCOPE: the Tamil translation covers navigation, common actions and
 * primary labels. Deep technical strings (rule explanations, ML feature names,
 * maintenance recommendations) intentionally fall back to English rather than
 * shipping a machine translation of safety-relevant engineering text that no
 * Tamil-speaking engineer has reviewed. `missingKeyHandler` logs gaps in dev so
 * the remaining coverage is visible rather than hidden.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import ta from './locales/ta.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'ta', label: 'Tamil', nativeLabel: 'தமிழ்' },
] as const;

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ta: { translation: ta },
  },
  lng: 'en',
  fallbackLng: 'en',
  // A missing Tamil key renders the English string rather than the raw key.
  returnEmptyString: false,
  interpolation: { escapeValue: false },
  saveMissing: import.meta.env.DEV,
  missingKeyHandler: (lngs, _ns, key) => {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] missing key "${key}" for ${lngs.join(', ')} — falling back to English`);
    }
  },
});

export default i18n;
