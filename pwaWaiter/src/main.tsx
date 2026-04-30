/**
 * pwaWaiter entry point.
 *
 * - Mounts the app in StrictMode
 * - Registers the custom push-capable service worker via vite-plugin-pwa's
 *   virtual module `virtual:pwa-register`. Auto-updates to the newest SW
 *   on each page load.
 *
 * The SW source lives at `public/sw-push.js` and is wrapped by the plugin
 * with its own precache injection (__WB_MANIFEST).
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { logger } from '@/utils/logger'

// Register the service worker (push handler + precache).
// The virtual module is synthesized by vite-plugin-pwa at build/dev time.
if ('serviceWorker' in navigator) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onRegisteredSW(swUrl) {
          logger.info(`main: service worker registered at ${swUrl}`)
        },
        onRegisterError(err) {
          logger.warn('main: service worker registration error', err)
        },
      })
    })
    .catch((err) => {
      logger.warn('main: failed to import virtual:pwa-register', err)
    })
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('pwaWaiter: #root element missing from index.html')
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
