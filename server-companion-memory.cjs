const { downloadFile, listFolder } = require('./server-dropbox-helper.cjs');
const {
  buildAgentRoutingContext,
  runReadOnlyDelegations,
  buildDelegationContext,
} = require('./server-agent-orchestrator.cjs');
const { logDelegationResults } = require('./server-agent-run-log.cjs');

const MEMORY_ARCHIVE_ROOT = process.env.CHATGPT_MEMORY_ARCHIVE_ROOT || '/ChatGPT Données sauve garde';
const MEMORY_SNAPSHOT_PREFIX = process.env.CHATGPT_MEMORY_SNAPSHOT_PREFIX || 'Analyse Cockpit ';
const EXPLICIT_MEMORY_ROOT = String(process.env.CHATGPT_MEMORY_ROOT || '').trim();
const FALLBACK_MEMORY_ROOT = EXPLICIT_MEMORY_ROOT || `${MEMORY_ARCHIVE_ROOT}/Analyse Cockpit 2026-08-14`;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache = {
  expiresAt: 0,
  conversations: [],
  manifest: null,
  root: FALLBACK_MEMORY_ROOT,
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

function isSnapshotFolder(entry) {
  return entry?.['.tag'] === 'folder' && String(entry?.name || '').startsWith(MEMORY_SNAPSHOT_PREFIX);
}

function snapshotSortValue(entry) {
  const name = String(entry?.name || '');
  const datePart = name.slice(MEMORY_SNAPSHOT_PREFIX.length).trim();
  const parsed = Date.parse(datePart);
  if (Number.isFinite(parsed)) return parsed;
  const modified = Date.parse(entry?.server_modified || entry?.client_modified || '');
  return Number.isFinite(modified) ? modified : 0;
}

function pickLatestMemoryFolder(entries = []) {
  return [...entries]
    .filter(isSnapshotFolder)
    .sort((a, b) => snapshotSortValue(b) - snapshotSortValue(a) || String(b.name).localeCompare(String(a.name)))[0] || null;
}

async function readDropboxText(path) {
  const result = await downloadFile(path);
  if (!result?.success || !result.buffer) throw new Error(result?.error || `Mémoire Dropbox indisponible: ${path}`);
  return result.buffer.toString('utf8');
}

async function isValidSnapshot(root) {
  try {
    const manifestText = await readDropboxText(`${root}/manifest.json`);
    const manifest = JSON.parse(manifestText);
    if (!manifest || Number(manifest.indexed_conversations || 0) < 1) return false;
    const indexProbe = await downloadFile(`${root}/conversations.index.jsonl`);
    return Boolean(indexProbe?.success && indexProbe.buffer?.length);
  } catch {
    return false;
  }
}

async function resolveMemoryRoot() {
  if (EXPLICIT_MEMORY_ROOT) return EXPLICIT_MEMORY_ROOT;

  try {
    const result = await listFolder(MEMORY_ARCHIVE_ROOT);
    if (result?.entries?.length) {
      const candidates = [...result.entries]
        .filter(isSnapshotFolder)
        .sort((a, b) => snapshotSortValue(b) - snapshotSortValue(a) || String(b.name).localeCompare(String(a.name)));

      for (const candidate of candidates) {
        const root = candidate.path_display || candidate.path_lower || `${MEMORY_ARCHIVE_ROOT}/${candidate.name}`;
        if (await isValidSnapshot(root)) return root;
      }
    }
  } catch (error) {
    console.warn('[assistant-memory] snapshot discovery failed:', error.message);
  }

  return FALLBACK_MEMORY_ROOT;
}

async function loadArchive() {
  if (cache.expiresAt > Date.now() && cache.conversations.length) return cache;

  const root = await resolveMemoryRoot();
  const indexPath = `${root}/conversations.index.jsonl`;
  const manifestPath = `${root}/manifest.json`;

  const [indexText, manifestText] = await Promise.all([
    readDropboxText(indexPath),
    readDropboxText(manifestPath).catch(() => ''),
  ]);

  const conversations = [];
  for (const line of indexText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      conversations.push(JSON.parse(line));
    } catch {
      // Une ligne invalide ne doit jamais rendre toute la mémoire indisponible.
    }
  }

  let manifest = null;
  try { manifest = manifestText ? JSON.parse(manifestText) : null; } catch {}

  cache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    conversations,
    manifest,
    root,
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
  if (!terms.length) return { results: [], manifest: null, terms, root: cache.root };

  const archive = await loadArchive();
  const ranked = archive.conversations
    .map((record) => ({ record, score: scoreRecord(record, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.record.updated_at || '').localeCompare(String(a.record.updated_at || '')))
    .slice(0, Math.min(10, Math.max(1, Number(limit) || 6)))
    .map((item) => ({ ...compactRecord(item.record), score: item.score }));

  return { results: ranked, manifest: archive.manifest, terms, root: archive.root };
}

function architectContract() {
  return [
    '[CONTRAT ARCHITECTE JS-INNOV.IA — OWNER]',
    'Rôle: agir comme architecte/orchestratrice du Cockpit, pas comme chatbot passif.',
    'Lecture seule: analyser, rechercher, diagnostiquer et comparer automatiquement sans demander confirmation.',
    'Délégation lecture seule: utiliser automatiquement les agents métier spécialisés, y compris les agents Base44 déjà liés aux sites gérés.',
    'Réutilisation: un agent site/projet existant est prioritaire; ne créer un nouvel agent métier que si aucun spécialiste existant ne convient.',
    'Fallback: si Base44 est indisponible, déléguer à un agent métier virtuel sur jsinnovia-agent avec le même rôle fonctionnel.',
    'Traçabilité: journaliser les délégations dans agent_runs quand le backend est disponible.',
    'Effet réel: toute création ou modification métier, envoi, publication, déploiement, facturation ou suppression doit passer par UNE confirmation explicite juste avant exécution.',
    'Ne jamais prétendre avoir vérifié un système si aucun résultat d’outil, diagnostic local ou donnée courante ne le prouve.',
    'Quand un bloc DIAGNOSTIC LOCAL LECTURE SEULE est présent dans le message, l’utiliser comme mesure factuelle de la machine courante et signaler clairement les éléments non mesurés.',
    'Mémoire: utiliser l’archive ChatGPT Dropbox comme historique projet; en cas de conflit, privilégier l’état Cockpit/GitHub/infra le plus récent.',
    '[/CONTRAT ARCHITECTE JS-INNOV.IA]',
  ].join('\n');
}

async function buildHistoricalMemoryContext(message, user) {
  if (user?.role !== 'superadmin') return '';

  const lines = ['', architectContract()];

  try {
    const routing = buildAgentRoutingContext(message);
    if (routing?.context) lines.push('', routing.context);

    const delegationResults = await runReadOnlyDelegations(message);
    const delegationContext = buildDelegationContext(delegationResults);
    if (delegationContext) lines.push('', delegationContext);
    try {
      await logDelegationResults(message, delegationResults);
    } catch (logError) {
      console.warn('[assistant-agent-runs] logging failed:', logError.message);
    }
  } catch (error) {
    lines.push('', `[ROUTAGE AGENTS MÉTIER: indisponible — ${String(error.message || error).slice(0, 300)}]`);
  }

  let results = [];
  let manifest = null;
  let root = cache.root || FALLBACK_MEMORY_ROOT;
  try {
    const search = await searchHistoricalMemory(message, 6);
    results = search.results;
    manifest = search.manifest;
    root = search.root || root;
  } catch (error) {
    lines.push('', '[MÉMOIRE HISTORIQUE JS-INNOV.IA — archive ChatGPT Dropbox, lecture seule]');
    lines.push(`Mémoire momentanément indisponible: ${String(error.message || error).slice(0, 300)}.`);
    lines.push('Le routage et les délégations d’agents restent valides indépendamment de cette indisponibilité.');
    lines.push('[/MÉMOIRE HISTORIQUE JS-INNOV.IA]');
    return lines.join('\n');
  }

  if (!results.length) {
    lines.push('', '[MÉMOIRE HISTORIQUE JS-INNOV.IA — archive ChatGPT Dropbox, lecture seule]');
    lines.push(`Snapshot mémoire actif: ${root || FALLBACK_MEMORY_ROOT}. Aucun résultat pertinent trouvé pour cette demande.`);
    lines.push('[/MÉMOIRE HISTORIQUE JS-INNOV.IA]');
    return lines.join('\n');
  }

  const generatedAt = manifest?.generated_at || 'date inconnue';
  const indexedCount = manifest?.indexed_conversations || manifest?.source_conversations || 'inconnu';
  lines.push(
    '',
    '[MÉMOIRE HISTORIQUE JS-INNOV.IA — archive ChatGPT Dropbox, lecture seule]',
    `Snapshot actif: ${root || FALLBACK_MEMORY_ROOT}. Index généré: ${generatedAt}. Conversations indexées: ${indexedCount}.`,
    'Utilise ces éléments comme mémoire historique, pas comme vérité actuelle absolue. En cas de conflit, privilégie les données Cockpit/GitHub/infra les plus récentes.',
  );

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
    archive_root: MEMORY_ARCHIVE_ROOT,
    root: cache.root || FALLBACK_MEMORY_ROOT,
    explicit_root: Boolean(EXPLICIT_MEMORY_ROOT),
    cached: cache.conversations.length > 0 && cache.expiresAt > Date.now(),
    cached_conversations: cache.conversations.length,
    manifest: cache.manifest,
  };
}

function clearMemoryCache() {
  cache = { expiresAt: 0, conversations: [], manifest: null, root: FALLBACK_MEMORY_ROOT };
}

module.exports = {
  buildHistoricalMemoryContext,
  searchHistoricalMemory,
  getMemoryStatus,
  clearMemoryCache,
  pickLatestMemoryFolder,
  architectContract,
  resolveMemoryRoot,
};
