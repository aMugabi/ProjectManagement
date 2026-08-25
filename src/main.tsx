import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { LoginGate } from './components/LoginGate.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LoginGate>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </LoginGate>
  </StrictMode>,
)
