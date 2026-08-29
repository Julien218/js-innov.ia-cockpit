const express = require('express');
const { createVideoGenerationJob } = require('./server-video-generation.cjs');

function normalizeIntent(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

let hasImmediateExecutionIntent;
let isVideoExecutionRequest;
try {
  ({ hasImmediateExecutionIntent, isVideoExecutionRequest } = require('./server-immediate-execution-policy.cjs'));
} catch (error) {
  console.warn('[nova-video-direct] politique externe absente, fallback interne activé');
  hasImmediateExecutionIntent = (message) => {
    const text = normalizeIntent(message);
    if (/\b(?:supprime|efface|delete|drop|truncate|dns|secret|token|cle api|api key|paiement|virement)\b/.test(text)) return false;
    return /\b(?:cree|creer|genere|generer|produis|produire|lance|lancer|execute|executer|effectue|effectuer|immediatement|maintenant|tout de suite|sans confirmation|sans redemander)\b/.test(text);
  };
  isVideoExecutionRequest = (message) => {
    const text = normalizeIntent(message);
    return /\b(?:video|videos|grok|imagine|xai|sora|nova-video-production|fabrique video|comfyui)\b/.test(text)
      && /\b(?:cree|creer|genere|generer|produis|produire|lance|lancer|execute|executer|effectue|effectuer|rendu|render|production)\b/.test(text);
  };
}

const router = express.Router();
const ADMIN_ROLES = new Set(['admin', 'superadmin']);
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function providerFromMessage(message) {
  const text = String(message || '').toLowerCase();
  if (/\b(?:grok|xai|imagine\s*1\.5)\b/.test(text)) return 'xai';
  if (/\b(?:sora|openai)\b/.test(text)) return 'openai';
  return 'auto';
}

function recentMediaRequested(message) {
  const text = normalizeIntent(message);
  return /\b(?:image|images|photo|photos|visuel|visuels|media|medias|fichier|fichiers|piece jointe|pieces jointes|reference visuelle|references visuelles)\b/.test(text)
    || /\b(?:cette|cet|ces|le|la|les)\s+(?:image|images|photo|photos|visuel|visuels|media|medias|fichier|fichiers)\b/.test(text)
    || /\bci[- ]dessus\b/.test(text);
}

function extractReferenceIds(message, recentMedia) {
  const fromMessage = String(message || '').match(UUID_RE) || [];
  const fromBody = recentMediaRequested(message)
    ? (Array.isArray(recentMedia)
      ? recentMedia.map((item) => item?.documentId || item?.document_id)
      : [recentMedia?.documentId || recentMedia?.document_id])
    : [];
  return unique([...fromMessage, ...fromBody]).slice(0, 7);
}

function cleanPrompt(message, referenceIds) {
  const withoutPolicy = String(message || '').split(/\n\[(?:AUTORISATION COCKPIT|VERROU PREUVE VIDEO)/i)[0].trim();
  const refs = referenceIds.length > 1
    ? `\n\nRéférences ordonnées: image de départ ${referenceIds[0]}, image cible ${referenceIds[1]}. Commencer visuellement avec la première et converger naturellement vers la seconde en conservant au maximum identité, proportions, personnages, couleurs et composition.`
    : referenceIds.length === 1
      ? `\n\nUtiliser le média Cockpit ${referenceIds[0]} comme référence visuelle de départ.`
      : '';
  const prompt = `${withoutPolicy}${refs}`.trim();
  return prompt.length >= 20 ? prompt.slice(0, 20_000) : `Créer une vidéo fidèle à la demande utilisateur et aux références visuelles fournies.${refs}`;
}

function directVideoIntent(req) {
  if (req.method !== 'POST' || req.path !== '/chat') return false;
  if (!ADMIN_ROLES.has(req.user?.role)) return false;
  const message = String(req.body?.message || '');
  return isVideoExecutionRequest(message) && hasImmediateExecutionIntent(message);
}

router.post('/chat', async (req, res, next) => {
  if (!directVideoIntent(req)) return next();

  const message = String(req.body?.message || '').trim();
  const referenceIds = extractReferenceIds(message, req.body?.recent_media);

  const payload = {
    provider: providerFromMessage(message),
    client_id: String(req.body?.client_id || '').trim() || undefined,
    client_name: String(req.body?.client_name || '').trim() || 'JS-Innov.IA',
    project_id: String(req.body?.project_id || '').trim() || undefined,
    cost_center_id: String(req.body?.cost_center_id || '').trim() || undefined,
    campaign_name: String(req.body?.campaign_name || '').trim() || `NOVA — production directe ${new Date().toISOString().slice(0, 10)}`,
    prompt: cleanPrompt(message, referenceIds),
    sector: String(req.body?.sector || '').trim() || 'production audiovisuelle IA',
    rights_confirmed: req.body?.rights_confirmed === true,
    usage_rights: String(req.body?.usage_rights || '').trim() || 'Production interne JS-Innov.IA ou usage limité au projet validé.',
    version: String(req.body?.version || '').trim() || 'v01',
    source_document_id: referenceIds[0] || undefined,
    end_source_document_id: referenceIds[1] || undefined,
    reference_document_ids: referenceIds,
  };

  try {
    const result = await createVideoGenerationJob(payload, req.user);
    const job = result?.job;
    if (!job?.id) throw new Error('La Fabrique vidéo n’a retourné aucun video_job_id réel.');

    return res.status(202).json({
      message: `Production vidéo réellement créée dans la Fabrique vidéo. video_job_id: ${job.id}. Statut serveur: ${job.status || 'queued'}.`,
      confirmation: null,
      direct_execution: true,
      simulated: false,
      video_job_id: job.id,
      provider: job.provider,
      status: job.status,
      journal_id: result.journal_id,
      reference_document_ids: referenceIds,
      execution: {
        engine: 'nova-video-production',
        route: '/api/video-generation/jobs',
        job,
      },
    });
  } catch (error) {
    const reason = String(error?.message || error || 'Erreur inconnue').replace(/[\r\n<>]/g, ' ').slice(0, 600);
    console.error('[nova-video-direct] lancement refusé:', reason);
    return res.status(422).json({
      error: `Production vidéo non lancée : ${reason}`,
      cause: 'video_generation_failed',
      direct_execution: true,
      simulated: false,
    });
  }
});

module.exports = router;
module.exports.directVideoIntent = directVideoIntent;
module.exports.extractReferenceIds = extractReferenceIds;
module.exports.providerFromMessage = providerFromMessage;
module.exports.cleanPrompt = cleanPrompt;
module.exports.recentMediaRequested = recentMediaRequested;