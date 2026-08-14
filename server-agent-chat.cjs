/**
 * server-agent-chat.cjs — Proxy backend pour le Superagent flottant
 * 
 * Ce module agit comme proxy entre le cockpit frontend et l'API Superagent Base44.
 * Il garde la clé API (BASE44_API_KEY) côté serveur, jamais exposée dans le bundle.
 * 
 * Endpoints:
 *   POST /api/agent-chat/conversation          — Crée ou récupère une conversation
 *   POST /api/agent-chat/message               — Envoie un message et reçoit la réponse
 *   GET  /api/agent-chat/conversations          — Liste les conversations
 *   GET  /api/agent-chat/conversations/:id      — Récupère une conversation
 */

const express = require('express');
const router = express.Router();

// === Configuration ===
const AGENT_ID = '69ff4dc771a2cdab275f8a00';
const API_BASE = `https://app.base44.com/api/agents/${AGENT_ID}`;
const API_KEY = process.env.BASE44_API_KEY || process.env.VITE_BASE44_API_KEY || '';

if (!API_KEY) {
  console.warn('⚠️ Route agent-chat: BASE44_API_KEY manquant — widget Superagent non fonctionnel');
}

// === Helper: fetch avec timeout ===
async function fetchWithTimeout(url, options, timeoutMs = 60000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'api_key': API_KEY,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await resp.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: resp.status, body };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { status: 408, body: { error: 'Timeout — l\'agent met trop de temps à répondre' } };
    }
    return { status: 502, body: { error: 'Erreur proxy: ' + err.message } };
  } finally {
    clearTimeout(timeout);
  }
}

// === Routes ===

/**
 * POST /api/agent-chat/conversation
 * Body: { conversationId?: string }
 */
router.post('/conversation', async (req, res) => {
  if (!API_KEY) return res.status(503).json({ error: 'BASE44_API_KEY non configuré' });

  var conversationId = (req.body || {}).conversationId;

  if (conversationId) {
    var result = await fetchWithTimeout(API_BASE + '/conversations/' + conversationId, { method: 'GET' });
    if (result.status === 200) {
      return res.json({ conversationId: result.body.id, conversation: result.body });
    }
  }

  result = await fetchWithTimeout(API_BASE + '/conversations', {
    method: 'POST',
    body: JSON.stringify({}),
  });

  if (result.status === 200 || result.status === 201) {
    res.json({ conversationId: result.body.id, conversation: result.body });
  } else {
    res.status(result.status).json({ error: 'Création conversation échouée', detail: result.body });
  }
});

/**
 * GET /api/agent-chat/conversations
 */
router.get('/conversations', async (req, res) => {
  if (!API_KEY) return res.status(503).json({ error: 'BASE44_API_KEY non configuré' });

  var result = await fetchWithTimeout(API_BASE + '/conversations', { method: 'GET' });
  if (result.status === 200) {
    res.json(result.body);
  } else {
    res.status(result.status).json({ error: 'Liste échouée', detail: result.body });
  }
});

/**
 * GET /api/agent-chat/conversations/:id
 */
router.get('/conversations/:id', async (req, res) => {
  if (!API_KEY) return res.status(503).json({ error: 'BASE44_API_KEY non configuré' });

  var result = await fetchWithTimeout(API_BASE + '/conversations/' + req.params.id, { method: 'GET' });
  if (result.status === 200) {
    res.json(result.body);
  } else {
    res.status(result.status).json({ error: 'Introuvable', detail: result.body });
  }
});

/**
 * POST /api/agent-chat/message
 * Body: { conversationId: string, message: string }
 */
router.post('/message', async (req, res) => {
  if (!API_KEY) return res.status(503).json({ error: 'BASE44_API_KEY non configuré' });

  var body = req.body || {};
  var conversationId = body.conversationId;
  var message = body.message;

  if (!conversationId) return res.status(400).json({ error: 'conversationId requis' });
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message requis' });

  var result = await fetchWithTimeout(
    API_BASE + '/conversations/' + conversationId + '/messages',
    {
      method: 'POST',
      body: JSON.stringify({ message: message }),
    },
    120000
  );

  if (result.status === 200 || result.status === 201) {
    res.json(result.body);
  } else {
    res.status(result.status).json({
      error: 'Envoi échoué',
      detail: result.body,
      status: result.status,
    });
  }
});

module.exports = router;
