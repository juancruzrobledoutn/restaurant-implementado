/**
 * i18n configuration for pwaMenu.
 *
 * Supported languages: es (default), en, pt
 * Locales are lazy-loaded on demand (code-split by Vite).
 * All UI text MUST use t() — zero hardcoded strings.
 */
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

type SupportedLng = 'es' | 'en' | 'pt'
const SUPPORTED_LNGS: SupportedLng[] = ['es', 'en', 'pt']

function isSupportedLng(lng: string): lng is SupportedLng {
  return (SUPPORTED_LNGS as string[]).includes(lng)
}

async function loadBundle(lng: string): Promise<void> {
  if (!isSupportedLng(lng)) return
  if (i18n.hasResourceBundle(lng, 'translation')) return

  let mod: { default: Record<string, unknown> }
  switch (lng) {
    case 'es':
      mod = await import('./locales/es.json')
      break
    case 'en':
      mod = await import('./locales/en.json')
      break
    case 'pt':
      mod = await import('./locales/pt.json')
      break
  }
  i18n.addResourceBundle(lng, 'translation', mod.default, true, true)
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'es',
    supportedLngs: SUPPORTED_LNGS,
    nonExplicitSupportedLngs: false,
    partialBundledLanguages: true,
    resources: {}, // empty at start — loaded lazily
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'pwamenu-language',
    },
  })

i18n.on('languageChanged', (lng: string) => {
  void loadBundle(lng)
})

/**
 * Returns a promise that resolves once the initial detected language bundle
 * has been loaded. Use in main.tsx to avoid flash of untranslated keys.
 */
export async function loadInitialBundle(): Promise<void> {
  const lng = i18n.language || 'es'
  await loadBundle(lng)
}

export default i18n
