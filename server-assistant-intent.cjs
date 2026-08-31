const crypto = require('node:crypto');
const express = require('express');
const { cleanTenant } = require('./server-tenant.cjs');
const turns = new Map();
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function scopeFor(req) {
  const conversation = String(req.body?.conversation_id || req.query?.conversation_id || 'main').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'main';
  return `${cleanTenant(req.user?.organisation)}:${req.user?.id}:${conversation}`;
}

function beginRequest(req) {
  if (req.novaTurn) return req.novaTurn;
  const now = Date.now();
  for (const [key, value] of turns) if (value.expiresAt < now) turns.delete(key);
  const turn = { scope: scopeFor(req), nonce: crypto.randomUUID(), expiresAt: now + 5 * 60_000 };
  turns.set(turn.scope, turn);
  req.novaTurn = turn;
  return turn;
}

function isCurrentTurn(turn, user) {
  const sameAccount = !user || turn?.scope.startsWith(`${cleanTenant(user.organisation)}:${user.id}:`);
  return Boolean(sameAccount && turn && turn.expiresAt > Date.now() && turns.get(turn.scope)?.nonce === turn.nonce);
}

function requestedTaskStatus(message) {
  const text = normalize(message);
  if (/\b(comment|pourquoi|explique|verifie|analyse|delegue|deleguer|assigne|confie)\b|\bne\b.*\bpas\b|\bsans\b/.test(text)) return null;
  if (!/\b(mets?|mettre|mettez|passe[rz]?|marque[rz]?|change[rz]?|modifie[rz]?|termine[rz]?|bloque[rz]?|demarre[rz]?|reprends?|actualise[rz]?)\b/.test(text)) return null;
  const statuses = [
    ['a_faire', /\ba[_ ]faire\b/], ['en_cours', /\ben[_ ]cours\b|\bdemarre[rz]?\b/],
    ['terminee', /\btermine(?:e|es|s|r|z)?\b/], ['bloquee', /\bbloque(?:e|es|s|r|z)?\b/],
  ].filter(([, pattern]) => pattern.test(text)).map(([status]) => status);
  return statuses.length === 1 ? statuses[0] : null;
}

function taskStatusMatches(message, action, task) {
  const text = normalize(message), title = normalize(task?.titre);
  const id = String(action.id || '');
  const idMentioned = id && new RegExp(`(?:^|[^a-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9_-])`, 'i').test(text);
  const titleMentioned = title.length >= 8 && text.includes(title) && /\btache\b/.test(text);
  return task?.id === action.id && requestedTaskStatus(message) === action.payload.statut && Boolean(idMentioned || titleMentioned);
}

const router = express.Router();
router.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/chat' && typeof req.body?.message === 'string' && req.body.message.trim()) {
    beginRequest(req);
    if (/^(oui|ok|oki|okay|je confirme|confirme|go|vas[- ]y|execute)[.!\s]*$/.test(normalize(req.body.message))) {
      return res.json({ message: 'Aucune action précise n’a été confirmée. Utilisez le bouton de la proposition encore active ou reformulez la demande avec sa cible. Aucune ancienne action reprise.', confirmation: null });
    }
  }
  next();
});
router.post('/cancel', (req, res) => {
  const scope = scopeFor(req);
  if (!req.body?.request_nonce || turns.get(scope)?.nonce === req.body.request_nonce) turns.delete(scope);
  res.json({ success: true, confirmation: null });
});

module.exports = { router, beginRequest, isCurrentTurn, requestedTaskStatus, taskStatusMatches };
