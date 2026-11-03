import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
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
