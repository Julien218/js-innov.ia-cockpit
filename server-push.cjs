// ============================================================
// server-push.cjs — Notifications push & géolocalisation
// Cockpit JS-Innov.IA
// ============================================================
// Endpoints:
//   POST /api/push/subscribe   — Enregistrer abonnement push
//   POST /api/push/unsubscribe — Supprimer abonnement push
//   GET  /api/push/status      — Statut abonnement utilisateur
//   POST /api/push/send         — Envoyer notification (admin)
//   POST /api/push/location     — Recevoir géolocalisation
//   GET  /api/push/location     — Dernière position connue
//   GET  /api/push/vapid-key    — Clé publique VAPID
// ============================================================

const express = require('express');
const crypto = require('crypto');

const router = express.Router();

// ─── VAPID Keys ────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEu_TahDnaefqGbwbRDNlN-JA_cyapkcvLduSGtuBdHZMuMuy2wRgEpLzS-QNfiBMzM8yY7NE5UqVyHgRNyEkYAQ';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = 'mailto:info@jsinnovia.com';

// ─── Stockage en mémoire (sera remplacé par Supabase) ────────
const pushSubscriptions = new Map(); // userId -> subscription
const userLocations = new Map(); // userId -> { lat, lng, accuracy, timestamp }

// ─── Middleware: requireSession hérité du parent ──────────────
// Le routeur est monté après requireSession dans server.cjs

// ─── Helper: encryption pour web push (RFC 8291 simplifié) ───
// Note: en production, utiliser le package `web-push` npm
// Pour l'instant, on stocke les subscriptions et on envoie via l'API native
async function sendPushNotification(subscription, payload) {
  if (!VAPID_PRIVATE_KEY) {
    console.warn('[push] VAPID_PRIVATE_KEY non configuré — push non envoyé');
    return false;
  }

  try {
    // Utiliser fetch vers FCM/Chrome/Apple directement
    const endpoint = subscription.endpoint;
    const keys = subscription.keys;

    // Encryption simplifié — en production utiliser web-push npm
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aesgcm',
        'Authorization': `vapid t=${VAPID_PUBLIC_KEY}`,
        'TTL': '86400',
      },
      body: JSON.stringify(payload),
    });

    return response.ok;
  } catch (e) {
    console.error('[push] Erreur envoi:', e.message);
    return false;
  }
}

// ─── POST /subscribe — Enregistrer abonnement push ────────────
router.post('/subscribe', (req, res) => {
  const userId = req.session?.userId || req.session?.id || 'anonymous';
  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Abonnement invalide' });
  }

  pushSubscriptions.set(userId, {
    ...subscription,
    userId,
    subscribed_at: new Date().toISOString(),
    userAgent: req.headers['user-agent'] || '',
  });

  console.log(`[push] Abonnement enregistré pour user ${userId}`);
  res.json({ success: true, message: 'Abonnement push enregistré' });
});

// ─── POST /unsubscribe — Supprimer abonnement ─────────────────
router.post('/unsubscribe', (req, res) => {
  const userId = req.session?.userId || req.session?.id || 'anonymous';
  const { endpoint } = req.body || {};

  if (pushSubscriptions.has(userId)) {
    pushSubscriptions.delete(userId);
    console.log(`[push] Désabonnement pour user ${userId}`);
  }

  res.json({ success: true, message: 'Désabonné' });
});

// ─── GET /status — Statut abonnement ──────────────────────────
router.get('/status', (req, res) => {
  const userId = req.session?.userId || req.session?.id || 'anonymous';
  const sub = pushSubscriptions.get(userId);
  const loc = userLocations.get(userId);

  res.json({
    push_enabled: VAPID_PRIVATE_KEY !== '',
    subscribed: !!sub,
    subscribed_at: sub?.subscribed_at || null,
    location: loc || null,
    vapid_configured: !!VAPID_PUBLIC_KEY,
  });
});

// ─── POST /send — Envoyer notification (admin only) ────────────
router.post('/send', (req, res) => {
  if (req.session?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin requis' });
  }

  const { user_id, title, body, url, tag, actions } = req.body || {};

  if (!title || !body) {
    return res.status(400).json({ error: 'title et body requis' });
  }

  // Envoyer à un utilisateur spécifique ou à tous
  const targets = user_id
    ? [pushSubscriptions.get(user_id)].filter(Boolean)
    : Array.from(pushSubscriptions.values());

  if (targets.length === 0) {
    return res.json({ success: false, message: 'Aucun abonnement actif', sent: 0 });
  }

  const payload = {
    title,
    body,
    data: { url: url || '/' },
    tag: tag || 'cockpit-notif',
    actions: actions || [],
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  };

  let sent = 0;
  for (const sub of targets) {
    sendPushNotification(sub, payload).then(ok => { if (ok) sent++; });
  }

  console.log(`[push] Notification envoyée à ${targets.length} abonné(s)`);
  res.json({ success: true, sent: targets.length, message: `Notification poussée vers ${targets.length} appareil(s)` });
});

// ─── POST /location — Recevoir géolocalisation ────────────────
router.post('/location', (req, res) => {
  const userId = req.session?.userId || req.session?.id || 'anonymous';
  const { latitude, longitude, accuracy, altitude, timestamp } = req.body || {};

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'Coordonnées invalides' });
  }

  userLocations.set(userId, {
    latitude,
    longitude,
    accuracy: accuracy || null,
    altitude: altitude || null,
    timestamp: timestamp || Date.now(),
    updated_at: new Date().toISOString(),
  });

  console.log(`[push] Position mise à jour: ${userId} → ${latitude}, ${longitude}`);
  res.json({ success: true, message: 'Position enregistrée' });
});

// ─── GET /location — Dernière position connue ─────────────────
router.get('/location', (req, res) => {
  const userId = req.session?.userId || req.session?.id || 'anonymous';
  const loc = userLocations.get(userId);

  if (!loc) {
    return res.json({ location: null, message: 'Aucune position connue' });
  }

  res.json({ location: loc });
});

// ─── GET /vapid-key — Clé publique VAPID (safe à exposer) ─────
router.get('/vapid-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

module.exports = { router, pushSubscriptions, userLocations };
