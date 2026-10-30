import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { LoginGate } from './components/LoginGate.tsx'

// Installs the service worker; with registerType 'autoUpdate' a new deploy is
// picked up and the page reloads onto it automatically. Task data is already in
// localStorage, so the reload doesn't lose saved work.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LoginGate>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </LoginGate>
  </StrictMode>,
)
