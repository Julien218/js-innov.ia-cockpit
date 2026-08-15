/**
 * server-dropbox-helper.cjs — Intégration Dropbox pour l'assistant local
 * 
 * Permet à l'assistant IA de vérifier l'état des factures/fichiers sur Dropbox
 * sans dépendre de Base44. Tourne entièrement sur Railway.
 */

const APP_KEY = process.env.DROPBOX_APP_KEY || '';
const APP_SECRET = process.env.DROPBOX_APP_SECRET || '';
const REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN || '';
const ROOT_PATH = process.env.DROPBOX_ROOT_PATH || '/Cockpit';

let cachedToken = null;
let tokenExpiry = 0;

// === Token management ===
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  if (!APP_KEY || !APP_SECRET || !REFRESH_TOKEN) return null;

  try {
    const resp = await fetch('https://api.dropbox.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${REFRESH_TOKEN}&client_id=${APP_KEY}&client_secret=${APP_SECRET}`,
    });
    const data = await resp.json();
    if (!data.access_token) throw new Error('No access token in response');
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return cachedToken;
  } catch (err) {
    console.warn('[dropbox] Token refresh failed:', err.message);
    return null;
  }
}

// === List files in a Dropbox folder ===
async function listFolder(path) {
  const token = await getAccessToken();
  if (!token) return { error: 'Dropbox non configuré' };

  try {
    const resp = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const data = await resp.json();
    if (!resp.ok) return { error: data.error_summary || 'List failed' };
    return { entries: data.entries || [] };
  } catch (err) {
    return { error: err.message };
  }
}

// === Get all invoice PDFs from Dropbox ===
async function getInvoiceFiles() {
  const token = await getAccessToken();
  if (!token) return { error: 'Dropbox non configuré', pdfs: [] };

  try {
    // List client folders
    const clientsResp = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `${ROOT_PATH}/Clients` }),
    });
    const clientsData = await clientsResp.json();
    if (!clientsResp.ok) return { error: clientsData.error_summary || 'Clients folder not found', pdfs: [] };

    const clientFolders = clientsData.entries.filter(e => e['.tag'] === 'folder');
    const allPdfs = [];

    // For each client folder, list Factures subfolder
    for (const client of clientFolders) {
      const facturesResp = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `${client.path_display}/Factures` }),
      });
      if (!facturesResp.ok) continue;
      const facturesData = await facturesResp.json();
      const pdfs = (facturesData.entries || []).filter(e => e.name.endsWith('.pdf'));
      for (const pdf of pdfs) {
        allPdfs.push({
          name: pdf.name,
          client: client.name.replace(/_/g, ' '),
          path: pdf.path_display,
          size: pdf.size || 0,
          modified: pdf.client_modified || '',
        });
      }
    }

    return { pdfs: allPdfs, count: allPdfs.length };
  } catch (err) {
    return { error: err.message, pdfs: [] };
  }
}

// === Compare Dropbox invoices with Supabase invoices ===
async function getInvoiceSyncStatus(supabaseInvoices) {
  const dropboxResult = await getInvoiceFiles();
  if (dropboxResult.error) {
    return { error: dropboxResult.error, dropbox: [], supabase: supabaseInvoices };
  }

  const dropboxNumbers = new Set(dropboxResult.pdfs.map(p => p.name.split('_')[0]));
  const supabaseNumbers = new Set(supabaseInvoices.map(f => f.numero));
  
  const onlyDropbox = [...dropboxNumbers].filter(n => !supabaseNumbers.has(n));
  const onlySupabase = [...supabaseNumbers].filter(n => !dropboxNumbers.has(n));
  const synced = [...dropboxNumbers].filter(n => supabaseNumbers.has(n));

  return {
    synced: synced.length,
    onlyDropbox: onlyDropbox,
    onlySupabase: onlySupabase,
    dropboxTotal: dropboxResult.count,
    supabaseTotal: supabaseInvoices.length,
    dropboxFiles: dropboxResult.pdfs.map(p => p.name),
    status: onlyDropbox.length === 0 && onlySupabase.length === 0 ? 'synced' : 'mismatch',
  };
}

// === Detect if a message is Dropbox/invoice related ===
function isDropboxRelated(message) {
  const lower = message.toLowerCase();
  const keywords = ['dropbox', 'facture', 'fichier', 'document', 'pdf', 'sync', 'synchronisation', 'à jour', 'a jour', 'factures'];
  return keywords.some(kw => lower.includes(kw));
}

// === Build context string for the LLM ===
async function buildDropboxContext(message) {
  if (!isDropboxRelated(message)) return '';

  const invoices = await getInvoiceFiles();
  if (invoices.error) return `\n[Contexte Dropbox: Erreur - ${invoices.error}]`;
  if (invoices.count === 0) return '\n[Contexte Dropbox: Aucun fichier PDF trouvé dans /Cockpit/Clients/*/Factures/]';

  const fileList = invoices.pdfs.map(p => `  - ${p.name} (${p.client})`).join('\n');
  return `\n[Contexte Dropbox — ${invoices.count} PDFs de factures trouvés:\n${fileList}\n]`;
}

module.exports = {
  getAccessToken,
  listFolder,
  getInvoiceFiles,
  getInvoiceSyncStatus,
  isDropboxRelated,
  buildDropboxContext,
};
