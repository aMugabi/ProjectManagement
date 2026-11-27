import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
// The two fonts are served from Ledger itself (no visit reaches Google's font servers), and
// precached with the app, so they work offline. Latin characters only.
import '@fontsource/figtree/latin-400.css'
import '@fontsource/figtree/latin-500.css'
import '@fontsource/figtree/latin-600.css'
import '@fontsource/figtree/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './index.css'
import App from './App.tsx'
import { LoginGate } from './components/LoginGate.tsx'
import { CLOUD_ENABLED } from './lib/cloud.ts'

// Installs the service worker; with registerType 'autoUpdate' a new deploy is
// picked up and the page reloads onto it automatically. Task data is already in
// localStorage, so the reload doesn't lose saved work.
registerSW({ immediate: true })

const app = (
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <App />
  </BrowserRouter>
)

// Local-only builds (GitHub Pages, `npm run dev`) keep data in this browser and have no server
// to check a password against, so they skip the gate rather than show one that guards nothing.
createRoot(document.getElementById('root')!).render(
  <StrictMode>{CLOUD_ENABLED ? <LoginGate>{app}</LoginGate> : app}</StrictMode>,
)
