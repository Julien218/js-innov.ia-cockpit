import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { installAssistantConfirmationBridge } from '@/lib/assistantConfirmationBridge.js'
import { installLocalAgentFetchCompat } from '@/lib/localAgentFetchCompat.js'
import { installAssistantDiagnosticBridge } from '@/lib/assistantDiagnosticBridge.js'

installAssistantConfirmationBridge()
installLocalAgentFetchCompat()
installAssistantDiagnosticBridge()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
