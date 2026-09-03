import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import '@/iphone-fixes.css'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.warn('[SIGNELYA] Service worker non enregistré:', error.message)
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
