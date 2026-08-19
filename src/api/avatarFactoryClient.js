const BASE_URL = import.meta.env.VITE_AVATAR_FACTORY_URL || 'http://127.0.0.1:8791';

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Avatar Factory HTTP ${response.status}`);
  return data;
}

export const avatarFactory = {
  baseUrl: BASE_URL,
  health: () => request('/health'),
  listJobs: () => request('/jobs'),
  getJob: (id) => request(`/jobs/${encodeURIComponent(id)}`),
  createJob: (payload) => request('/jobs', { method: 'POST', body: JSON.stringify(payload) }),
  approveJob: (id) => request(`/jobs/${encodeURIComponent(id)}/approve`, { method: 'POST', body: '{}' }),
  costSummary: () => request('/costs/summary'),
};
