const BASE_URL = import.meta.env.VITE_AVATAR_FACTORY_URL || 'http://127.0.0.1:8791';
const UPLOAD_URL = import.meta.env.VITE_AVATAR_REFERENCE_UPLOAD_URL || 'http://127.0.0.1:8792';

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
    reader.onerror = () => reject(new Error('Impossible de lire l’image sélectionnée.'));
    reader.onload = () => {
      const value = String(reader.result || '');
      const comma = value.indexOf(',');
      resolve(comma >= 0 ? value.slice(comma + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}

export const avatarFactory = {
  baseUrl: BASE_URL,
  uploadUrl: UPLOAD_URL,
  health: () => request('/health'),
  uploadHealth: () => request('/health', {}, UPLOAD_URL),
  listJobs: () => request('/jobs'),
  getJob: (id) => request(`/jobs/${encodeURIComponent(id)}`),
  createJob: (payload) => request('/jobs', { method: 'POST', body: JSON.stringify(payload) }),
  approveJob: (id) => request(`/jobs/${encodeURIComponent(id)}/approve`, { method: 'POST', body: '{}' }),
  rejectJob: (id, reason) => request(`/jobs/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  costSummary: () => request('/costs/summary'),
  uploadReference: async (file, characterId) => {
    if (!file) throw new Error('Aucune image sélectionnée.');
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.type)) throw new Error('Format accepté : PNG, JPG/JPEG ou WEBP.');
    if (file.size > 12 * 1024 * 1024) throw new Error('Image trop volumineuse : maximum 12 Mo.');
    const dataBase64 = await fileToBase64(file);
    return request('/references/upload', {
      method: 'POST',
      body: JSON.stringify({
        file_name: file.name,
        mime_type: file.type,
        data_base64: dataBase64,
        character_id: characterId || 'avatar',
      }),
    }, UPLOAD_URL);
  },
};
