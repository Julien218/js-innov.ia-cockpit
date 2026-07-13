const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, 'dist');

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const AGENT_GARAGE_REPO = process.env.AGENT_GARAGE_REPO || 'Julien218/Agents-IA-par-metier';
const AGENT_GARAGE_REF = process.env.AGENT_GARAGE_REF || 'main';

async function requireCockpitSession(req, res, next) {
  const token = req.header('x-cockpit-session');
  const userId = req.header('x-cockpit-user');

  if (!token || !userId || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(401).json({ error: 'Session cockpit invalide.' });
  }

  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/cockpit_sessions`);
    url.searchParams.set('select', 'user_id,expires_at');
    url.searchParams.set('token', `eq.${token}`);
    url.searchParams.set('user_id', `eq.${userId}`);
    url.searchParams.set('expires_at', `gt.${new Date().toISOString()}`);
    url.searchParams.set('limit', '1');

    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    const sessions = response.ok ? await response.json() : [];
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return res.status(401).json({ error: 'Session expirée ou inconnue.' });
    }

    req.cockpitUserId = userId;
    next();
  } catch (error) {
    console.error('Session verification failed:', error);
    res.status(503).json({ error: 'Vérification de session indisponible.' });
  }
}

app.get('/api/agent-garage', requireCockpitSession, async (_req, res) => {
  if (!GITHUB_TOKEN) {
    return res.status(503).json({ error: 'GITHUB_TOKEN serveur manquant.' });
  }

  try {
    const apiUrl = `https://api.github.com/repos/${AGENT_GARAGE_REPO}/contents/registry/agents.json?ref=${encodeURIComponent(AGENT_GARAGE_REF)}`;
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'js-innovia-cockpit',
      },
    });

    if (!response.ok) {
      const details = await response.text();
      console.error('Agent garage fetch failed:', response.status, details);
      return res.status(502).json({ error: 'Impossible de lire le registre GitHub.' });
    }

    const payload = await response.json();
    const decoded = Buffer.from(payload.content || '', 'base64').toString('utf8');
    const registry = JSON.parse(decoded);
    res.set('Cache-Control', 'private, max-age=30');
    res.json(registry);
  } catch (error) {
    console.error('Agent garage error:', error);
    res.status(500).json({ error: 'Erreur de lecture du garage d’agents.' });
  }
});

app.use(express.static(DIST, {
  maxAge: '1y',
  immutable: true,
  index: false,
}));

app.get('*', (_req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`JS-Innov.IA Cockpit — port ${PORT}`);
});
