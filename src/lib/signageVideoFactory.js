export const MAX_LOCAL_VIDEO_BATCH = 32;
export const SIGNAGE_VIDEO_SECONDS = 8;
export const SIGNAGE_GENERATION_SIZE = Object.freeze({ width: 608, height: 352 });
export const SIGNAGE_EXPORT_SIZE = Object.freeze({ width: 1920, height: 1080, fps: 25 });

const DIRECTIONS = Object.freeze([
  {
    id: 'institutional',
    label: 'Institutionnelle',
    angle: 'Brand recognition first: make the official logo and business name the strongest visual anchors.',
  },
  {
    id: 'commercial',
    label: 'Commerciale',
    angle: 'Offer first: show one clear product or service benefit, then lock on the official logo and contact.',
  },
  {
    id: 'dynamic',
    label: 'Dynamique',
    angle: 'Visual impact first: energetic but controlled motion, immediately followed by the official logo and contact.',
  },
]);

function clean(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function safeIdPart(value) {
  return clean(value, 'video').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';
}

export function createFactoryJobId(clientName, index, now = Date.now()) {
  return `${safeIdPart(clientName)}-${String(index + 1).padStart(2, '0')}-${now.toString(36)}`;
}

export function buildSignagePrompt(input = {}, direction = DIRECTIONS[0], index = 0) {
  const clientName = clean(input.clientName, '[NOM DU CLIENT]');
  const phone = clean(input.phone, '[NUMÉRO EXACT]');
  const services = clean(input.services, '[ACTIVITÉ PRINCIPALE]');
  const brief = clean(input.brief, 'Présenter clairement l’entreprise et son activité.');
  const locality = clean(input.locality, 'Dour');
  return [
    `Create an exactly ${SIGNAGE_VIDEO_SECONDS}-second outdoor LED advertising video in horizontal 16:9.`,
    `Client: ${clientName}. Direction ${index + 1} — ${direction.label}. ${direction.angle}`,
    `Campaign brief: ${brief}`,
    `Verified services or offer: ${services}.`,
    `Verified phone: ${phone}. Locality: ${locality}.`,
    'Use the supplied official logo and reference image without redrawing, restyling, misspelling or deforming them.',
    'Never invent a logo, slogan, price, promotion, service, address, website or phone number.',
    'Timeline: 0-2s brand recognition; 2-5s one clear activity or offer; 5-8s stable final card.',
    `The final card must show the official ${clientName} logo very large and the exact phone ${phone} in large bold high-contrast characters for three complete seconds.`,
    'Maximum 6-8 important words on screen at once. No QR code. No tiny copy. No aggressive flashes, camera shake or fast zoom.',
    'Professional, realistic, locally relevant, readable from a moving vehicle at several dozen metres.',
    'Keep all critical elements inside an 8% safe margin. No other company or creator branding may be visible.',
    'Generate at the configured local resolution; final delivery will be normalized to 1920x1080 H.264 at 25 fps.',
  ].join(' ');
}

export function createThreeSignageConcepts(input = {}, now = Date.now()) {
  return DIRECTIONS.map((direction, index) => ({
    id: createFactoryJobId(input.clientName, index, now),
    position: index + 1,
    direction: direction.id,
    directionLabel: direction.label,
    title: `Proposition ${index + 1} — ${direction.label}`,
    prompt: buildSignagePrompt(input, direction, index),
    seconds: SIGNAGE_VIDEO_SECONDS,
    width: SIGNAGE_GENERATION_SIZE.width,
    height: SIGNAGE_GENERATION_SIZE.height,
    seed: Math.floor(Math.random() * 0xffffffff),
    status: 'draft',
  }));
}

export function normalizeLocalBatchJobs(jobs = []) {
  if (!Array.isArray(jobs) || jobs.length === 0) throw new Error('Ajoute au moins une vidéo à produire.');
  if (jobs.length > MAX_LOCAL_VIDEO_BATCH) throw new Error(`Un lot local est limité à ${MAX_LOCAL_VIDEO_BATCH} vidéos.`);
  const seen = new Set();
  return jobs.map((job, index) => {
    if (!job?.workflow || typeof job.workflow !== 'object' || Array.isArray(job.workflow)) {
      throw new Error(`Workflow ComfyUI invalide pour la vidéo ${index + 1}.`);
    }
    const id = clean(job.id, `video-${index + 1}`);
    if (seen.has(id)) throw new Error(`Identifiant de vidéo en double: ${id}.`);
    seen.add(id);
    return {
      id,
      title: clean(job.title, `Vidéo ${index + 1}`),
      prompt: clean(job.prompt),
      workflow: job.workflow,
      clientId: clean(job.clientId, 'jsinnovia-signage-factory'),
      metadata: {
        ...(job.metadata && typeof job.metadata === 'object' ? job.metadata : {}),
        position: Number(job.metadata?.position || index + 1),
        seconds: SIGNAGE_VIDEO_SECONDS,
        export: SIGNAGE_EXPORT_SIZE,
      },
    };
  });
}

export function summarizeLocalBatch(batch = {}) {
  const jobs = Array.isArray(batch.jobs) ? batch.jobs : [];
  const counts = { total: jobs.length, draft: 0, queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  jobs.forEach((job) => {
    const status = Object.prototype.hasOwnProperty.call(counts, job.status) ? job.status : 'draft';
    counts[status] += 1;
  });
  return {
    ...counts,
    progress: counts.total ? Math.round(((counts.completed + counts.failed + counts.cancelled) / counts.total) * 100) : 0,
    done: counts.total > 0 && counts.completed + counts.failed + counts.cancelled === counts.total,
  };
}

export function buildReviewTimeline(jobs = []) {
  const selected = jobs.slice(0, 3);
  const timeline = [{ kind: 'intro', label: '3 propositions visuelles', seconds: 3 }];
  selected.forEach((job, index) => {
    timeline.push({ kind: 'title', label: `Proposition ${index + 1}`, seconds: 1.5 });
    timeline.push({ kind: 'video', jobId: job.id, label: job.title, seconds: SIGNAGE_VIDEO_SECONDS });
  });
  timeline.push({ kind: 'choice', label: 'Choisissez la proposition 1, 2 ou 3', seconds: 4 });
  return {
    timeline,
    duration: timeline.reduce((sum, item) => sum + item.seconds, 0),
    ready: selected.length === 3 && selected.every((job) => job.status === 'completed'),
  };
}
