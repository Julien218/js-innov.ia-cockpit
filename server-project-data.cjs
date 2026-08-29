const express = require('express');
const { ensureFolderTree, uploadFile } = require('./server-dropbox-helper.cjs');

const router = express.Router();
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DROPBOX_ROOT = process.env.DROPBOX_ROOT_PATH || '/Cockpit';
const BACKUP_INTERVAL_MS = Math.max(60 * 60 * 1000, Number(process.env.PROJECT_DATA_BACKUP_INTERVAL_MS || 6 * 60 * 60 * 1000));

const parseEmails = (value) => new Set(String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean));

const COLLECTIONS = Object.freeze([
  Object.freeze({
    key: 'tour-de-dour-mascotte',
    label: 'Prénoms de la mascotte',
    client: 'Starlight ASBL',
    project: 'Le Tour de Dour',
    sourceTable: 'tour_de_dour_name_suggestions',
    allowedEmails: parseEmails(process.env.PROJECT_DATA_TOUR_DE_DOUR_EMAILS || 'olivier.trevis@outlook.be'),
    dropboxFolder: `${DROPBOX_ROOT}/Clients/Starlight ASBL/Projets/Le Tour de Dour/Donnees/Propositions mascotte`,
  }),
]);

const backupState = {
  running: false,
  lastRunAt: null,
  lastError: null,
  lastResults: [],
};
let backupTimer = null;

function publicCollection(collection, user) {
  return {
    key: collection.key,
    label: collection.label,
    client: collection.client,
    project: collection.project,
    canManage: user?.role === 'superadmin',
    dropboxBackupConfigured: dropboxConfigured(),
  };
}

function canAccessCollection(user, collection) {
  if (!user || !collection) return false;
  if (user.role === 'superadmin') return true;
  return collection.allowedEmails.has(String(user.email || '').trim().toLowerCase());
}

function collectionFor(req, res) {
  const collection = COLLECTIONS.find((item) => item.key === req.params.collectionKey);
  if (!collection || !canAccessCollection(req.user, collection)) {
    res.status(404).json({ error: 'Tableau de projet introuvable.' });
    return null;
  }
  return collection;
}

function dropboxConfigured() {
  return Boolean(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET && process.env.DROPBOX_REFRESH_TOKEN);
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_SECRET) throw new Error('Clé serveur Supabase non configurée.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET,
      Authorization: `Bearer ${SUPABASE_SECRET}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 180)}`);
  return body ? JSON.parse(body) : [];
}

async function listRecords(collection) {
  const select = 'id,suggested_name,reason,display_name,consent,status,created_at';
  const rows = await supabaseRequest(`${collection.sourceTable}?select=${select}&order=created_at.desc&limit=2000`);
  return Array.isArray(rows) ? rows : [];
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function recordsToCsv(records) {
  const header = ['Prénom proposé', 'Pourquoi ce prénom', 'Participant', 'Statut', 'Date'];
  const lines = records.map((row) => [
    row.suggested_name,
    row.reason,
    row.display_name,
    row.status,
    row.created_at,
  ].map(csvCell).join(';'));
  return `\uFEFF${header.map(csvCell).join(';')}\r\n${lines.join('\r\n')}\r\n`;
}

function isoWeekKey(date = new Date()) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
}

async function backupCollection(collection, { suffix = `semaine-${isoWeekKey()}` } = {}) {
  if (!dropboxConfigured()) throw new Error('Dropbox non configuré sur Railway.');
  const records = await listRecords(collection);
  const folder = await ensureFolderTree(collection.dropboxFolder);
  if (folder?.error) throw new Error(folder.error);
  const safeSuffix = String(suffix).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
  const path = `${collection.dropboxFolder}/propositions-mascotte-${safeSuffix}.csv`;
  const uploaded = await uploadFile(path, Buffer.from(recordsToCsv(records), 'utf8'));
  if (uploaded?.error) throw new Error(uploaded.error);
  return { collection: collection.key, path: uploaded.path || path, rows: records.length };
}

async function runProjectDataBackups() {
  if (backupState.running) return { skipped: true, reason: 'already_running' };
  if (!dropboxConfigured()) return { skipped: true, reason: 'dropbox_not_configured' };
  backupState.running = true;
  backupState.lastError = null;
  try {
    const results = [];
    for (const collection of COLLECTIONS) results.push(await backupCollection(collection));
    backupState.lastRunAt = new Date().toISOString();
    backupState.lastResults = results;
    return { success: true, results };
  } catch (error) {
    backupState.lastError = error.message;
    throw error;
  } finally {
    backupState.running = false;
  }
}

function startProjectDataBackupScheduler() {
  if (process.env.PROJECT_DATA_BACKUP_ENABLED === 'false') return { started: false, reason: 'disabled' };
  if (!dropboxConfigured()) return { started: false, reason: 'dropbox_not_configured' };
  if (backupTimer) return { started: false, reason: 'already_started' };
  const firstRun = setTimeout(() => runProjectDataBackups().catch((error) => console.warn('[project-data] backup:', error.message)), 30000);
  firstRun.unref?.();
  backupTimer = setInterval(() => runProjectDataBackups().catch((error) => console.warn('[project-data] backup:', error.message)), BACKUP_INTERVAL_MS);
  backupTimer.unref?.();
  return { started: true, intervalMs: BACKUP_INTERVAL_MS };
}

router.get('/collections', (req, res) => {
  const collections = COLLECTIONS.filter((collection) => canAccessCollection(req.user, collection)).map((collection) => publicCollection(collection, req.user));
  res.json({ collections, backup: { configured: dropboxConfigured(), lastRunAt: backupState.lastRunAt, lastError: backupState.lastError } });
});

router.get('/:collectionKey/records', async (req, res) => {
  const collection = collectionFor(req, res);
  if (!collection) return;
  try {
    const records = await listRecords(collection);
    res.json({ collection: publicCollection(collection, req.user), records });
  } catch (error) {
    console.error('[project-data] records:', error.message);
    res.status(503).json({ error: 'Les informations du projet sont momentanément indisponibles.' });
  }
});

router.get('/:collectionKey/export.csv', async (req, res) => {
  const collection = collectionFor(req, res);
  if (!collection) return;
  try {
    const records = await listRecords(collection);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${collection.key}.csv"`);
    res.send(recordsToCsv(records));
  } catch (error) {
    console.error('[project-data] csv:', error.message);
    res.status(503).json({ error: 'Export CSV indisponible.' });
  }
});

router.patch('/:collectionKey/records/:recordId', async (req, res) => {
  const collection = collectionFor(req, res);
  if (!collection) return;
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'La modération est réservée à l’administrateur principal.' });
  const recordId = String(req.params.recordId || '');
  const status = String(req.body?.status || '');
  if (!/^[0-9a-f-]{36}$/i.test(recordId) || !['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Modification invalide.' });
  }
  try {
    await supabaseRequest(`${collection.sourceTable}?id=eq.${encodeURIComponent(recordId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status }),
    });
    res.json({ success: true, id: recordId, status });
  } catch (error) {
    console.error('[project-data] moderation:', error.message);
    res.status(503).json({ error: 'La proposition n’a pas pu être mise à jour.' });
  }
});

router.post('/:collectionKey/backup', async (req, res) => {
  const collection = collectionFor(req, res);
  if (!collection) return;
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Sauvegarde réservée à l’administrateur principal.' });
  try {
    const result = await backupCollection(collection, { suffix: `manuel-${new Date().toISOString().slice(0, 10)}` });
    backupState.lastRunAt = new Date().toISOString();
    backupState.lastResults = [result];
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[project-data] manual backup:', error.message);
    res.status(503).json({ error: error.message || 'Sauvegarde Dropbox indisponible.' });
  }
});

module.exports = {
  router,
  COLLECTIONS,
  backupState,
  canAccessCollection,
  recordsToCsv,
  isoWeekKey,
  backupCollection,
  runProjectDataBackups,
  startProjectDataBackupScheduler,
};
