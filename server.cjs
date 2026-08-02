// server.cjs — API uniquement (nginx gère le SPA statique)
// Écoute sur :3001, accessible via nginx proxy /api/
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.API_PORT || 3001;

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));

try {
  const authRouter = require('./server-auth.cjs');
  app.use('/api/auth', authRouter);
  console.log('Route /api/auth activée (login, session, logout)');
} catch (e) {
  console.warn('Route auth indisponible:', e.message);
}

try {
  const emailRouter = require('./server-email.cjs');
  app.use('/api/emails', emailRouter);
  console.log('Route /api/emails activée (IMAP/SMTP IONOS)');
} catch (e) {
  console.warn('Route emails indisponible:', e.message);
}

try {
  const billingRouter = require('./server-billing.cjs');
  app.use('/api/billing', billingRouter);
  console.log('Route /api/billing activée');
} catch (e) {
  console.warn('Route billing indisponible:', e.message);
}

// Proxy assurances protégé par session : Julien superadmin et Olivier uniquement.
try {
  const insuranceRouter = require('./server-insurance.cjs');
  app.use('/api/insurance', insuranceRouter);
  console.log('Route /api/insurance activée (session protégée)');
} catch (e) {
  console.warn('Route assurances indisponible:', e.message);
}

// Proxy de données existant — conservé sans modification fonctionnelle.
const AGENT_PROXY_URL = process.env.VITE_AGENT_URL
  || process.env.JSINNOVIA_AGENT_URL
  || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_PROXY_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';

app.use('/api/data', async (req, res) => {
  const targetUrl = `${AGENT_PROXY_URL}/data${req.url}`;
  const method = req.method;
  const fetchOptions = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-agent-key': AGENT_PROXY_KEY,
    },
  };

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && req.body) {
    fetchOptions.body = JSON.stringify(req.body);
  }

  try {
    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || 'application/json';
    const body = await response.text();
    if (response.status === 204 || !body) return res.status(response.status).end();
    return res.status(response.status).set('Content-Type', contentType).send(body);
  } catch (err) {
    console.error('[Proxy /api/data] Error:', err.message);
    return res.status(502).json({ error: 'Proxy error: ' + err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'cockpit-api' }));

app.listen(PORT, () => {
  console.log(`JS-Innov.IA Cockpit API — port ${PORT}`);
  console.log(`Proxy /api/data → ${AGENT_PROXY_URL}/data`);
});
