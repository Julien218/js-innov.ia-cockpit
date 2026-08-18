const { downloadFile } = require('./server-dropbox-helper.cjs');

const MEMORY_ROOT = process.env.CHATGPT_MEMORY_ROOT || '/ChatGPT Données sauve garde/Analyse Cockpit 2026-08-14';
const INDEX_PATH = process.env.CHATGPT_MEMORY_INDEX_PATH || `${MEMORY_ROOT}/conversations.index.jsonl`;
const MANIFEST_PATH = process.env.CHATGPT_MEMORY_MANIFEST_PATH || `${MEMORY_ROOT}/manifest.json`;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache = {
  expiresAt: 0,
  conversations: [],
  manifest: null,
};

const STOP_WORDS = new Set([
  'avec', 'dans', 'pour', 'sur', 'une', 'des', 'les', 'que', 'qui', 'quoi', 'mon', 'mes', 'ton', 'tes', 'son', 'ses',
  'nous', 'vous', 'leur', 'leurs', 'est', 'sont', 'ete', 'être', 'avoir', 'fait', 'faire', 'plus', 'tout', 'tous', 'toutes',
  'cela', 'cette', 'ceci', 'comme', 'mais', 'donc', 'alors', 'aussi', 'encore', 'deja', 'déjà', 'moi', 'toi', 'peux', 'peut',
  'regarde', 'verifie', 'vérifie', 'analyse', 'continue', 'merci', 'oui', 'non', 'oki', 'ok',
]);

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function queryTerms(message) {
  return [...new Set(normalize(message)
    .replace(/[^a-z0-9._-]+/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term)))]
    .slice(0, 12);
}

async function readDropboxText(path) {
  const result = await downloadFile(path);
  if (!result?.success || !result.buffer) throw new Error(result?.error || `Mémoire Dropbox indisponible: ${path}`);
  return result.buffer.toString('utf8');
}

async function loadArchive() {
  if (cache.expiresAt > Date.now() && cache.conversations.length) return cache;

  const [indexText, manifestText] = await Promise.all([
    readDropboxText(INDEX_PATH),
    readDropboxText(MANIFEST_PATH).catch(() => ''),
  ]);

  const conversations = [];
  for (const line of indexText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      conversations.push(item);
    } catch {
      // Une ligne invalide ne doit pas rendre toute la mémoire indisponible.
    }
  }

  let manifest = null;
  try { manifest = manifestText ? JSON.parse(manifestText) : null; } catch {}

  cache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    conversations,
    manifest,
  };
  return cache;
}

function scoreRecord(record, terms) {
  if (!terms.length) return 0;
  const title = normalize(record.title);
  const projects = normalize((record.projects || []).join(' '));
  const clients = normalize((record.clients || []).join(' '));
  const excerpts = normalize((record.excerpts || []).join(' '));
  const tasks = normalize((record.tasks || []).join(' '));
  const decisions = normalize((record.decisions || []).join(' '));

  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 12;
    if (projects.includes(term)) score += 9;
    if (clients.includes(term)) score += 9;
    if (excerpts.includes(term)) score += 5;
    if (decisions.includes(term)) score += 4;
    if (tasks.includes(term)) score += 3;
  }

  const updated = Date.parse(record.updated_at || record.created_at || '');
  if (Number.isFinite(updated)) {
    const ageDays = Math.max(0, (Date.now() - updated) / 86400000);
    if (ageDays < 30) score += 3;
    else if (ageDays < 180) score += 1;
  }
  return score;
}

function compactRecord(record) {
  return {
    id: record.id,
    title: String(record.title || '').slice(0, 180),
    updated_at: record.updated_at || record.created_at || null,
    projects: Array.isArray(record.projects) ? record.projects.slice(0, 6) : [],
    clients: Array.isArray(record.clients) ? record.clients.slice(0, 6) : [],
    tasks: Array.isArray(record.tasks) ? record.tasks.slice(0, 3).map((v) => String(v).slice(0, 350)) : [],
    decisions: Array.isArray(record.decisions) ? record.decisions.slice(0, 3).map((v) => String(v).slice(0, 350)) : [],
    excerpts: Array.isArray(record.excerpts) ? record.excerpts.slice(0, 4).map((v) => String(v).slice(0, 500)) : [],
    fingerprint: record.fingerprint || null,
  };
}

async function searchHistoricalMemory(message, limit = 6) {
  const terms = queryTerms(message);
  if (!terms.length) return { results: [], manifest: null, terms };

  const archive = await loadArchive();
  const ranked = archive.conversations
    .map((record) => ({ record, score: scoreRecord(record, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.record.updated_at || '').localeCompare(String(a.record.updated_at || '')))
    .slice(0, Math.min(10, Math.max(1, Number(limit) || 6)))
    .map((item) => ({ ...compactRecord(item.record), score: item.score }));

  return { results: ranked, manifest: archive.manifest, terms };
}

async function buildHistoricalMemoryContext(message, user) {
  if (user?.role !== 'superadmin') return '';
  const { results, manifest } = await searchHistoricalMemory(message, 6);
  if (!results.length) return '';

  const generatedAt = manifest?.generated_at || 'date inconnue';
  const indexedCount = manifest?.indexed_conversations || manifest?.source_conversations || 'inconnu';
  const lines = [
    '',
    '[MÉMOIRE HISTORIQUE JS-INNOV.IA — archive ChatGPT Dropbox, lecture seule]',
    `Index généré: ${generatedAt}. Conversations indexées: ${indexedCount}.`,
    'Utilise ces éléments comme mémoire historique, pas comme vérité actuelle absolue. En cas de conflit, privilégie les données Cockpit/GitHub/infra les plus récentes.',
  ];

  for (const item of results) {
    lines.push(`- ${item.title} (${item.updated_at || 'date inconnue'})`);
    if (item.projects.length) lines.push(`  projets: ${item.projects.join(', ')}`);
    if (item.clients.length) lines.push(`  clients: ${item.clients.join(', ')}`);
    if (item.decisions.length) lines.push(`  décisions: ${item.decisions.join(' | ')}`);
    if (item.tasks.length) lines.push(`  tâches: ${item.tasks.join(' | ')}`);
    if (item.excerpts.length) lines.push(`  extraits: ${item.excerpts.join(' | ')}`);
  }
  lines.push('[/MÉMOIRE HISTORIQUE JS-INNOV.IA]');
  return lines.join('\n');
}

function getMemoryStatus() {
  return {
    root: MEMORY_ROOT,
    index_path: INDEX_PATH,
    manifest_path: MANIFEST_PATH,
    cached: cache.conversations.length > 0 && cache.expiresAt > Date.now(),
    cached_conversations: cache.conversations.length,
    manifest: cache.manifest,
  };
}

function clearMemoryCache() {
  cache = { expiresAt: 0, conversations: [], manifest: null };
}

module.exports = {
  buildHistoricalMemoryContext,
  searchHistoricalMemory,
  getMemoryStatus,
  clearMemoryCache,
};
