import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthCallbackProcessingPage, type AuthCallbackMarker } from './AuthFlowPage.tsx'

const markerValue = new URL(window.location.href).searchParams.get('auth')
const callbackMarker = markerValue === 'processing' || markerValue === 'success' || markerValue === 'error'
  ? markerValue as AuthCallbackMarker
  : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {callbackMarker ? <AuthCallbackProcessingPage marker={callbackMarker} /> : <App />}
  </StrictMode>,
)
