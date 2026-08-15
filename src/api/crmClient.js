async function request(path, options = {}) {
  const response = await fetch(`/api/crm${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.error || `CRM indisponible (HTTP ${response.status})`);
  return payload;
}

export const crmClient = {
  async list() {
    const payload = await request('/clients');
    return Array.isArray(payload?.clients) ? payload.clients : [];
  },
  async create(data) {
    const payload = await request('/clients', { method: 'POST', body: JSON.stringify(data) });
    return payload?.client;
  },
  async update(id, data) {
    const payload = await request(`/clients/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) });
    return payload?.client;
  },
  async delete(id) {
    await request(`/clients/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};
