async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function fetchPublisya(path, options = {}) {
  const response = await fetch(`/api/publisya${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof Blob) && typeof options.body !== 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(data.error || `Publisya indisponible (${response.status})`);
    error.code = data.code || null;
    error.status = response.status;
    throw error;
  }
  return data;
}

function jsonAction(path, method, payload = {}) {
  return fetchPublisya(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export const getPublisyaStatus = () => fetchPublisya('/status');
export const getPublisyaDashboard = () => fetchPublisya('/dashboard');
export const listPublisyaCampaigns = () => fetchPublisya('/campaigns');
export const getPublisyaCampaign = (campaignId) => fetchPublisya(`/campaigns/${encodeURIComponent(campaignId)}`);

export const createPublisyaCampaign = (payload) => jsonAction('/campaigns', 'POST', payload);

export const analyzePublisyaCampaign = (campaignId) => fetchPublisya(`/campaigns/${encodeURIComponent(campaignId)}/analyze`, {
  method: 'POST',
});

export const updatePublisyaVariant = (campaignId, variantId, payload) => jsonAction(
  `/campaigns/${encodeURIComponent(campaignId)}/variants/${encodeURIComponent(variantId)}`,
  'PATCH',
  payload,
);

export const approvePublisyaCampaign = (campaignId, comment = '') => jsonAction(
  `/campaigns/${encodeURIComponent(campaignId)}/approve`,
  'POST',
  { comment },
);

export const requestPublisyaChanges = (campaignId, comment = '') => jsonAction(
  `/campaigns/${encodeURIComponent(campaignId)}/request-changes`,
  'POST',
  { comment },
);

export async function uploadPublisyaMedia(campaignId, file, onProgress) {
  if (!(file instanceof File)) throw new Error('Fichier média invalide.');
  onProgress?.(5);

  const response = await fetch(`/api/publisya/campaigns/${encodeURIComponent(campaignId)}/media`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
      'X-File-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  onProgress?.(90);
  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(data.error || `Upload Publisya impossible (${response.status})`);
    error.code = data.code || null;
    error.status = response.status;
    throw error;
  }
  onProgress?.(100);
  return data;
}
