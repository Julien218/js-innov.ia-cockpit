function clean(value, fallback = '') {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() || fallback;
}

function exactClientName(vp = {}, sourceProject = {}) {
  return clean(
    vp.client_name || vp.client_nom || sourceProject.client_name || sourceProject.client_nom
      || sourceProject.denomination_legale || sourceProject.entreprise || sourceProject.brand_name,
    'Client à identifier',
  );
}

function sourceNames(vp = {}) {
  return (Array.isArray(vp.clips) ? vp.clips : []).map((clip) => clean(clip.name || clip.fileName || clip.url)).filter(Boolean);
}

export function buildVideoProvenance(vp = {}, sourceProject = {}, options = {}) {
  const durationSeconds = Math.max(0.001, Number(options.durationSeconds) || Number(vp.template_duration) || 8);
  const client = exactClientName(vp, sourceProject);
  const campaign = clean(vp.campaign_name || vp.title || sourceProject.event_name || sourceProject.project_name, 'Campagne à identifier');
  const usageRights = clean(
    vp.usage_rights || sourceProject.usage_rights,
    'Utilisation limitée à la campagne et aux supports validés par le client; toute extension requiert une validation.',
  );
  return {
    clientId: clean(vp.client_id || sourceProject.client_id),
    client,
    campaign,
    campaignId: clean(vp.campaign_id || vp.id || sourceProject.id),
    prompt: clean(vp.ai_prompt),
    sourceMedia: sourceNames(vp),
    creationDate: new Date().toISOString().slice(0, 10),
    validationDate: clean(vp.validation_date) || null,
    version: clean(vp.version || vp.version_number, 'v01'),
    durationSeconds,
    width: Number(options.width) || 1920,
    height: Number(options.height) || 1080,
    resolutionLabel: clean(options.resolutionLabel, '1080p'),
    sector: clean(vp.client_sector || sourceProject.sector || sourceProject.secteur, 'activité locale'),
    usageRights,
    rightsConfirmed: vp.rights_confirmed === true || sourceProject.rights_confirmed === true,
    copyright: clean(vp.copyright || sourceProject.copyright),
    exportParameters: {
      exportType: clean(options.exportType, 'video'),
      fps: Number(options.fps) || 30,
      requestedDurationSeconds: durationSeconds,
      sourceContainer: clean(options.sourceContainer, 'WebM'),
      audio: options.audio === true || Boolean(vp.audio_url),
      visualFormat: clean(options.visualFormat || vp.template_format, '16:9'),
    },
  };
}

export async function encodeVideoPackage(blob, metadata) {
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error('Vidéo source vide.');
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  if (json.byteLength > 256 * 1024) throw new Error('Fiche de traçabilité trop volumineuse.');
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, json.byteLength, false);
  return new Blob([header, json, blob], { type: 'application/vnd.jsinnovia.video-package' });
}

export async function finalizeAndArchiveVideo(blob, metadata, fetchImpl = window.fetch.bind(window)) {
  const body = await encodeVideoPackage(blob, metadata);
  let cloudError = null;
  try {
    const response = await fetchImpl('/api/video-provenance/finalize', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/vnd.jsinnovia.video-package' },
      body,
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.finalized && result.verified) return result;
    cloudError = new Error(result.error || `Finalisation vidéo refusée (${response.status}).`);
  } catch (error) {
    cloudError = error;
  }
  if (window.electronAPI?.videoLocal?.finalize) {
    const bytes = await blob.arrayBuffer();
    const local = await window.electronAPI.videoLocal.finalize({ bytes, metadata });
    if (local?.finalized && local?.verified) return local;
  }
  throw cloudError || new Error('Finalisation vidéo indisponible.');
}

export async function finalizeStudioExport(blob, { vp, sourceProject, ...options }) {
  const metadata = buildVideoProvenance(vp, sourceProject, options);
  return finalizeAndArchiveVideo(blob, metadata);
}
