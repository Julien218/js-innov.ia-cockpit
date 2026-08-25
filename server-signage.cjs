const express = require('express');

const router = express.Router();

const SIGNAGE_BASE_URL = 'https://olivier-signage-cockpit-production.up.railway.app';
const SIGNAGE_MANAGER_URL = `${SIGNAGE_BASE_URL}/ecran-geant`;
const SIGNAGE_HEALTH_URL = `${SIGNAGE_BASE_URL}/api/health`;

async function probeSignage(fetchImpl = global.fetch) {
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetchImpl(SIGNAGE_HEALTH_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    const payload = await response.json().catch(() => ({}));
    const healthy = response.ok && payload?.status === 'ok';

    return {
      healthy,
      status: response.status,
      service: payload?.service || 'olivier-signage-cockpit',
      checked_at: checkedAt,
      manager_url: SIGNAGE_MANAGER_URL,
    };
  } catch (error) {
    return {
      healthy: false,
      status: null,
      service: 'olivier-signage-cockpit',
      checked_at: checkedAt,
      manager_url: SIGNAGE_MANAGER_URL,
      error: error?.cause?.code || error?.code || 'service_unreachable',
    };
  }
}

router.get('/status', async (_req, res) => {
  const status = await probeSignage();
  res.status(status.healthy ? 200 : 503).json(status);
});

module.exports = {
  router,
  probeSignage,
  SIGNAGE_BASE_URL,
  SIGNAGE_MANAGER_URL,
  SIGNAGE_HEALTH_URL,
};
