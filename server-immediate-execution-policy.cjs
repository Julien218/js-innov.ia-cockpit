function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function stripInjectedContext(value) {
  return String(value || '')
    .replace(/\n?\[(?:DIAGNOSTIC LOCAL LECTURE SEULE|AUTORISATION COCKPIT|VERROU PREUVE VID[ÉE]O)[^\]]*\][\s\S]*?\[\/(?:DIAGNOSTIC LOCAL LECTURE SEULE|AUTORISATION COCKPIT|VERROU PREUVE VID[ÉE]O)\]/gi, '')
    .trim();
}

function isSensitiveAction(message) {
  const text = normalize(stripInjectedContext(message));
  return /\b(?:supprime|supprimer|efface|effacer|delete|drop|truncate|dns|nameserver|cname|mx|txt|secret|token|cle api|api key|publie en production|publication production|deploy production|deploie en production|envoie email|envoyer email|paiement|virement)\b/.test(text);
}

function hasImmediateExecutionIntent(message) {
  const text = normalize(stripInjectedContext(message));
  if (!text || isSensitiveAction(text)) return false;
  const actionVerb = /\b(?:cree|creer|genere|generer|produis|produire|realise|realiser|lance|lancer|execute|executer|effectue|effectuer|fais|faire|corrige|corriger|modifie|modifier)\b/;
  const supportedTarget = /\b(?:video|videos|image|images|visuel|visuels|page|site|seo|application|app|mobile|workflow|comfyui|ecran geant|tache|taches|action|actions|code|landing|frontend|backend)\b/;
  const immediate = /\b(?:immediatement|de suite|tout de suite|sans redemander|pas besoin de confirmer|pas besoins de confirmer)\b/;
  return (actionVerb.test(text) && supportedTarget.test(text)) || (immediate.test(text) && supportedTarget.test(text));
}

function isVideoExecutionRequest(message) {
  const text = normalize(stripInjectedContext(message));
  return /\b(?:video|videos|grok|imagine|nova-video-production|fabrique video|comfyui)\b/.test(text)
    && /\b(?:cree|creer|genere|generer|produis|produire|lance|lancer|execute|executer|effectue|effectuer|rendu|render)\b/.test(text);
}

function authorizeImmediateExecutionMessage(message) {
  const original = String(message || '').trim();
  if (!hasImmediateExecutionIntent(original)) return original;
  const videoRules = isVideoExecutionRequest(original) ? [
    '',
    '[VERROU PREUVE VIDÉO — OBLIGATOIRE]',
    'Une production vidéo n’est jamais simulée.',
    'N’invente jamais de video_job_id, provider_job_id, statut, chemin de fichier, hash, coût, archivage ou preuve.',
    'Pour une demande vidéo explicitement autorisée, utilise l’action Cockpit create_video_generation / la Fabrique vidéo réelle si elle est exposée dans les capacités de la session.',
    'Si le moteur réel ne peut pas être appelé, retourne uniquement la cause technique vérifiable du blocage et ne déclare jamais le job lancé.',
    'Les mots lancé, en cours, finalisé, terminé ou archivé sont interdits sans identifiant de job retourné par le serveur.',
    'Un rendu terminé exige finalized=true, verified=true, chemin MP4, chemin JSON sidecar et SHA-256 provenant du finaliseur Cockpit.',
    '[/VERROU PREUVE VIDÉO]',
  ] : [];
  return [
    original,
    '',
    '[AUTORISATION COCKPIT — ACTION NON SENSIBLE]',
    "Je confirme explicitement l'exécution immédiate de cette action non sensible.",
    'Exécute-la maintenant, en un seul lot si plusieurs éléments sont demandés.',
    'Ne redemande pas de confirmation et ne recrée pas des tâches en doublon.',
    "Si la demande concerne la Fabrique vidéo écran géant / ComfyUI local, conserve ce mode d'exécution local et lance le flux réel plutôt qu'une simple proposition.",
    '[/AUTORISATION COCKPIT]',
    ...videoRules,
  ].join('\n');
}

module.exports = {
  stripInjectedContext,
  hasImmediateExecutionIntent,
  isSensitiveAction,
  isVideoExecutionRequest,
  authorizeImmediateExecutionMessage,
};
