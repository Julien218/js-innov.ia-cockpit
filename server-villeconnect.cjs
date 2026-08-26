const express = require('express');

const router = express.Router();

const VILLECONNECT_PROJECT_ID = '4e2424fc-5e4c-4b60-b5cc-54166d59d85a';
const VILLECONNECT_SITE_URL = 'https://villeconnectos.com/';
const VILLECONNECT_APP_URL = 'https://app.villeconnectos.com/';
const VILLECONNECT_API_URL = 'https://villeconnect-production.up.railway.app';
const VILLECONNECT_GITHUB_URL = 'https://github.com/Julien218/villeconnect';
const VILLECONNECT_RAILWAY_URL = 'https://railway.com/project/12d50906-8d50-40fd-902d-76c37bd651eb';

const withTimeout = () => AbortSignal.timeout(7000);

async function probeHtml(fetchImpl, url, marker) {
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'text/html' },
      signal: withTimeout(),
    });
    const body = await response.text().catch(() => '');
    return {
      healthy: response.ok && body.toLowerCase().includes(marker.toLowerCase()),
      status: response.status,
      url,
    };
  } catch (error) {
    return {
      healthy: false,
      status: null,
      url,
      error: error?.cause?.code || error?.code || 'service_unreachable',
    };
  }
}

async function probeJson(fetchImpl, url, validator) {
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: withTimeout(),
    });
    const payload = await response.json().catch(() => ({}));
    return {
      healthy: response.ok && validator(payload),
      status: response.status,
      url,
      payload,
    };
  } catch (error) {
    return {
      healthy: false,
      status: null,
      url,
      payload: null,
      error: error?.cause?.code || error?.code || 'service_unreachable',
    };
  }
}

async function probeVilleConnect(fetchImpl = global.fetch) {
  const checkedAt = new Date().toISOString();
  const [site, application, api, waitlist] = await Promise.all([
    probeHtml(fetchImpl, VILLECONNECT_SITE_URL, 'VilleConnect OS'),
    probeHtml(fetchImpl, VILLECONNECT_APP_URL, 'Ma Commune'),
    probeJson(fetchImpl, `${VILLECONNECT_API_URL}/health`, payload => payload?.ok === true),
    probeJson(fetchImpl, `${VILLECONNECT_API_URL}/api/trpc/waitlist.count`, payload =>
      Number.isInteger(payload?.result?.data?.count)),
  ]);

  return {
    healthy: site.healthy && application.healthy && api.healthy,
    checked_at: checkedAt,
    project: {
      id: VILLECONNECT_PROJECT_ID,
      name: 'VilleConnectOS',
      status: 'en_cours',
      owner: 'JS-Innov.IA — projet interne',
    },
    site,
    application,
    api: {
      ...api,
      version: api.payload?.version || null,
      service: api.payload?.service || null,
      payload: undefined,
    },
    waitlist: {
      ...waitlist,
      count: waitlist.payload?.result?.data?.count ?? null,
      payload: undefined,
    },
    github: { url: VILLECONNECT_GITHUB_URL, repository: 'Julien218/villeconnect' },
    railway: { url: VILLECONNECT_RAILWAY_URL, service: 'villeconnect', environment: 'production' },
  };
}

router.get('/status', async (_req, res) => {
  res.json(await probeVilleConnect());
});

module.exports = {
  router,
  probeVilleConnect,
  VILLECONNECT_PROJECT_ID,
  VILLECONNECT_SITE_URL,
  VILLECONNECT_APP_URL,
  VILLECONNECT_API_URL,
  VILLECONNECT_GITHUB_URL,
  VILLECONNECT_RAILWAY_URL,
};
