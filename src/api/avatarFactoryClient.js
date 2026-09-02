const BASE_URL = import.meta.env.VITE_AVATAR_FACTORY_URL || 'http://127.0.0.1:8791';
const UPLOAD_URL = import.meta.env.VITE_AVATAR_REFERENCE_UPLOAD_URL || 'http://127.0.0.1:8792';
const PREVIEW_URL = import.meta.env.VITE_AVATAR_PREVIEW_URL || 'http://127.0.0.1:8793';

const SUBJECT_KINDS = new Set(['auto', 'person', 'animal', 'bird', 'object', 'other']);
const RIG_MODES = new Set(['auto', 'none', 'humanoid', 'quadruped', 'avian', 'generic']);
const VIEWS = new Set(['front', 'left', 'back', 'right']);

async function request(path, options = {}, baseUrl = BASE_URL) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Avatar Factory HTTP ${response.status}`);
  return data;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture de l’image impossible.'));
    reader.onload = () => {
      const value = String(reader.result || '');
      resolve(value.includes(',') ? value.split(',')[1] : value);
    };
    reader.readAsDataURL(file);
  });
}

export function slugifyAvatarSubject(value, fallback = 'nouveau-sujet') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function normalizeSubjectDescriptor(subject = {}) {
  const source = typeof subject === 'string' ? { character_id: subject } : (subject || {});
  const characterId = slugifyAvatarSubject(source.character_id || source.subject_name);
  const subjectKind = SUBJECT_KINDS.has(source.subject_kind) ? source.subject_kind : 'auto';
  const rigMode = RIG_MODES.has(source.rig_mode) ? source.rig_mode : 'auto';
  return {
    character_id: characterId,
    subject_name: String(source.subject_name || characterId).trim().slice(0, 160),
    subject_kind: subjectKind,
    rig_mode: rigMode,
  };
}

async function registerSubject(payload) {
  const subject = normalizeSubjectDescriptor(payload);
  return request('/subjects/register', {
    method: 'POST',
    body: JSON.stringify(subject),
  }, UPLOAD_URL);
}

export const avatarFactory = {
  baseUrl: BASE_URL,
  uploadUrl: UPLOAD_URL,
  previewUrl: PREVIEW_URL,
  health: () => request('/health'),
  uploadHealth: () => request('/health', {}, UPLOAD_URL),
  previewHealth: () => request('/health', {}, PREVIEW_URL),
  listJobs: () => request('/jobs'),
  getJob: id => request(`/jobs/${encodeURIComponent(id)}`),
  registerSubject,
  createJob: async payload => {
    const subject = normalizeSubjectDescriptor(payload);
    await registerSubject(subject);
    return request('/jobs', {
      method: 'POST',
      body: JSON.stringify({ ...payload, ...subject }),
    });
  },
  approveJob: id => request(`/jobs/${encodeURIComponent(id)}/approve`, { method: 'POST', body: '{}' }),
  rejectJob: (id, reason) => request(`/jobs/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  costSummary: () => request('/costs/summary'),
  candidateUrl: id => `${PREVIEW_URL}/jobs/${encodeURIComponent(id)}/candidate.glb`,
  uploadReference: async (file, subject, requestedView = 'front') => {
    if (!file) throw new Error('Aucune image sélectionnée.');
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.type)) throw new Error('Format accepté : PNG, JPG/JPEG ou WEBP.');
    if (file.size > 12 * 1024 * 1024) throw new Error('Image trop volumineuse : maximum 12 Mo.');
    const view = VIEWS.has(requestedView) ? requestedView : 'front';
    const descriptor = normalizeSubjectDescriptor(subject);
    const dataBase64 = await fileToBase64(file);
    return request('/references/upload', {
      method: 'POST',
      body: JSON.stringify({
        file_name: file.name,
        mime_type: file.type,
        data_base64: dataBase64,
        view,
        ...descriptor,
      }),
    }, UPLOAD_URL);
  },
};
