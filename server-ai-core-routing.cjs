// AI Core hybrid routing policy for NOVA.
// Read-only / analytical requests may use the OpenAI Agents SDK path.
// Requests that can create, modify, publish, send, deploy, delete or confirm an
// action stay on the historical /chat path so existing Cockpit guardrails and
// confirmation flows remain authoritative.

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const ACTION_INTENT = /\b(?:cree|creer|ajoute|ajouter|modifie|modifier|change|changer|corrige|corriger|mets? a jour|mettre a jour|supprime|supprimer|efface|effacer|envoie|envoyer|publie|publier|deploie|deployer|lance|lancer|execute|executer|genere|generer|active|activer|desactive|desactiver|assigne|assigner|rattache|rattacher|planifie|planifier|programme|programmer|importe|importer|telecharge|telecharger|finalise|finaliser|valide|valider|confirme|confirmer|paie|payer)\b/;
const CONTINUATION_ACTION = /^\s*(?:oui|ok|oki|go|continue|vas-y|fait|fais-le|fais la|confirme|valid[eé])\b/;
const WRITE_TARGET = /\b(?:tache|client|projet|devis|facture|email|mail|dns|domaine|cname|txt|mx|video|portfolio|publication|paiement|stripe|utilisateur|permission|role|acces|workflow|automatisation|configuration|variable|secret|cle api|api key|production|deploy|deploiement)\b/;
const READ_ONLY_HINT = /\b(?:analyse|analyser|resume|resumer|explique|expliquer|compare|comparer|liste|lister|montre|montrer|cherche|chercher|recherche|rechercher|verifie|verifier|audit|diagnostic|combien|quel|quelle|quels|quelles|etat|statut|cout|coût|usage|consommation|facturation|historique|information|infos?)\b/;

function isHybridEnabled(env = process.env) {
  return String(env.NOVA_AI_CORE_HYBRID_ENABLED || '').toLowerCase() === 'true';
}

function decideAICoreRoute({ message = '', audienceMode = 'client', recentMedia = null, routingDecision = {}, env = process.env } = {}) {
  if (!isHybridEnabled(env)) return { useAICore: false, reason: 'hybrid_disabled' };

  const raw = String(message || '').trim();
  const text = normalize(raw);
  if (!text) return { useAICore: false, reason: 'empty_message' };

  // A short continuation can refer to a pending write proposal from the previous
  // turn. Keep it on the historical path so confirmation state is preserved.
  if (CONTINUATION_ACTION.test(raw)) return { useAICore: false, reason: 'continuation_or_confirmation' };

  // Media creation/publication and any live-operator mission remain on the
  // historical path until Agents SDK write orchestration is explicitly enabled.
  if (recentMedia && /\b(?:video|image|visuel|publie|publication|genere|generation)\b/.test(text)) {
    return { useAICore: false, reason: 'active_media_workflow' };
  }
  if (routingDecision?.requires_live_operator) return { useAICore: false, reason: 'live_operator_required' };

  // Explicit action verbs are conservative by design. Even if the target is not
  // obvious, the legacy path knows how to propose an action and ask for the
  // Cockpit confirmation when needed.
  if (ACTION_INTENT.test(text)) return { useAICore: false, reason: 'write_or_execution_intent' };

  // Imperative nouns without an action verb are still treated as potentially
  // mutating when they are not clearly phrased as a read-only question.
  if (WRITE_TARGET.test(text) && !READ_ONLY_HINT.test(text)) {
    return { useAICore: false, reason: 'potential_write_target' };
  }

  // Client traffic is allowed only for read-only requests; tenant enforcement is
  // repeated by jsinnovia-agent itself. Owner/staff follow the same conservative
  // write policy during this migration phase.
  return {
    useAICore: true,
    reason: READ_ONLY_HINT.test(text) ? 'read_only_or_analysis' : 'safe_conversation',
    mode: audienceMode,
  };
}

module.exports = {
  ACTION_INTENT,
  CONTINUATION_ACTION,
  READ_ONLY_HINT,
  WRITE_TARGET,
  decideAICoreRoute,
  isHybridEnabled,
};
