const express = require('express');
const PDFDocument = require('pdfkit');
const { ensureFolderTree, uploadFile } = require('./server-dropbox-helper.cjs');
const { missDourConfigured, listMissDourRegistrations } = require('./server-miss-dour-data.cjs');

const router = express.Router();
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DROPBOX_ROOT = process.env.DROPBOX_ROOT_PATH || '/Cockpit';
const BACKUP_INTERVAL_MS = Math.max(60 * 60 * 1000, Number(process.env.PROJECT_DATA_BACKUP_INTERVAL_MS || 6 * 60 * 60 * 1000));

const REGISTRATION_CATEGORY = Object.freeze({
  miss: 'Miss',
  mister: 'Mister',
  teen_miss: 'Teen Miss',
  teen_mister: 'Teen Mister',
});
const REGISTRATION_STATUS = Object.freeze({
  pending: 'En attente',
  approved: 'Validée',
  rejected: 'Refusée',
  finalist: 'Finaliste',
  winner: 'Lauréat(e)',
});

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
  Object.freeze({
    key: 'miss-mister-dour-inscriptions',
    label: 'Inscriptions Miss et Mister Dour',
    client: 'Starlight ASBL',
    project: 'Miss et Mister Dour',
    kind: 'registrations',
    readOnly: true,
    backupEnabled: false,
    allowedEmails: parseEmails(process.env.PROJECT_DATA_MISS_DOUR_EMAILS || ''),
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
    kind: collection.kind || 'suggestions',
    canManage: user?.role === 'superadmin' && !collection.readOnly,
    sourceConfigured: collection.kind === 'registrations' ? missDourConfigured() : Boolean(SUPABASE_SECRET),
    dropboxBackupConfigured: collection.backupEnabled !== false && dropboxConfigured(),
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
  if (collection.kind === 'registrations') return listMissDourRegistrations();
  const select = 'id,suggested_name,reason,display_name,consent,status,created_at';
  const rows = await supabaseRequest(`${collection.sourceTable}?select=${select}&order=created_at.desc&limit=2000`);
  return Array.isArray(rows) ? rows : [];
}

function formatExportDate(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '';
  return new Intl.DateTimeFormat('fr-BE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function registrationSource(value) {
  return value === 'application' ? 'Candidature reçue' : value === 'profile' ? 'Profil candidat' : String(value || '');
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportRows(records, collection) {
  if (collection?.kind === 'registrations') {
    return records.map((row) => ({
      prenom: row.first_name || '',
      nom: row.last_name || '',
      email: row.email || '',
      telephone: row.phone || '',
      ville: row.city || '',
      categorie: REGISTRATION_CATEGORY[row.category] || row.category || '',
      statut: REGISTRATION_STATUS[row.status] || row.status || '',
      annee: row.year || '',
      source: registrationSource(row.source),
      date: formatExportDate(row.created_at),
    }));
  }
  return records.map((row) => ({
    proposition: row.suggested_name || '',
    raison: row.reason || '',
    participant: row.display_name || 'Anonyme',
    statut: row.status || '',
    date: formatExportDate(row.created_at),
  }));
}

function recordsToCsv(records, collection) {
  const rows = exportRows(records, collection);
  if (collection?.kind === 'registrations') {
    const fields = ['prenom', 'nom', 'email', 'telephone', 'ville', 'categorie', 'statut', 'annee', 'source', 'date'];
    const header = ['Prénom', 'Nom', 'Email', 'Téléphone', 'Ville', 'Catégorie', 'Statut', 'Année', 'Source', 'Date'];
    return `\uFEFF${header.map(csvCell).join(';')}\r\n${rows.map(row => fields.map(field => csvCell(row[field])).join(';')).join('\r\n')}\r\n`;
  }
  const fields = ['proposition', 'raison', 'participant', 'statut', 'date'];
  const header = ['Prénom proposé', 'Pourquoi ce prénom', 'Participant', 'Statut', 'Date'];
  return `\uFEFF${header.map(csvCell).join(';')}\r\n${rows.map(row => fields.map(field => csvCell(row[field])).join(';')).join('\r\n')}\r\n`;
}

function filterExportRecords(records, collection, query = {}) {
  const search = String(query.q || '').trim().toLocaleLowerCase('fr');
  const status = String(query.status || 'all').trim();
  return records.filter((row) => {
    if (status && status !== 'all' && row.status !== status) return false;
    if (!search) return true;
    const values = collection?.kind === 'registrations'
      ? [row.first_name, row.last_name, row.email, row.phone, row.city, row.category, row.year, row.status]
      : [row.suggested_name, row.reason, row.display_name, row.status];
    return values.some((value) => String(value || '').toLocaleLowerCase('fr').includes(search));
  });
}

function pdfText(value) {
  return String(value == null || value === '' ? '—' : value).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function recordsToPdf(records, collection, { search = '', status = 'all' } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 42, right: 36, bottom: 40, left: 36 },
      info: {
        Title: `${collection.label} - Export Cockpit`,
        Author: 'JS-Innov.IA Cockpit',
        Subject: `${collection.client} - ${collection.project}`,
      },
      bufferPages: true,
    });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const rows = exportRows(records, collection);
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const isRegistrations = collection.kind === 'registrations';
    const columns = isRegistrations ? [
      { key: 'prenom', label: 'Prénom', width: 62 },
      { key: 'nom', label: 'Nom', width: 68 },
      { key: 'email', label: 'Email', width: 120 },
      { key: 'telephone', label: 'Téléphone', width: 80 },
      { key: 'ville', label: 'Ville', width: 72 },
      { key: 'categorie', label: 'Catégorie', width: 72 },
      { key: 'statut', label: 'Statut', width: 72 },
      { key: 'annee', label: 'Année', width: 42 },
      { key: 'date', label: 'Date', width: 92 },
    ] : [
      { key: 'proposition', label: 'Prénom proposé', width: 120 },
      { key: 'raison', label: 'Pourquoi ce prénom', width: 360 },
      { key: 'participant', label: 'Participant', width: 120 },
      { key: 'statut', label: 'Statut', width: 90 },
      { key: 'date', label: 'Date', width: 110 },
    ];
    const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
    const scale = pageWidth / totalWidth;
    const scaledColumns = columns.map(column => ({ ...column, width: column.width * scale }));
    const exportDate = formatExportDate(new Date());
    let pageNumber = 1;

    const drawPageHeader = () => {
      const startX = doc.page.margins.left;
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(18).text(collection.label, startX, 36, { width: pageWidth });
      doc.fillColor('#4B5563').font('Helvetica').fontSize(9)
        .text(`${collection.client} - ${collection.project}`, startX, 61, { width: pageWidth });
      const filterParts = [];
      if (search) filterParts.push(`Recherche: ${search}`);
      if (status && status !== 'all') filterParts.push(`Statut: ${REGISTRATION_STATUS[status] || status}`);
      const meta = `${rows.length} ligne(s) - Exporté le ${exportDate}${filterParts.length ? ` - ${filterParts.join(' - ')}` : ''}`;
      doc.fillColor('#6B7280').fontSize(8).text(meta, startX, 75, { width: pageWidth });
      doc.moveTo(startX, 91).lineTo(startX + pageWidth, 91).strokeColor('#D1D5DB').lineWidth(0.7).stroke();
      doc.y = 101;
    };

    const drawTableHeader = () => {
      let x = doc.page.margins.left;
      const y = doc.y;
      const height = 22;
      doc.save().fillColor('#111827').rect(x, y, pageWidth, height).fill().restore();
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#FFFFFF');
      for (const column of scaledColumns) {
        doc.text(column.label, x + 4, y + 7, { width: column.width - 8, height: height - 8, ellipsis: true });
        x += column.width;
      }
      doc.y = y + height;
    };

    const drawFooter = () => {
      const y = doc.page.height - 27;
      doc.fillColor('#9CA3AF').font('Helvetica').fontSize(7)
        .text(`JS-Innov.IA Cockpit - Page ${pageNumber}`, doc.page.margins.left, y, { width: pageWidth, align: 'right' });
    };

    const startPage = () => {
      drawPageHeader();
      drawTableHeader();
    };

    const addPage = () => {
      drawFooter();
      doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 42, right: 36, bottom: 40, left: 36 } });
      pageNumber += 1;
      startPage();
    };

    startPage();
    doc.font('Helvetica').fontSize(7).fillColor('#111827');

    rows.forEach((row, index) => {
      const values = scaledColumns.map(column => pdfText(row[column.key]));
      const heights = values.map((value, columnIndex) => doc.heightOfString(value, {
        width: scaledColumns[columnIndex].width - 8,
        lineGap: 1,
      }));
      const rowHeight = Math.max(22, Math.min(54, Math.max(...heights) + 10));
      if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 18) addPage();

      const y = doc.y;
      if (index % 2 === 1) {
        doc.save().fillColor('#F9FAFB').rect(doc.page.margins.left, y, pageWidth, rowHeight).fill().restore();
      }
      let x = doc.page.margins.left;
      doc.font('Helvetica').fontSize(7).fillColor('#111827');
      values.forEach((value, columnIndex) => {
        const width = scaledColumns[columnIndex].width;
        doc.text(value, x + 4, y + 5, {
          width: width - 8,
          height: rowHeight - 8,
          ellipsis: true,
          lineGap: 1,
        });
        x += width;
      });
      doc.moveTo(doc.page.margins.left, y + rowHeight)
        .lineTo(doc.page.margins.left + pageWidth, y + rowHeight)
        .strokeColor('#E5E7EB').lineWidth(0.35).stroke();
      doc.y = y + rowHeight;
    });

    if (!rows.length) {
      doc.fillColor('#6B7280').font('Helvetica').fontSize(10).text('Aucune ligne ne correspond aux filtres sélectionnés.', doc.page.margins.left, doc.y + 24, { width: pageWidth, align: 'center' });
    }
    drawFooter();
    doc.end();
  });
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
  if (collection.backupEnabled === false) throw new Error('La sauvegarde externe de cette collection n’est pas activée.');
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
    for (const collection of COLLECTIONS.filter(item => item.backupEnabled !== false)) results.push(await backupCollection(collection));
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

router.use((req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

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
    const records = filterExportRecords(await listRecords(collection), collection, req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${collection.key}.csv"`);
    res.send(recordsToCsv(records, collection));
  } catch (error) {
    console.error('[project-data] csv:', error.message);
    res.status(503).json({ error: 'Export CSV indisponible.' });
  }
});

router.get('/:collectionKey/export.pdf', async (req, res) => {
  const collection = collectionFor(req, res);
  if (!collection) return;
  try {
    const records = filterExportRecords(await listRecords(collection), collection, req.query);
    const pdf = await recordsToPdf(records, collection, { search: String(req.query.q || ''), status: String(req.query.status || 'all') });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${collection.key}.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.send(pdf);
  } catch (error) {
    console.error('[project-data] pdf:', error.message);
    res.status(503).json({ error: 'Export PDF indisponible.' });
  }
});

router.patch('/:collectionKey/records/:recordId', async (req, res) => {
  const collection = collectionFor(req, res);
  if (!collection) return;
  if (collection.readOnly) return res.status(403).json({ error: 'Cette collection est en lecture seule; la validation se fait sur le site Miss et Mister Dour.' });
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
  recordsToPdf,
  filterExportRecords,
  isoWeekKey,
  backupCollection,
  runProjectDataBackups,
  startProjectDataBackupScheduler,
  listRecords,
  publicCollection,
};
