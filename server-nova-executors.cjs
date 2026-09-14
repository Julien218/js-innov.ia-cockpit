const crypto = require('node:crypto');

const { SKILL_REGISTRY } = require('./server-agent-registry.cjs');
const { findCanonicalClient, isInternalClientRecord } = require('./server-video-generation-core.cjs');
const { lookupBce } = require('./server-bce.cjs');
const {
  analyzeDomain,
  MANAGED_DOMAINS,
  verifiedImprovement,
} = require('./server-domain-ops.cjs');
// Les spécialistes de domaine sont désormais des profils internes NOVA.
const SITE_AGENT_KEYS = new Set([
  'jsinnov-agent',
  'assurances-dour',
  'synergie-dour',
  'site-olivier',
  'dourconnect',
  'villeconnect',
  'fashionistart',
  'miss-mister-dour',
  'generatvideopro',
]);

const INTERNAL_EXECUTORS = Object.freeze({
  local_windows: {
    id: 'nova-windows-local',
    name: 'NOVA Windows Local',
    provider: 'local-agent',
    role: 'windows_local_execution',
    execution_mode: 'autonomous',
  },
  business_data: {
    id: 'nova-business-data',
    name: 'NOVA Données Métier',
    provider: 'cockpit-server',
    role: 'business_data_execution',
    execution_mode: 'autonomous',
  },
  project_data: {
    id: 'nova-project-data',
    name: 'NOVA Projets',
    provider: 'cockpit-server',
    role: 'project_data_execution',
    execution_mode: 'autonomous',
  },
  video_production: {
    id: 'nova-video-production',
    name: 'NOVA Production Vidéo',
    provider: 'cockpit-server',
    role: 'video_generation_execution',
    execution_mode: 'autonomous',
  },
  site_ops: {
    id: 'nova-site-ops',
    name: 'NOVA Sites · GitHub + Railway',
    provider: 'cockpit-server',
    role: 'site_repository_operations',
    execution_mode: 'autonomous',
  },
});

function clean(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function normalized(value) {
  return clean(value, 8000).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function taskText(task = {}) {
  return `${task.titre || task.title || ''}\n${task.description || ''}`;
}

function isReadOnlySiteTask(task = {}, declaredReadOnly = false) {
  if (declaredReadOnly) return true;
  const text = normalized(taskText(task));
  const diagnostic = /(diagnost|analys|audit|control|verifi|mesur|etat)/.test(text);
  const mutation = /(reparation|corrig|modifi|appliqu|deploi|publi|mise a jour|mettre a jour)/.test(text);
  return diagnostic && !mutation;
}

function siteAgents() {
  return SKILL_REGISTRY.filter((skill) => skill.status === 'active' && SITE_AGENT_KEYS.has(skill.key));
}

function siteExecutorForTask(task = {}) {
  const text = normalized(taskText(task));
  const candidates = siteAgents()
    .flatMap((agent) => (agent.domains || []).map((domain) => ({ agent, domain })))
    .sort((a, b) => b.domain.length - a.domain.length);
  const found = candidates.find(({ domain }) => text.includes(String(domain).toLowerCase()));
  if (!found) return null;
  return {
    kind: 'site',
    id: `${INTERNAL_EXECUTORS.site_ops.id}:${found.agent.key}`,
    name: INTERNAL_EXECUTORS.site_ops.name,
    provider: INTERNAL_EXECUTORS.site_ops.provider,
    provider_agent_id: INTERNAL_EXECUTORS.site_ops.id,
    role: found.agent.role,
    execution_mode: 'autonomous',
    domain: found.domain,
    repository: MANAGED_DOMAINS[found.domain]?.repository || null,
    hosting: MANAGED_DOMAINS[found.domain]?.hosting || null,
  };
}

function resolveNovaExecutor(task = {}) {
  const text = normalized(taskText(task));
  const explicitVideo = /(creer|creation|generer|generation|produire|production).*(video|ecran geant)/.test(text);
  const imageTransition = /(image|media).*(vers|jusqu|finir|transition|morph).*(image|media)|(?:transition|morph).*(image|media)|start.?image|end.?image/.test(text);
  const hasVideoMediaContract = sourceDocumentIdsFromTask(task).length >= 2 && /(video|transition|animation|morph|grok|imagine)/.test(text);
  if (explicitVideo || imageTransition || hasVideoMediaContract) {
    return { kind: 'video', ...INTERNAL_EXECUTORS.video_production };
  }
  const site = siteExecutorForTask(task);
  if (site) return site;

  if (/(comfyui|minimax|workflow|ffmpeg|ffprobe|video ia|module video|avatar.*local|documentation.*workflow)/.test(text)) {
    return { kind: 'local', ...INTERNAL_EXECUTORS.local_windows };
  }
  if (/(client|facture|tva|societe|asbl|rattachement|bce|banque carrefour)/.test(text)) {
    return { kind: 'business', ...INTERNAL_EXECUTORS.business_data };
  }
  if (/(fiche\s+projet|projet\s+[a-z0-9]|villeconnect\s*os|villeconnectos)/.test(text)) {
    return { kind: 'project', ...INTERNAL_EXECUTORS.project_data };
  }
  const missingTargetReason = /(site|page web|depot github|repository|application web)/.test(text)
    ? 'cible_site_ou_depot_absente_de_la_tache'
    : /(image|media|photo|camera)/.test(text)
      ? (sourceDocumentIdsFromTask(task).length ? 'aucun_executeur_media_enregistre' : 'media_source_absente_ou_non_exploitable')
      : 'aucun_executeur_reel_enregistre_pour_ce_type_de_tache';
  return {
    kind: 'unsupported',
    id: 'nova-architect',
    name: 'NOVA Architecte',
    provider: 'cockpit-server',
    role: 'orchestration',
    execution_mode: 'prepare_only',
    reason: missingTargetReason,
  };
}

function projectName(project = {}) {
  return clean(project.nom || project.name || project.titre || project.title, 240);
}

function explicitLine(source, labels) {
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = String(source || '').match(new RegExp(`(?:^|\\n)\\s*[-*]?\\s*(?:${labelPattern})\\s*:\\s*([^\\n]+)`, 'i'));
  return clean(match?.[1], 4000);
}

function isoDateFromExplicit(value) {
  const source = clean(value, 100).toLowerCase().replace(/^1er\b/, '1');
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return source;
  const months = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
  const normalizedDate = normalized(source);
  const match = normalizedDate.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
  if (!match || !months[match[2]]) return null;
  const day = Number(match[1]);
  const month = months[match[2]];
  if (day < 1 || day > 31) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function projectPatchFromTask(task = {}, current = {}) {
  const source = `${task.description || ''}\n${task.notes || ''}`;
  const patch = {};
  const status = explicitLine(source, ['statut']);
  const priority = explicitLine(source, ['priorité', 'priorite']);
  const startDate = isoDateFromExplicit(explicitLine(source, ['date de début', 'date de debut']));
  const targetDate = isoDateFromExplicit(explicitLine(source, ['objectif de lancement', 'date de fin prévue', 'date de fin prevue']));
  const description = explicitLine(source, ['description']);
  const notes = explicitLine(source, ['notes']);
  const creator = explicitLine(source, ['créateur/concepteur', 'createur/concepteur', 'créateur', 'createur', 'concepteur']);
  const progress = explicitLine(source, ['progression']);
  const budget = explicitLine(source, ['budget']);

  if (status) patch.statut = normalized(status).replace(/\s+/g, '_');
  if (startDate) patch.date_debut = startDate;
  if (targetDate) patch.date_fin_prevue = targetDate;
  if (description) patch.description = description;
  if (budget && Number.isFinite(Number(budget.replace(/[^0-9,.-]/g, '').replace(',', '.')))) patch.budget = Number(budget.replace(/[^0-9,.-]/g, '').replace(',', '.'));

  const progressNumber = progress && Number.isFinite(Number(progress.replace(',', '.')))
    ? Math.max(0, Math.min(100, Number(progress.replace(',', '.'))))
    : null;
  const additions = [
    notes,
    priority ? `Priorité: ${priority}` : '',
    progressNumber !== null ? `Progression: ${progressNumber} %` : '',
    creator ? `Créateur/concepteur: ${creator}` : '',
  ].filter(Boolean);
  if (additions.length) {
    const existing = clean(current.notes, 3000);
    patch.notes = [existing, ...additions.filter((item) => !existing.includes(item))].filter(Boolean).join('\n').slice(0, 4000);
  }
  return patch;
}

function projectForTask(task, projects = []) {
  if (task?.projet_id) return projects.find((project) => String(project.id) === String(task.projet_id)) || null;
  const text = normalized(taskText(task));
  const candidates = projects
    .filter((project) => normalized(projectName(project)).length >= 3)
    .filter((project) => text.includes(normalized(projectName(project))))
    .sort((a, b) => projectName(b).length - projectName(a).length);
  if (!candidates.length) return null;
  const bestName = normalized(projectName(candidates[0]));
  return candidates.filter((project) => normalized(projectName(project)) === bestName).length === 1 ? candidates[0] : null;
}

async function executeProjectTask(task, agentRequest) {
  const projects = rowsFrom(await agentRequest('/data/Projet?limit=500'));
  const project = projectForTask(task, projects);
  if (!project?.id) {
    return {
      completed: false,
      awaiting_review: true,
      provider: 'cockpit-server',
      result: { checked_at: new Date().toISOString(), candidates: projects.map((item) => ({ id: item.id, nom: projectName(item) })).slice(0, 100) },
      report: 'Projet cible absent ou ambigu; aucune modification appliquée.',
      reason: 'projet_cible_absent_ou_ambigu',
    };
  }
  const patch = projectPatchFromTask(task, project);
  if (!Object.keys(patch).length) {
    return {
      completed: false,
      awaiting_review: true,
      provider: 'cockpit-server',
      result: { checked_at: new Date().toISOString(), project_id: project.id, project_name: projectName(project), updated_fields: [] },
      report: 'La tâche ne contient aucune valeur structurée explicite à appliquer.',
      reason: 'donnees_de_mise_a_jour_projet_absentes',
    };
  }
  await agentRequest(`/data/Projet/${encodeURIComponent(project.id)}`, { method: 'PATCH', body: patch });
  const verifiedPayload = await agentRequest(`/data/Projet/${encodeURIComponent(project.id)}`);
  const verifiedProject = recordFrom(verifiedPayload);
  const mismatchedFields = Object.entries(patch)
    .filter(([field, expected]) => JSON.stringify(verifiedProject?.[field] ?? null) !== JSON.stringify(expected))
    .map(([field]) => field);
  if (mismatchedFields.length) {
    return {
      completed: false,
      awaiting_review: true,
      provider: 'cockpit-server',
      result: {
        checked_at: new Date().toISOString(),
        project_id: project.id,
        expected: patch,
        observed: verifiedProject,
        mismatched_fields: mismatchedFields,
      },
      report: `Relecture après écriture non conforme: ${mismatchedFields.join(', ')}.`,
      reason: 'verification_ecriture_projet_echouee',
    };
  }
  const result = {
    update_id: `project-${crypto.randomUUID()}`,
    updated_at: new Date().toISOString(),
    project_id: project.id,
    project_name: projectName(project),
    updated_fields: Object.keys(patch),
    verified_fields: Object.keys(patch),
    verified_project: verifiedProject,
  };
  return { completed: true, provider: 'cockpit-server', result, report: JSON.stringify(result) };
}

function sourceDocumentIdsFromTask(task = {}) {
  const direct = [
    ...(Array.isArray(task.reference_document_ids) ? task.reference_document_ids : []),
    task.source_document_id,
    task.end_source_document_id,
    task.start_source_document_id,
  ].map((value) => clean(value, 180)).filter(Boolean);
  const source = `${task.description || ''}\n${task.notes || ''}`;
  const labelled = [...source.matchAll(/(?:source_document_id|end_source_document_id|start_source_document_id|index cockpit|document source|m[eé]dia source|image\s*[12])\s*[:=]\s*([A-Za-z0-9_-]{8,180})/gi)]
    .map((match) => clean(match[1], 180))
    .filter(Boolean);
  return [...new Set([...direct, ...labelled])].slice(0, 7);
}

function sourceDocumentIdFromTask(task = {}) {
  return sourceDocumentIdsFromTask(task)[0] || null;
}

function videoClientForTask(task, clients = []) {
  const requestedId = clean(task?.client_id, 180);
  const requestedName = clean(task?.client_nom || task?.client_name, 240);
  const requestedClient = findCanonicalClient(clients, { clientId: requestedId, clientName: requestedName });
  if (requestedClient) return requestedClient;
  // A non-canonical client_id must never be ignored and replaced by an unrelated
  // name match. It is either resolved above (including legacy internal aliases)
  // or reported as a missing client by the caller.
  if (requestedId) return null;

  const text = normalized(`${taskText(task)}\\n${requestedName}`);
  const matches = clients.filter((client) => {
    const name = normalized(clientName(client));
    return name.length >= 3 && text.includes(name);
  });
  if (matches.length === 1) return matches[0];
  return clients.find((client) => isInternalClientRecord(client))
    || clients.find((client) => normalized(client.type_client) === 'interne_jsinnovia')
    || clients.find((client) => /js.?innov.?ia/.test(normalized(clientName(client))) && /interne/.test(normalized(`${client.nom || ''} ${client.notes || ''}`)))
    || null;
}

function videoPromptForTask(task = {}, sourceIds = []) {
  const base = clean(task.description, 20_000);
  if (sourceIds.length < 2) return base;
  return [
    'VIDEO GENERATION CONTRACT — ordered visual references:',
    '<IMAGE_0> is the starting visual reference. Begin the video visually as close as possible to <IMAGE_0>.',
    '<IMAGE_1> is the target/final visual reference. Build one continuous cinematic transformation and finish visually as close as possible to <IMAGE_1>.',
    'Preserve character identity, proportions, colors, logos, environment continuity and camera coherence. Do not invent unrelated scenes.',
    'The provider reference-to-video mode does not guarantee an exact last frame; maximize convergence toward <IMAGE_1> during the final seconds.',
    '',
    base,
  ].join('\n').slice(0, 20_000);
}

async function executeVideoTask(task, agentRequest, createJob = null, context = {}) {
  const clients = rowsFrom(await agentRequest('/data/Client?limit=500'));
  const client = videoClientForTask(task, clients);
  const sourceDocumentIds = sourceDocumentIdsFromTask(task);
  const prompt = videoPromptForTask(task, sourceDocumentIds);
  const sourceRequired = /(?:image|m[eé]dia|fichier|dropbox).*(?:fourni|source|joint)|(?:partir|depuis)\s+de\s+(?:l['’])?image|image\s*1.*image\s*2|finir.*image/i.test(`${task.description || ''}\n${task.notes || ''}`);
  const missingFields = [];
  if (!client?.id) missingFields.push('client_id_or_internal_jsinnovia_client');
  if (prompt.length < 20) missingFields.push('prompt');
  if (sourceRequired && !sourceDocumentIds.length) missingFields.push('source_document_id');
  if (missingFields.length) {
    return {
      completed: false,
      awaiting_review: false,
      provider: 'cockpit-server',
      result: { checked_at: new Date().toISOString(), missing_fields: missingFields, source_required: sourceRequired },
      report: `Génération non lancée: champs techniques manquants (${missingFields.join(', ')}).`,
      reason: `generation_video_incomplete:${missingFields.join(',')}`,
    };
  }
  const create = createJob || require('./server-video-generation.cjs').createVideoGenerationJob;
  const response = await create({
    provider: sourceDocumentIds.length > 1 ? 'xai' : 'auto',
    client_id: client.id,
    client_name: clientName(client),
    project_id: task.projet_id || null,
    cost_center_id: task.cost_center_id || null,
    campaign_name: clean(task.titre || task.title, 180) || 'Production vidéo NOVA',
    prompt,
    source_document_id: sourceDocumentIds[0] || null,
    end_source_document_id: sourceDocumentIds[1] || null,
    reference_document_ids: sourceDocumentIds,
    task_id: context.taskId || task.id || null,
    agent_run_id: context.runId || null,
    rights_confirmed: false,
    usage_rights: 'À valider contractuellement avant diffusion finale.',
    version: 'v01',
  }, context.user || { id: 'nova-video-production', role: 'admin', organisation: context.organisation || 'jsinnovia' });
  return {
    completed: false,
    awaiting_review: false,
    in_progress: true,
    provider: 'cockpit-server',
    result: {
      video_job_id: response.job?.id || null,
      journal_id: response.journal_id,
      status: response.job?.status || 'queued',
      client_id: client.id,
      internal_client_fallback: isInternalClientRecord(client),
      source_document_ids: sourceDocumentIds,
      reference_mode: sourceDocumentIds.length > 1,
    },
    report: `Génération vidéo réellement lancée et suivie: ${response.journal_id}. Aucune confirmation supplémentaire n’est requise.`,
    reason: 'generation_video_en_cours',
  };
}

async function executeSiteTask(executor, task, { readOnly = false, dispatch = null, analyze = analyzeDomain } = {}) {
  const text = normalized(taskText(task));
  const effectiveReadOnly = isReadOnlySiteTask(task, readOnly);
  if (!effectiveReadOnly && /(galerie|galeries|membres?\/.?non.membres|plan de contenu|processus de vente|fonctionnalite|developpement)/.test(text)) {
    return {
      completed: false, blocked: true, awaiting_review: true, provider: 'cockpit-server',
      result: { domain: executor.domain, repository: executor.repository, dispatched: false, verified: false },
      report: 'Développement assigné, mais aucun exécuteur de développement avec preuve de livraison n’est raccordé à ce moteur de sites.',
      reason: 'developpement_non_execute_preuve_de_livraison_absente',
    };
  }
  const before = await analyze(executor.domain);
  if (effectiveReadOnly) {
    return {
      completed: true,
      awaiting_review: false,
      provider: 'cockpit-server',
      conversation_id: null,
      report: JSON.stringify(before),
      result: before,
      reason: null,
    };
  }

  const repairKind = /seo/.test(text) ? 'seo' : 'repair';
  const alreadyCompliant = repairKind === 'seo'
    ? before.http?.apex?.ok && Number(before.seo?.score || 0) >= 85
    : before.healthy === true;
  if (alreadyCompliant) {
    return {
      completed: true,
      awaiting_review: false,
      provider: 'cockpit-server',
      conversation_id: null,
      report: JSON.stringify(before),
      result: { domain: executor.domain, verified: true, already_compliant: true, repository: executor.repository, probe: before },
      reason: null,
    };
  }

  if (typeof dispatch !== 'function') {
    return {
      completed: false,
      awaiting_review: true,
      provider: 'cockpit-server',
      conversation_id: null,
      report: `Correction préparée pour ${executor.repository || executor.domain}; aucune réussite n’est simulée avant commit et nouveau contrôle public.`,
      result: { domain: executor.domain, repository: executor.repository, hosting: executor.hosting, before, dispatched: false },
      reason: executor.repository ? 'correction_repertoire_interne_a_executer' : 'depot_github_non_renseigne',
    };
  }

  const dispatched = await dispatch(executor, task, { before, kind: repairKind });
  const after = await analyze(executor.domain);
  const verified = verifiedImprovement(repairKind, before, after);
  return {
    completed: verified,
    awaiting_review: !verified,
    provider: 'cockpit-server',
    conversation_id: dispatched.run_id || dispatched.conversation_id || null,
    report: clean(dispatched.report || dispatched.content, 12000),
    result: { domain: executor.domain, repository: executor.repository, verified, before, after, dispatch: dispatched },
    reason: verified ? null : 'correction_interne_executee_mais_amelioration_non_mesuree',
  };
}

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function recordFrom(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.data && !Array.isArray(payload.data)) return payload.data;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && !payload.data && !payload.items) return payload;
  return rowsFrom(payload)[0] || null;
}

function missingLegalFields(client = {}) {
  return ['denomination_legale', 'numero_entreprise', 'numero_tva', 'adresse', 'code_postal', 'ville']
    .filter((field) => !clean(client[field], 500));
}

function clientName(client = {}) {
  return clean(client.denomination_legale || client.entreprise || client.nom || client.name, 240);
}

function bcePatch(client, record) {
  const allowed = ['denomination_legale', 'numero_entreprise', 'numero_tva', 'adresse', 'code_postal', 'ville', 'pays'];
  return Object.fromEntries(allowed
    .filter((field) => !clean(client[field], 500) && clean(record[field], 500))
    .map((field) => [field, record[field]]));
}

async function executeBusinessTask(task, agentRequest) {
  const text = normalized(taskText(task));
  const clients = rowsFrom(await agentRequest('/data/Client?limit=500'));

  if (/(analys|audit|verifi|control).*(facture|rattachement)|(facture|rattachement).*(analys|audit|verifi|control)/.test(text)) {
    const [invoices, projects] = await Promise.all([
      agentRequest('/data/Facture?limit=500').then(rowsFrom),
      agentRequest('/data/Projet?limit=500').then(rowsFrom),
    ]);
    const result = {
      audit_id: `business-${crypto.randomUUID()}`,
      checked_at: new Date().toISOString(),
      clients_count: clients.length,
      invoices_count: invoices.length,
      projects_count: projects.length,
      clients_missing_legal_data: clients.filter((client) => missingLegalFields(client).length).map((client) => client.id).filter(Boolean),
      invoices_without_client: invoices.filter((invoice) => !invoice.client_id && !invoice.client_nom).map((invoice) => invoice.id).filter(Boolean),
      projects_without_client: projects.filter((project) => !project.client_id && !project.client_nom).map((project) => project.id).filter(Boolean),
    };
    return { completed: true, provider: 'cockpit-server', result, report: JSON.stringify(result) };
  }

  const isSynergie = /synergie dour/.test(text);
  const targets = isSynergie
    ? clients.filter((client) => /synergie.*dour|dour.*synergie/.test(normalized(clientName(client))))
    : clients.filter((client) => missingLegalFields(client).length);
  if (isSynergie && targets.length !== 1) {
    throw new Error(`Mise à jour Synergie Dour impossible: ${targets.length} fiche(s) correspondante(s), une seule est requise.`);
  }
  if (!targets.length) {
    return { completed: true, provider: 'cockpit-server', result: { checked_at: new Date().toISOString(), updated: [], message: 'Aucune fiche incomplète détectée.' }, report: 'Aucune fiche client incomplète détectée.' };
  }

  const updated = [];
  const blocked = [];
  for (const client of targets.slice(0, 50)) {
    const enterpriseNumber = clean(client.numero_entreprise || client.numero_tva, 40);
    const name = clientName(client);
    const postalCode = clean(client.code_postal, 20);
    if (!enterpriseNumber && (!name || !postalCode)) {
      blocked.push({ client_id: client.id, reason: 'numero_entreprise_ou_nom_et_code_postal_manquants' });
      continue;
    }
    try {
      const record = await lookupBce({ enterprise_number: enterpriseNumber, name, postal_code: postalCode });
      const patch = bcePatch(client, record);
      if (Object.keys(patch).length) {
        await agentRequest(`/data/Client/${encodeURIComponent(client.id)}`, { method: 'PATCH', body: patch });
      }
      updated.push({ client_id: client.id, fields: Object.keys(patch), source: 'BCE officielle' });
    } catch (error) {
      blocked.push({ client_id: client.id, reason: clean(error.message, 400) });
    }
  }

  const result = { audit_id: `business-${crypto.randomUUID()}`, checked_at: new Date().toISOString(), source: 'BCE officielle', updated, blocked };
  return {
    completed: blocked.length === 0,
    awaiting_review: blocked.length > 0,
    provider: 'cockpit-server',
    result,
    report: JSON.stringify(result),
    reason: blocked.length ? 'certaines_fiches_ne_peuvent_pas_etre_verifiees_automatiquement' : null,
  };
}

module.exports = {
  INTERNAL_EXECUTORS,
  SITE_AGENT_KEYS,
  bcePatch,
  clientName,
  executeBusinessTask,
  executeProjectTask,
  executeSiteTask,
  executeVideoTask,
  isReadOnlySiteTask,
  missingLegalFields,
  projectForTask,
  projectPatchFromTask,
  sourceDocumentIdFromTask,
  sourceDocumentIdsFromTask,
  videoClientForTask,
  videoPromptForTask,
  resolveNovaExecutor,
  siteExecutorForTask,
};
