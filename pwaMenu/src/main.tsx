import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import { loadInitialBundle } from './i18n'
import './index.css'
import App from './App'

async function bootstrap() {
  await loadInitialBundle()

  if (import.meta.env.DEV) {
    const [{ useCartStore }, { useSessionStore }, { router }] = await Promise.all([
      import('./stores/cartStore'),
      import('./stores/sessionStore'),
      import('./router'),
    ])
    const w = window as unknown as Record<string, unknown>
    w.__cartStore = useCartStore
    w.__sessionStore = useSessionStore
    w.__router = router
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
