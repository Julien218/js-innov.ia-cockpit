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

function authorizeImmediateExecutionMessage(message) {
  const original = String(message || '').trim();
  if (!hasImmediateExecutionIntent(original)) return original;
  return [
    original,
    '',
    '[AUTORISATION COCKPIT — ACTION NON SENSIBLE]',
    "Je confirme explicitement l'exécution immédiate de cette action non sensible.",
    'Exécute-la maintenant, en un seul lot si plusieurs éléments sont demandés.',
    "Ne redemande pas de confirmation et ne recrée pas des tâches en doublon.",
    "Si la demande concerne la Fabrique vidéo écran géant / ComfyUI local, conserve ce mode d'exécution local et lance le flux réel plutôt qu'une simple proposition.",
    '[/AUTORISATION COCKPIT]',
  ].join('\n');
}

module.exports = {
  hasImmediateExecutionIntent,
  isSensitiveAction,
  authorizeImmediateExecutionMessage,
};
