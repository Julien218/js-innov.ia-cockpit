export const AVATAR_FACTORY_STAGES = [
  { key: 'reference_qa', label: 'Vérification des 4 vues', percent: 20 },
  { key: 'shape_3d', label: 'Génération du volume 3D', percent: 40 },
  { key: 'blender_finalize', label: 'Nettoyage, rig et animation', percent: 60 },
  { key: 'runtime_qa', label: 'Contrôle qualité technique', percent: 80 },
  { key: 'human_approval', label: 'Validation humaine', percent: 95 },
];

const TERMINAL_FAILURES = new Set(['failed', 'rejected']);

export function formatAvatarStage(stage) {
  return AVATAR_FACTORY_STAGES.find(item => item.key === stage)?.label || stage || 'Préparation';
}

export function formatAvatarFactoryError(error) {
  const raw = String(error || '').trim();
  if (!raw) return '';

  if (raw.includes('mesh_fragmented_too_many_components') || raw.includes('mesh_fragmented_no_dominant_component')) {
    return 'Le moteur a créé un candidat 3D, mais le contrôle qualité l’a refusé car le maillage est trop fragmenté. La production n’est pas terminée.';
  }
  if (raw.includes('reference')) {
    return 'Une ou plusieurs vues de référence n’ont pas pu être validées. Vérifie les quatre images puis relance la production.';
  }
  return raw;
}

export function getAvatarProductionProgress(job = {}) {
  const status = job.status || 'queued';
  const stageIndex = AVATAR_FACTORY_STAGES.findIndex(item => item.key === job.current_stage);
  const stage = stageIndex >= 0 ? AVATAR_FACTORY_STAGES[stageIndex] : null;

  if (status === 'completed') {
    return { percent: 100, tone: 'success', title: 'Production terminée', label: 'Avatar prêt', step: '5/5' };
  }
  if (status === 'awaiting_approval') {
    return { percent: 95, tone: 'approval', title: 'Validation requise', label: 'Contrôle visuel par l’administrateur', step: '5/5' };
  }
  if (status === 'queued_after_approval') {
    return { percent: 98, tone: 'active', title: 'Finalisation en cours', label: 'Validation reçue, reprise de la production', step: '5/5' };
  }
  if (TERMINAL_FAILURES.has(status)) {
    return {
      percent: stage?.percent || 10,
      tone: 'error',
      title: status === 'rejected' ? 'Candidat refusé' : 'Contrôle qualité en échec',
      label: formatAvatarStage(job.current_stage),
      step: stageIndex >= 0 ? `${stageIndex + 1}/5` : '—',
    };
  }
  if (status === 'running') {
    return {
      percent: stage?.percent || 10,
      tone: 'active',
      title: 'Production en cours',
      label: formatAvatarStage(job.current_stage),
      step: stageIndex >= 0 ? `${stageIndex + 1}/5` : '—',
    };
  }
  return { percent: 5, tone: 'queued', title: 'En file d’attente', label: 'Préparation de la production', step: '0/5' };
}
