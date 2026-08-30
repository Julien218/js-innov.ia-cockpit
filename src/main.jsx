import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import '@/components/nova-mobile.css'
import { installAssistantConfirmationBridge } from '@/lib/assistantConfirmationBridge.js'
import { installLocalAgentFetchCompat } from '@/lib/localAgentFetchCompat.js'
import { installAssistantDiagnosticBridge } from '@/lib/assistantDiagnosticBridge.js'

installAssistantConfirmationBridge()
installLocalAgentFetchCompat()
installAssistantDiagnosticBridge()

// ─── Service Worker (PWA + Push notifications) ──────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => console.log('[pwa] Service Worker enregistré:', reg.scope))
      .catch(err => console.warn('[pwa] SW registration échouée:', err.message))
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
