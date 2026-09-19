const { stripInjectedContext } = require('./server-immediate-execution-policy.cjs');

function clean(value, max = 4000) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}

function normalizeLookup(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHistoricalDuplicateTask(task = {}) {
  const notes = normalizeLookup(task.notes);
  return /exact duplicate|semantic duplicate|doublon.*(?:tache canonique|sans suppression)|doublon regroupe avec la tache/.test(notes);
}

function completedTask(task = {}) {
  return ['termine', 'terminee', 'completed', 'done', 'closed'].includes(normalizeLookup(task.statut || task.status).replace(/ /g, '_'));
}

function taskMatchScore(task = {}, message = '') {
  const title = normalizeLookup(task.titre || task.title);
  const query = normalizeLookup(message);
  if (!title || !query || title.length < 5) return 0;
  if (query === title) return 1000;
  if (query.includes(title)) return 900 + Math.min(title.length, 90);
  if (title.includes(query) && query.length >= 12) return 800 + Math.min(query.length, 90);
  const titleTokens = new Set(title.split(' ').filter((token) => token.length >= 4));
  const queryTokens = new Set(query.split(' ').filter((token) => token.length >= 4));
  if (!titleTokens.size || !queryTokens.size) return 0;
  const common = [...titleTokens].filter((token) => queryTokens.has(token)).length;
  const coverage = common / Math.max(1, titleTokens.size);
  return common >= 2 && coverage >= 0.6 ? Math.round(500 + coverage * 100 + common * 5) : 0;
}

function pickRelevantTask(tasks = [], message = '', organisation = '') {
  const tenant = normalizeLookup(organisation);
  const candidates = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => {
      if (!tenant) return true;
      const taskTenant = normalizeLookup(task.organisation_id);
      return !taskTenant || taskTenant === tenant;
    })
    .map((task) => ({ task, score: taskMatchScore(task, message) }))
    .filter(({ score }) => score >= 500)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const duplicateA = Number(isHistoricalDuplicateTask(a.task));
      const duplicateB = Number(isHistoricalDuplicateTask(b.task));
      if (duplicateA !== duplicateB) return duplicateA - duplicateB;
      const completedA = Number(completedTask(a.task));
      const completedB = Number(completedTask(b.task));
      if (completedA !== completedB) return completedA - completedB;
      return Date.parse(b.task.updated_at || b.task.created_at || 0) - Date.parse(a.task.updated_at || a.task.created_at || 0);
    });
  return candidates[0]?.task || null;
}

function latestMarker(source = '', pattern) {
  const matches = [...String(source || '').matchAll(pattern)];
  return matches.length ? String(matches[matches.length - 1][1] || '').trim().slice(0, 500) : '';
}

function missingVideoFields(task = {}) {
  const source = `${task.description || ''}\n${task.notes || ''}`;
  const marker = latestMarker(source, /generation_video_incomplete\s*:\s*([^\n]+)/gi);
  if (!marker) return [];
  return [...new Set(marker.split(',').map((item) => clean(item, 120)).filter(Boolean))];
}

function taskContextBlock(task = {}, allTasks = []) {
  if (!task?.id) return '';
  const normalizedTitle = normalizeLookup(task.titre || task.title);
  const sameObjective = (Array.isArray(allTasks) ? allTasks : []).filter((candidate) =>
    normalizeLookup(candidate.titre || candidate.title) === normalizedTitle
      && String(candidate.id || '') !== String(task.id || '')
  );
  const missing = missingVideoFields(task);
  const realBlocker = latestMarker(task.notes, /Blocage d[’']exécution réel\s*:\s*([^\n]+)/gi);
  const localQueue = /Mise en file Windows locale\s*:\s*run_id=([A-Za-z0-9_-]+)/i.exec(String(task.notes || ''))?.[1] || '';
  const sourceIds = [...String(`${task.description || ''}\n${task.notes || ''}`).matchAll(/(?:source_document_id|end_source_document_id|start_source_document_id|Index Cockpit)\s*[:=]\s*([A-Za-z0-9_-]{8,180})/gi)]
    .map((match) => match[1])
    .filter(Boolean);
  return [
    '[TÂCHE COCKPIT PERTINENTE — état serveur actuel]',
    'Les données ci-dessous décrivent une tâche existante. Ne pas recréer cette tâche et ne pas repartir d’un questionnaire générique.',
    `id: ${clean(task.id, 120)}`,
    `titre: ${clean(task.titre || task.title, 300)}`,
    `statut: ${clean(task.statut || task.status, 80) || 'non renseigné'}`,
    `priorité: ${clean(task.priorite || task.priority, 80) || 'non renseignée'}`,
    task.client_id || task.client_nom ? `client: ${clean(task.client_nom || task.client_id, 300)}` : '',
    task.projet_id || task.projet_nom ? `projet: ${clean(task.projet_nom || task.projet_id, 300)}` : '',
    task.description ? `description: ${clean(task.description, 2200)}` : '',
    missing.length ? `champs techniques encore manquants détectés: ${missing.join(', ')}` : '',
    sourceIds.length ? `documents source déjà référencés: ${[...new Set(sourceIds)].join(', ')}` : '',
    realBlocker ? `dernier blocage d’exécution enregistré: ${clean(realBlocker, 500)}` : '',
    localQueue ? `ancienne mise en file locale détectée: ${clean(localQueue, 160)}` : '',
    sameObjective.length ? `autres enregistrements portant le même titre: ${sameObjective.length} (historique conservé; ne pas les traiter comme de nouvelles demandes)` : '',
    'Règle: utiliser d’abord cette fiche, les médias récents et les capacités du Cockpit. Ne demander à l’utilisateur que l’information réellement absente après ces vérifications.',
    '[/TÂCHE COCKPIT PERTINENTE]',
  ].filter(Boolean).join('\n');
}

function videoEnvironmentContext({ task = null, recentMedia = null, availableActions = [], localEnvironment = null } = {}) {
  const title = normalizeLookup(task?.titre || task?.title);
  const text = normalizeLookup(`${task?.titre || ''} ${task?.description || ''} ${task?.notes || ''}`);
  const isVideo = /video|cinematograph|3d|grok|sora|morph|animation|motion/.test(`${title} ${text}`);
  if (!isVideo) return '';
  const canCreate = availableActions.includes('create_video_generation');
  const recentLocal = localEnvironment?.recently_reachable === true;
  const missing = missingVideoFields(task || {});
  return [
    '[ENVIRONNEMENT DE PRODUCTION VIDÉO JS-INNOV.IA — capacités connues]',
    canCreate
      ? 'La route Cockpit create_video_generation est disponible pour cette session.'
      : 'La route create_video_generation n’est pas autorisée pour cette session; ne pas simuler son exécution.',
    'Providers serveur connus: mode auto, Grok Imagine/xAI et Sora/OpenAI. Une image source Cockpit est routée vers Grok Imagine.',
    'Defaults du pipeline vidéo serveur actuel: 8 secondes, format 16:9. Le livrable final est un MP4 finalisé, vérifié par FFmpeg/FFprobe, avec SHA-256 et archivage Dropbox.',
    'Le style « cinématographique 3D » peut être traité comme direction visuelle à partir d’un prompt ou d’une image source; ne pas demander si des modèles 3D existent sauf si la tâche exige explicitement un fichier 3D importé.',
    recentMedia?.documentId
      ? `Un média récent est déjà disponible: document Cockpit ${clean(recentMedia.documentId, 160)}. L’utiliser avant de demander un nouvel upload si pertinent.`
      : '',
    recentLocal
      ? `Le pont local Windows a été joint récemment${localEnvironment.last_autopilot_success_at ? ` (${clean(localEnvironment.last_autopilot_success_at, 80)})` : ''}. Pour ComfyUI/MiniMax/FFmpeg local, vérifier l’état courant avec les outils locaux avant toute affirmation.`
      : 'Le Cockpit connaît un environnement local Windows/ComfyUI, mais son état courant n’est pas prouvé par cette requête. Ne pas le déclarer hors ligne; demander un diagnostic local seulement si le workflow choisi en dépend.',
    missing.includes('source_document_id')
      ? 'La tâche signale précisément source_document_id manquant: demander uniquement quelle image existante utiliser ou proposer de joindre/sélectionner l’image source. Ne pas redemander durée, format de sortie ou disponibilité de modèles 3D.'
      : '',
    'Ne pas poser un questionnaire générique « scénario / durée / style / ressources 3D / format ». Utiliser les defaults et le contexte déjà connu, puis demander seulement les choix créatifs ou sources encore indispensables.',
    '[/ENVIRONNEMENT DE PRODUCTION VIDÉO JS-INNOV.IA]',
  ].filter(Boolean).join('\n');
}

function recentMediaLines(media) {
  if (!media || typeof media !== 'object') return [];
  const lines = [];
  const fileName = clean(media.fileName || media.originalFileName, 300);
  const documentId = clean(media.documentId, 120);
  const dropboxPath = clean(media.dropboxPath, 1200);
  if (fileName) lines.push(`Média source: ${fileName}`);
  if (documentId) lines.push(`Index Cockpit: ${documentId}`);
  if (dropboxPath) lines.push(`Chemin Dropbox: ${dropboxPath}`);
  return lines;
}

function enrichTaskBatchWithRequestContext(payload = {}, message = '', recentMedia = null) {
  if (!Array.isArray(payload?.tasks)) return payload;
  const request = clean(stripInjectedContext(message), 4000);
  const contextLines = [request ? `Demande source: ${request}` : '', ...recentMediaLines(recentMedia)].filter(Boolean);
  if (!contextLines.length) return payload;
  return {
    ...payload,
    tasks: payload.tasks.map((task) => {
      if (!task || typeof task !== 'object') return task;
      const existing = String(task.description || '').trim();
      const missing = contextLines.filter((line) => !existing.includes(line));
      return { ...task, description: [existing, ...missing].filter(Boolean).join('\n').slice(0, 5000) };
    }),
  };
}

module.exports = {
  enrichTaskBatchWithRequestContext,
  recentMediaLines,
  normalizeLookup,
  isHistoricalDuplicateTask,
  taskMatchScore,
  pickRelevantTask,
  missingVideoFields,
  taskContextBlock,
  videoEnvironmentContext,
};
