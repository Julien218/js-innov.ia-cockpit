export async function campaignApi(path, options = {}) {
  const response = await fetch('/api/campaigns' + path, {
    credentials: 'same-origin',
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : (options.headers || {})
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || ('Campagnes HTTP ' + response.status));
    error.status = response.status;
    error.code = data.code || null;
    throw error;
  }
  return data;
}

export function csvToArray(value) {
  return String(value || '').split(/[\n,;]/).map(v => v.trim()).filter(Boolean);
}

export function arrayToCsv(value) {
  return (Array.isArray(value) ? value : []).join(', ');
}

async function findLocalCampaignAgent() {
  for (const base of ['http://127.0.0.1:8788', 'http://127.0.0.1:8787']) {
    try {
      const response = await fetch(base + '/api/campaign-worker/status', {
        signal: AbortSignal.timeout(3000),
        headers: { Accept: 'application/json' },
      });
      if (response.ok) return { base, status: await response.json() };
    } catch {}
  }
  return null;
}

export async function pairCampaignLocalWorker(name = 'Elynea Local Worker') {
  const local = await findLocalCampaignAgent();
  if (!local) {
    const error = new Error('Agent local Elynea 1.7+ introuvable sur ce PC. Lance ou mets à jour l’agent local.');
    error.code = 'LOCAL_AGENT_UNAVAILABLE';
    throw error;
  }

  const paired = await campaignApi('/local-worker/pair', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  if (!paired?.token || !paired?.worker?.id) throw new Error('Appairage serveur incomplet.');

  const response = await fetch(local.base + '/api/campaign-worker/configure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      worker_id: paired.worker.id,
      token: paired.token,
      cloud_url: window.location.origin,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const configured = await response.json().catch(() => ({}));
  if (!response.ok || configured?.ok !== true) {
    const error = new Error(configured?.error || 'L’agent local n’a pas accepté l’appairage.');
    error.code = 'LOCAL_PAIRING_FAILED';
    throw error;
  }
  return { server: paired.worker, local: configured.worker };
}

export async function localCampaignWorkerStatus() {
  const [cloud, local] = await Promise.all([
    campaignApi('/local-worker/status').catch(() => ({ paired: false, online: false, worker: null })),
    findLocalCampaignAgent(),
  ]);
  return {
    paired: Boolean(cloud?.paired),
    online: Boolean(cloud?.online),
    cloud: cloud?.worker || null,
    local_agent_reachable: Boolean(local),
    local: local?.status?.worker || null,
    local_base: local?.base || null,
  };
}

export async function requestCampaignImage(postId, allowPaidApi = false) {
  return campaignApi('/posts/' + encodeURIComponent(postId) + '/generate-image', {
    method: 'POST',
    body: JSON.stringify({ allow_paid_api: allowPaidApi }),
  });
}

export async function approveCampaignImageAndGenerateVideo(postId, allowPaidApi = false) {
  return campaignApi('/posts/' + encodeURIComponent(postId) + '/approve-image-and-generate-video', {
    method: 'POST',
    body: JSON.stringify({ allow_paid_api: allowPaidApi }),
  });
}
