const crypto = require('node:crypto');
const { sanitizeTaskBatchPayload, executeTaskBatch } = require('./server-task-batch.cjs');
const { explicitExecutionAuthorization, executionProhibited } = require('./server-assistant-batch.cjs');
const { isSensitiveAction } = require('./server-immediate-execution-policy.cjs');
const { hasPermission } = require('./server-permission-policy.cjs');
const { siteExecutorForTask, resolveNovaExecutor } = require('./server-nova-executors.cjs');

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function taskIntent(message) {
  const text = normalize(message);
  if (executionProhibited(message) || /\bne\s+(?:rien|pas)\b|\b(?:ne|n')\s*(?:cree|creer|ajoute|planifie)|\bsans\s+(?:creer|creation|ajouter)|\b(?:explique|comment|pourquoi|est-ce|verifie si)\b/.test(text)) return false;
  return /\b(?:cree|creer|ajoute|ajouter|developpe|developper|implemente|integre|automatise|planifie|assigne|delegue|corrige|execute|effectue)\b/.test(text)
    || /\b(?:nous devons|je veux|je souhaite|nous souhaitons)\b/.test(text);
}

function galleryFallback(agent, message) {
  const text = normalize(message);
  if (agent.key !== 'fashionistart' || !/galeri[es]/.test(text) || !/vente/.test(text) || !/paiement/.test(text) || !/facebook|instagram|reseaux/.test(text) || !taskIntent(message)) return null;
  return { tasks: [
    { titre: 'Développer la galerie connectée', description: 'Dépôt gratuit des œuvres par les artistes, catalogue et mise en vente ; rattachement au Cockpit et aux espaces clients/artistes.' },
    { titre: 'Intégrer les paiements et répartitions membres/non-membres', description: 'Implémenter et tester séparément les deux répartitions de la demande, avec les trois bénéficiaires. Aucun encaissement ni virement réel autorisé par la création de cette tâche.' },
    { titre: 'Automatiser les processus de vente', description: 'Automatiser le suivi des œuvres, commandes, paiements et notifications, avec journalisation des erreurs et prévention des doublons.' },
    { titre: 'Élaborer le plan de contenu réseaux sociaux', description: 'Préparer le calendrier et les contenus Facebook, Instagram, TikTok et LinkedIn. La création de cette tâche ne publie aucun contenu.' },
  ] };
}

function scopedPayload(raw, agent, message) {
  if (!Array.isArray(raw?.tasks) || !raw.tasks.length || raw.tasks.length > 20) return null;
  if (raw.tasks.some(task => !String(task?.titre || '').trim())) return null;
  // No model-generated entity IDs, executor choice or old task IDs are trusted.
  return sanitizeTaskBatchPayload({ tasks: raw.tasks.map(task => ({
    titre: `${agent.name} — ${String(task.titre).slice(0, 170)}`,
    description: `${String(task.description || '').slice(0, 650)}\n\nDemande originale (contraintes à conserver intégralement):\n${message}`,
    priorite: task.priorite || 'haute',
    notes: `Spécialiste responsable: ${agent.name}\nDomaine: ${agent.domains[0] || ''}\nCréation du dossier de travail; aucune livraison attestée.`,
    agent_name: agent.name,
    agent_role: agent.role,
    read_only: false,
  })) });
}

function proofMessage(result, payload) {
  const labels = { existing: 'tâche existante conservée, sans nouvelle exécution', planned: 'créée/assignée, à faire — exécution non lancée', already_running: 'déjà en suivi', queued_local: 'en file Windows', completed: 'terminée et vérifiée', awaiting_review: 'résultat à vérifier', blocked: 'bloquée', failed: 'échec' };
  return ['Résultat enregistré dans le Cockpit :', ...result.results.map(item =>
    `• ${payload.tasks[item.index].record.titre}\n  ${labels[item.status] || item.status}; tâche: ${item.task_id || 'non créée'}; exécution: ${item.run_id || 'non créée'}; responsable: ${item.executor || 'non assigné'}${item.error || item.reason ? `; motif: ${item.error || item.reason}` : ''}`
  ), 'La création/assignation ne signifie pas que la fonctionnalité est livrée.'].join('\n\n');
}

async function processSpecialistMessage({ agent, message, user, tenant, conversationId, requestId, chat, agentFetch, execute = executeTaskBatch }) {
  const requested = taskIntent(message);
  const allowed = ['collaborateur', 'admin', 'superadmin'].includes(user?.role) && hasPermission(user, 'tasks');
  if (requested && !allowed) return { content: 'Création refusée : votre compte ne dispose pas de la permission Tâches.', execution_result: null };
  const data = await chat(requested ? ['create_task_batch'] : []);
  if (!requested) {
    const reply = String(data.response || data.message || '');
    const promise = /(?:je vais|je procede|je procède|je vous tiens|veuillez patienter|t[aâ]ches?.*(?:cr[eé][eé]|assign[eé]|lanc[eé]))/i.test(reply);
    return { content: `${promise ? 'Aucune nouvelle action demandée. Consultez les identifiants et statuts du dernier résultat enregistré.' : reply}\n\nAucune tâche créée ni exécution lancée dans cet échange.`, execution_result: null };
  }
  const action = data.proposed_action || data.action;
  // This complete fallback also covers a textual promise with no tool call.
  const raw = galleryFallback(agent, message) || (action?.type === 'create_task_batch' ? action.payload : null);
  const payload = scopedPayload(raw, agent, message);
  if (!payload) return { content: 'Aucune tâche créée : le spécialiste n’a pas fourni de lot de tâches exploitable. Aucune exécution ne se poursuit en arrière-plan.', execution_result: null };
  const prepareOnly = !explicitExecutionAuthorization(message) || isSensitiveAction(message);
  const token = crypto.createHash('sha256').update(`${tenant}:${user.id}:${conversationId}:${requestId}`).digest('hex');
  const scopedExecutor = siteExecutorForTask({ titre: agent.domains[0] });
  const result = await execute({ payload, token, user, tenant, agentFetch, prepareOnly,
    resolveExecutor: record => scopedExecutor || resolveNovaExecutor(record) });
  let auditWarning = '';
  try {
    const audit = await agentFetch('/data/LogAction', { method: 'POST', body: JSON.stringify({
      action: 'specialist_task_batch', module: 'agents', statut: result.success ? 'succes' : 'erreur', effectue_par: user.email || user.id,
      details: JSON.stringify({ conversation_id: conversationId, request_id: requestId, specialist: agent.key, prepare_only: prepareOnly, results: result.results.map(({ task_id, run_id, status, executor }) => ({ task_id, run_id, status, executor })) }),
    }) });
    if (!audit.ok) throw new Error('audit');
  } catch {
    auditWarning = '\n\nAttention : journal d’actions indisponible ; vérifier les tâches et exécutions avec les identifiants ci-dessus.';
  }
  return { content: proofMessage(result, payload) + auditWarning, execution_result: result };
}

module.exports = { taskIntent, galleryFallback, scopedPayload, processSpecialistMessage };
