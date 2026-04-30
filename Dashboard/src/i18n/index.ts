import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import es from './locales/es.json'
import en from './locales/en.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      es: { translation: es },
      en: { translation: en },
    },
    // Spanish is the default UI language for Dashboard
    lng: 'es',
    fallbackLng: 'es',
    // Supported languages
    supportedLngs: ['es', 'en'],
    // Don't load from server — we bundle all translations
    load: 'languageOnly',
    interpolation: {
      // React already escapes by default
      escapeValue: false,
    },
    detection: {
      // Look for stored preference in localStorage
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'dashboard-language',
      caches: ['localStorage'],
    },
  })

export default i18n
