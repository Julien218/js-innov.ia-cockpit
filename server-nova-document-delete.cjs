const express = require('express');
const crypto = require('node:crypto');
const { cleanTenant } = require('./server-tenant.cjs');
const { hasPermission } = require('./server-permission-policy.cjs');

const norm = value => String(value || '').normalize('NFC').replace(/\\_/g, '_').toLowerCase();
const plain = value => norm(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const locks = new Set();
const rows = value => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];

function deletionMention(message) {
  return /supprim|effac|effec|\bdelete\b/.test(plain(message)) && /dropbox|fichier|image|photo|document|\.png|\.jpg|\.pdf|\.mp4/.test(plain(message));
}

function explicitDeletion(message) {
  const text = plain(message).trim();
  if (/\b(?:ne|sans|pas|jamais|comment|pourquoi|hier|avant|si)\b|lecture seule|definitiv|permanent|dossier|tous|toutes|plusieurs/.test(text)) return false;
  return /^(?:(?:bonjour|salut|hello)[,!\s]+)?(?:(?:peux[- ]tu|pouvez[- ]vous|pourrais[- ]tu|merci de|je veux|je souhaite)\s+)?(?:supprime[rz]?|efface[rz]?|effece[rz]?|delete)\b/.test(text);
}

function exactMention(message, value, caseSensitive = false) {
  if (!value) return false;
  const normalize = caseSensitive ? input => String(input || '').normalize('NFC').replace(/\\_/g, '_') : norm;
  const text = normalize(message), needle = normalize(value);
  let offset = text.indexOf(needle);
  while (offset !== -1) {
    const before = text[offset - 1] || '', after = text[offset + needle.length] || '';
    if (!/[\p{L}\p{N}_.-]/u.test(before) && !/[\p{L}\p{N}_.-]/u.test(after)) return true;
    offset = text.indexOf(needle, offset + 1);
  }
  return false;
}

function documentPaths(doc) {
  const full = doc.dropbox_path || '';
  const cockpit = norm(full).indexOf('/cockpit/');
  return [full, cockpit >= 0 ? full.slice(cockpit) : ''].filter(Boolean);
}

function resolveDocument(message, documents, tenant) {
  if (documents.length >= 1000) throw new Error('Index trop volumineux : préciser un identifiant documentaire pour un contrôle ciblé.');
  // Include tombstones so an interrupted index/journal update can be resumed.
  const eligible = documents.filter(doc => cleanTenant(doc.organisation) === tenant);
  const explicit = eligible.filter(doc => documentPaths(doc).some(path => exactMention(message, path)) || exactMention(message, doc.dropbox_file_id, true) || exactMention(message, doc.id));
  const matches = explicit.length ? explicit : eligible.filter(doc => {
    // An unmatched supplied path must never fall back to a same-named file elsewhere.
    return exactMention(message, doc.filename) && !norm(message).includes('/' + norm(doc.filename)) && !norm(message).includes('\\' + norm(doc.filename));
  });
  if (matches.length !== 1) throw new Error(matches.length ? 'Plusieurs fichiers correspondent : fournir le chemin exact d’un seul fichier.' : 'Aucun fichier unique identifié : fournir son nom complet, son chemin Dropbox ou son identifiant documentaire.');
  const doc = matches[0];
  if (!/^id:[A-Za-z0-9_-]+$/.test(doc.dropbox_file_id || '') || !doc.filename) throw new Error('Identité Dropbox du fichier absente ou invalide.');
  return doc;
}

function notFound(error) { return error?.dropboxNotFound === true; }

function productionDependencies() {
  const documents = require('./server-documents.cjs');
  const base = String(process.env.JSINNOVIA_AGENT_URL || process.env.AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app').replace(/\/$/, '');
  const key = process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY;
  return {
    async request(path, options = {}, tenant) {
      if (!key) throw new Error('Index documentaire non configuré.');
      const response = await fetch(`${base}${path}`, { ...options,
        headers: { 'Content-Type': 'application/json', 'x-agent-key': key, 'x-organisation-id': tenant },
        body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: AbortSignal.timeout(30000) });
      const data = await response.json().catch(() => null);
      if (!response.ok || data === null) throw new Error(`Index/journal indisponible (HTTP ${response.status}).`);
      return data;
    },
    async dropbox(route, body) {
      const token = await documents.getDropboxAccessToken();
      const response = await fetch(`https://api.dropboxapi.com/2/files/${route}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(`Dropbox ${route} refusé (HTTP ${response.status}).`);
        error.dropboxNotFound = route === 'get_metadata' && response.status === 409 && data.error?.['.tag'] === 'path' && data.error.path?.['.tag'] === 'not_found';
        throw error;
      }
      return data;
    },
  };
}

async function deleteFromMessage({ message, user, deps = productionDependencies() }) {
  const tenant = cleanTenant(user?.organisation);
  if (!user?.id || !tenant || !['admin', 'superadmin'].includes(user.role) || !hasPermission(user, 'documents') || !hasPermission(user, 'tasks')) {
    return { success: false, content: 'Suppression refusée : permissions Documents et Tâches et rôle administrateur requis.', result: null };
  }
  if (!explicitDeletion(message)) return { success: false, content: 'Aucune suppression effectuée. Pour supprimer un seul fichier, indiquez « Supprime le fichier Dropbox » suivi de son nom complet ou de son chemin. Les dossiers et suppressions définitives ne sont pas autorisés ici.', result: null };
  const request = (path, options) => deps.request(path, options, tenant);
  let doc, task, run;
  const proof = { dropbox_deleted: false, index_hidden: false, verified: false };
  try {
    const documentIds = [...String(message).matchAll(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi)].map(match => match[0]);
    const index = documentIds.length === 1
      ? [await request(`/data/DocumentIndex/${encodeURIComponent(documentIds[0])}`)]
      : rows(await request(`/data/DocumentIndex?organisation=${encodeURIComponent(tenant)}&limit=1000`));
    doc = resolveDocument(message, index, tenant);
    const lock = `${tenant}:${doc.dropbox_file_id}`;
    if (locks.has(lock)) return { success: false, content: 'La suppression de ce fichier est déjà en cours. Aucune seconde suppression lancée.', result: null };
    locks.add(lock);
    proof.document_id = doc.id;
    proof.dropbox_file_id = doc.dropbox_file_id;
    proof.filename = doc.filename;
    proof.dropbox_path = doc.dropbox_path;
    let metadata;
    try { metadata = await deps.dropbox('get_metadata', { path: doc.dropbox_file_id }); }
    catch (error) { if (!notFound(error)) throw error; proof.already_absent = true; }
    if (metadata && (metadata['.tag'] !== 'file' || metadata.id !== doc.dropbox_file_id || norm(metadata.name) !== norm(doc.filename) || !metadata.rev || !doc.dropbox_path || norm(metadata.path_display || metadata.path_lower) !== norm(doc.dropbox_path))) throw new Error('Le fichier a changé ou désigne un dossier : suppression refusée.');
    if (metadata && doc.deleted_at) throw new Error('Ce fichier a été restauré dans Dropbox : actualiser sa fiche avant une nouvelle suppression.');

    const title = `Supprimer le fichier Dropbox : ${doc.filename}`;
    const taskRows = rows(await request(`/data/Tache?titre=${encodeURIComponent(title)}&limit=1000`));
    if (taskRows.length >= 1000) throw new Error('Historique de tâches trop volumineux pour une reprise sûre.');
    const previous = taskRows.filter(item => item.organisation_id === tenant && exactMention(item.description, doc.id) && item.statut !== 'terminee');
    if (previous.length > 1) throw new Error('Plusieurs tâches de suppression correspondent : traitement automatique suspendu.');
    if (doc.deleted_at && !metadata && !previous.length) {
      Object.assign(proof, { dropbox_deleted: true, index_hidden: true, verified: true, checked_at: new Date().toISOString() });
      return { success: true, action_type: 'delete_dropbox_file', result: proof, content: `Vérifié : ${doc.filename} est déjà absent de Dropbox et retiré du Cockpit. Aucune nouvelle suppression effectuée.` };
    }
    task = previous[0] || await request('/data/Tache', { method: 'POST', body: {
      titre: title, description: `Document : ${doc.id}\nDemande explicite : ${message}`, statut: 'a_faire', priorite: 'haute',
    } });
    if (!task?.id) throw new Error('La tâche de suppression n’a pas été enregistrée.');
    run = await request('/agent-runs', { method: 'POST', body: {
      task_id: task.id, agent_id: 'nova-document-delete', functional_role: 'document_deletion', provider_name: 'cockpit-server',
      status: 'running', execution_mode: 'autonomous', requested_by: user.email || user.id,
      idempotency_key: `document-delete:${doc.id}:${crypto.randomUUID()}`, input: { document_id: doc.id, dropbox_file_id: doc.dropbox_file_id, revision: metadata?.rev || null, explicit_request: message },
    } });
    if (!run?.id) throw new Error('Le journal de suppression n’a pas été enregistré.');
    proof.task_id = task.id; proof.run_id = run.id;
    await request(`/data/Tache/${task.id}`, { method: 'PATCH', body: { statut: 'en_cours', notes: `${task.notes || ''}\nSuppression unitaire en cours; run_id=${run.id}.` } });
    if (metadata) {
      // Dropbox parent_rev rejects folders and concurrent file revisions.
      const deleted = await deps.dropbox('delete_v2', { path: metadata.id, parent_rev: metadata.rev });
      if (deleted.metadata?.id !== metadata.id || deleted.metadata?.['.tag'] !== 'file') throw new Error('Réponse de suppression non vérifiable.');
    }
    try {
      await deps.dropbox('get_metadata', { path: doc.dropbox_file_id });
      throw new Error('Le fichier est encore présent dans Dropbox.');
    } catch (error) { if (!notFound(error)) throw error; }
    proof.dropbox_deleted = true;
    const stamp = new Date().toISOString();
    await request(`/data/DocumentIndex/${doc.id}`, { method: 'PATCH', body: { deleted_at: stamp, updated_at: stamp } });
    const checked = await request(`/data/DocumentIndex/${doc.id}`);
    if (checked.id !== doc.id || checked.dropbox_file_id !== doc.dropbox_file_id || !checked.deleted_at) throw new Error('Retrait de l’index non vérifié.');
    proof.index_hidden = true;
    proof.verified = true;
    proof.checked_at = stamp;
    const audit = await request('/data/LogAction', { method: 'POST', body: { action: 'dropbox_file_deleted_verified', module: 'agents', statut: 'succes', effectue_par: user.email || user.id, entite: 'DocumentIndex', entite_id: doc.id, details: proof } });
    if (!audit.id) throw new Error('Preuve finale non enregistrée dans le journal.');
    proof.audit_id = audit.id;
    const closedRun = await request(`/agent-runs/${run.id}`, { method: 'PATCH', body: { status: 'completed', result: proof, completed_at: stamp } });
    if (closedRun.id !== run.id || closedRun.status !== 'completed') throw new Error('Clôture de l’exécution non vérifiée.');
    const closedTask = await request(`/data/Tache/${task.id}`, { method: 'PATCH', body: { statut: 'terminee', notes: `${task.notes || ''}\nSuppression vérifiée dans Dropbox et dans l’index; run_id=${run.id}; audit_id=${audit.id}.` } });
    if (closedTask.id !== task.id || closedTask.statut !== 'terminee') throw new Error('Clôture de la tâche non vérifiée.');
    return { success: true, action_type: 'delete_dropbox_file', result: proof, content: `Fichier supprimé et vérifié : ${doc.filename}\n${doc.dropbox_path}\nFiche retirée du Cockpit. Tâche : ${task.id}. Exécution : ${run.id}. Journal : ${audit.id}.\nAucun autre fichier ni dossier supprimé. Récupération possible dans les Fichiers supprimés de Dropbox : https://help.dropbox.com/delete-restore/recover-deleted-files-folders` };
  } catch (error) {
    const reason = String(error.message || error).slice(0, 500);
    if (run?.id) await request(`/agent-runs/${run.id}`, { method: 'PATCH', body: { status: 'failed', result: proof, error: reason, completed_at: new Date().toISOString() } }).catch(() => null);
    if (task?.id) await request(`/data/Tache/${task.id}`, { method: 'PATCH', body: { statut: 'bloquee', notes: `${task.notes || ''}\nSuppression non finalisée : ${reason}; run_id=${run?.id || 'absent'}.` } }).catch(() => null);
    return { success: false, action_type: 'delete_dropbox_file', result: proof, content: `Suppression non finalisée : ${reason}${proof.dropbox_deleted ? '\nLe fichier est déjà absent de Dropbox ; la synchronisation ou la clôture du journal reste à terminer.' : '\nAucune réussite de suppression attestée.'}` };
  } finally {
    if (doc && proof.document_id) locks.delete(`${tenant}:${doc.dropbox_file_id}`);
  }
}

const router = express.Router();
router.post('/chat', async (req, res, next) => {
  const message = String(req.body?.message || '');
  if (!deletionMention(message)) return next();
  const outcome = await deleteFromMessage({ message, user: req.user });
  return res.json({ ...outcome, message: outcome.content, confirmation: null });
});

module.exports = { router, deletionMention, explicitDeletion, resolveDocument, deleteFromMessage };
