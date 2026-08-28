function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isSensitiveAction(message) {
  const text = normalize(message);
  return /\b(?:supprime|supprimer|efface|effacer|delete|drop|truncate|dns|nameserver|cname|mx|txt|secret|token|cle api|api key|publie en production|publication production|deploy production|deploie en production|envoie email|envoyer email|paiement|virement)\b/.test(text);
}

function hasImmediateExecutionIntent(message) {
  const text = normalize(message);
  if (!text || isSensitiveAction(text)) return false;
  const actionVerb = /\b(?:cree|creer|genere|generer|produis|produire|realise|realiser|lance|lancer|execute|executer|effectue|effectuer|fais|faire|corrige|corriger|modifie|modifier)\b/;
  const supportedTarget = /\b(?:video|videos|image|images|visuel|visuels|page|site|seo|application|app|mobile|workflow|comfyui|ecran geant|tache|taches|action|actions|code|landing|frontend|backend)\b/;
  const immediate = /\b(?:immediatement|de suite|tout de suite|sans redemander|pas besoin de confirmer|pas besoins de confirmer)\b/;
  return (actionVerb.test(text) && supportedTarget.test(text)) || (immediate.test(text) && supportedTarget.test(text));
}

function isVideoExecutionRequest(message) {
  const text = normalize(message);
  return /\b(?:video|videos|grok|imagine|nova-video-production|fabrique video|comfyui)\b/.test(text)
    && /\b(?:cree|creer|genere|generer|produis|produire|lance|lancer|execute|executer|effectue|effectuer|rendu|render)\b/.test(text);
}

function authorizeImmediateExecutionMessage(message) {
  const original = String(message || '').trim();
  if (!hasImmediateExecutionIntent(original)) return original;
  const videoRules = isVideoExecutionRequest(original) ? [
    '',
    '[VERROU PREUVE VIDEO — OBLIGATOIRE]',
    'Une production video n est jamais simulee.',
    'N invente jamais de video_job_id, provider_job_id, statut, chemin de fichier, hash, cout, archivage ou preuve.',
    'Pour une demande video explicitement autorisee, utilise l action Cockpit create_video_generation / la Fabrique video reelle si elle est exposee dans les capacites de la session.',
    'Si le moteur reel ne peut pas etre appele, retourne uniquement la cause technique verifiable du blocage et ne declare jamais le job lance.',
    'Les mots lance, en cours, finalise, termine ou archive sont interdits sans identifiant de job retourne par le serveur.',
    'Un rendu termine exige finalized=true, verified=true, chemin MP4, chemin JSON sidecar et SHA-256 provenant du finaliseur Cockpit.',
    '[/VERROU PREUVE VIDEO]',
  ] : [];
  return [
    original,
    '',
    '[AUTORISATION COCKPIT — ACTION NON SENSIBLE]',
    "Je confirme explicitement l'execution immediate de cette action non sensible.",
    'Execute-la maintenant, en un seul lot si plusieurs elements sont demandes.',
    "Ne redemande pas de confirmation et ne recree pas des taches en doublon.",
    "Si la demande concerne la Fabrique video ecran geant / ComfyUI local, conserve ce mode d'execution local et lance le flux reel plutot qu'une simple proposition.",
    '[/AUTORISATION COCKPIT]',
    ...videoRules,
  ].join('\n');
}

module.exports = {
  hasImmediateExecutionIntent,
  isSensitiveAction,
  isVideoExecutionRequest,
  authorizeImmediateExecutionMessage,
};