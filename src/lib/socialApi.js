async function request(path, options = {}) {
  const response = await fetch(`/api/social${path}`, {
    credentials: 'same-origin',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    ...options,
    ...(options.body !== undefined && typeof options.body !== 'string' ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Social Command HTTP ${response.status}`);
  return data;
}

export const socialApi = {
  status: () => request('/status'),
  overview: () => request('/overview'),
  brands: () => request('/brands'),
  createBrand: (body) => request('/brands', { method: 'POST', body }),
  updateBrand: (id, body) => request(`/brands/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  syncBrand: (id) => request(`/brands/${encodeURIComponent(id)}/sync`, { method: 'POST', body: {} }),
  campaigns: () => request('/campaigns'),
  createCampaign: (body) => request('/campaigns', { method: 'POST', body }),
  updateCampaign: (id, body) => request(`/campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  posts: (campaignId) => request(`/posts${campaignId ? `?campaign_id=${encodeURIComponent(campaignId)}` : ''}`),
  createPost: (body) => request('/posts', { method: 'POST', body }),
  updatePost: (id, body) => request(`/posts/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  approvePost: (id) => request(`/posts/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} }),
  schedulePost: (id, scheduled_at) => request(`/posts/${encodeURIComponent(id)}/schedule`, { method: 'POST', body: { scheduled_at } }),
  cancelPost: (id) => request(`/posts/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} }),
  accounts: () => request('/accounts'),
  createAccount: (body) => request('/accounts', { method: 'POST', body }),
  runBackup: () => request('/backup/run', { method: 'POST', body: {} }),
};
