/**
 * server-dropbox-helper.cjs — Intégration Dropbox pour l'assistant local
 *
 * Permet à l'assistant IA de:
 * - Lister et parcourir les fichiers Dropbox
 * - Vérifier l'état des factures/fichiers
 * - UPLOADER et CLASSIFIER des documents reçus depuis le cockpit
 * Tourne entièrement sur Railway, zéro dépendance Base44.
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

// === Upload a file to Dropbox ===
async function uploadFile(dropboxPath, buffer) {
  const token = await getAccessToken();
  if (!token) return { error: 'Dropbox non configuré' };

  try {
    const resp = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: dropboxPath,
          mode: 'overwrite',
          autorename: false,
          mute: true,
        }),
      },
      body: buffer,
    });
    const data = await resp.json();
    if (!resp.ok) return { error: data.error_summary || 'Upload failed' };
    return {
      success: true,
      path: data.path_display,
      id: data.id,
      size: data.size,
      name: data.name,
    };
  } catch (err) {
    return { error: err.message };
  }
}

// === Create a folder if it does not exist ===
async function ensureFolder(folderPath) {
  const token = await getAccessToken();
  if (!token) return { error: 'Dropbox non configuré' };

  try {
    const resp = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath }),
    });
    const data = await resp.json();
    if (resp.ok || (data.error && data.error[.tag] === 'path_conflict')) {
      return { success: true, path: folderPath };
    }
    return { error: data.error_summary || 'Create folder failed' };
  } catch (err) {
    return { error: err.message };
  }
}

// === Get file metadata (download for text extraction) ===
async function downloadFile(dropboxPath) {
  const token = await getAccessToken();
  if (!token) return { error: 'Dropbox non configuré' };

  try {
    const resp = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }),
      },
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      return { error: data.error_summary || 'Download failed' };
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    return { success: true, buffer };
  } catch (err) {
    return { error: err.message };
  }
}

// === Get all invoice PDFs from Dropbox ===
async function getInvoiceFiles() {
  const token = await getAccessToken();
  if (!token) return { error: 'Dropbox non configuré', pdfs: [] };

  try {
    const clientsResp = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `${ROOT_PATH}/Clients` }),
    });
    const clientsData = await clientsResp.json();
    if (!clientsResp.ok) return { error: clientsData.error_summary || 'Clients folder not found', pdfs: [] };

    const clientFolders = clientsData.entries.filter(e => e['.tag'] === 'folder');
    const allPdfs = [];

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

// === Classify a document and determine its Dropbox path ===
// Uses AI to determine: client, document type, project
async function classifyDocument(fileName, mimeType, fileSize, clients, message) {
  const clientNames = clients.map(c => `"${c.nom || c.entreprise || c.name || ''}"`).filter(Boolean).join(', ');

  // Determine document type from filename
  const lowerName = fileName.toLowerCase();
  let docType = 'document';
  if (lowerName.includes('facture') || lowerName.includes('invoice')) docType = 'Factures';
  else if (lowerName.includes('devis') || lowerName.includes('quote')) docType = 'Devis';
  else if (lowerName.includes('contrat') || lowerName.includes('contract')) docType = 'Contrats';
  else if (lowerName.includes('projet') || lowerName.includes('project')) docType = 'Projets';
  else if (lowerName.includes('logo') || lowerName.includes('brand')) docType = 'Branding';
  else if (lowerName.includes('video') || lowerName.includes('spot')) docType = 'Videos';
  else if (lowerName.includes('rapport') || lowerName.includes('report')) docType = 'Rapports';

  // Try to match a client from filename
  let matchedClient = null;
  for (const c of clients) {
    const cname = (c.nom || c.entreprise || c.name || '').toLowerCase();
    if (cname && lowerName.includes(cname.split(' ')[0].toLowerCase())) {
      matchedClient = c;
      break;
    }
  }

  // If message contains context, try to match client from message
  if (!matchedClient && message) {
    const lowerMsg = message.toLowerCase();
    for (const c of clients) {
      const cname = (c.nom || c.entreprise || c.name || '').toLowerCase();
      if (cname && lowerMsg.includes(cname)) {
        matchedClient = c;
        break;
      }
    }
  }

  // Build the suggested path
  let folderPath;
  if (matchedClient) {
    const clientFolder = (matchedClient.nom || matchedClient.entreprise || matchedClient.name || 'Inconnu').replace(/[^a-zA-Z0-9_-]/g, '_');
    folderPath = `${ROOT_PATH}/Clients/${clientFolder}/${docType}`;
  } else {
    folderPath = `${ROOT_PATH}/A_Classer`;
  }

  return {
    docType,
    matchedClient: matchedClient ? {
      id: matchedClient.id,
      name: matchedClient.nom || matchedClient.entreprise || matchedClient.name,
    } : null,
    suggestedPath: `${folderPath}/${fileName}`,
    folderPath,
    fileSize,
    mimeType,
  };
}

module.exports = {
  getAccessToken,
  listFolder,
  uploadFile,
  ensureFolder,
  downloadFile,
  getInvoiceFiles,
  getInvoiceSyncStatus,
  isDropboxRelated,
  buildDropboxContext,
  classifyDocument,
};
