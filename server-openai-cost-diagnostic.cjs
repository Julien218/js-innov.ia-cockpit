const express = require('express');
const { requireSession, requirePermission, requireSameOrigin } = require('./server-security.cjs');

const COSTS_URL = 'https://api.openai.com/v1/organization/costs';
const MESSAGES = Object.freeze({
  connected: 'Connexion OpenAI validée : accès en lecture aux coûts autorisé. Aucun coût importé. Les rattachements client/projet restent à vérifier.',
  missing_key: 'OPENAI_ADMIN_KEY est absente ou vide sur le serveur. Vérifiez la variable Railway et son déploiement.',
  invalid_key: 'OpenAI refuse l’authentification. Vérifiez la validité de la clé d’administration dans Railway.',
  forbidden: 'OpenAI refuse l’accès aux coûts. Vérifiez les droits de la clé d’administration de l’organisation ; renommer une clé de projet ne lui accorde pas ces droits.',
  provider_rate_limit: 'OpenAI limite temporairement les requêtes. Réessayez plus tard.',
  provider_unavailable: 'Le service de coûts OpenAI est temporairement indisponible.',
  unexpected_response: 'Réponse OpenAI inattendue : accès aux coûts non validé.',
  timeout: 'Le test OpenAI a dépassé le délai de 10 secondes. Réessayez plus tard.',
  network_error: 'Connexion au service OpenAI impossible. Vérifiez le réseau du serveur.',
  cooldown: 'Un test vient d’être lancé. Attendez quelques secondes avant de réessayer.',
});

function result(status, providerStatus = null) {
  return {
    ok: status === 'connected',
    status,
    message: MESSAGES[status],
    provider_http_status: providerStatus,
    checked_at: new Date().toISOString(),
    read_only: true,
  };
}

// Never call a model, an importer, the ledger or a database here.
// Provider bodies/errors may contain credentials: only allowlisted metadata leaves this module.
async function testOpenAICostConnection(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const key = String(env.OPENAI_ADMIN_KEY || '').trim();
  if (!key) return result('missing_key');
  const end = Math.floor((options.now ? options.now() : Date.now()) / 86400000) * 86400;
  const url = new URL(COSTS_URL);
  url.searchParams.set('start_time', String(end - 86400));
  url.searchParams.set('end_time', String(end));
  url.searchParams.set('bucket_width', '1d');
  url.searchParams.set('limit', '1');
  const signal = options.signal || AbortSignal.timeout(10000);
  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      redirect: 'error',
      signal,
    });
    const status = response.status;
    if (status !== 200) {
      await response.body?.cancel().catch(() => {});
      if (status === 401) return result('invalid_key', status);
      if (status === 403) return result('forbidden', status);
      if (status === 429) return result('provider_rate_limit', status);
      return result(status >= 500 ? 'provider_unavailable' : 'unexpected_response', status);
    }
    const data = await response.json();
    if (data?.object !== 'page' || !Array.isArray(data.data)) {
      return result('unexpected_response', status);
    }
    // Empty costs are a valid connection result, not proof of a zero monthly bill.
    return result('connected', status);
  } catch (error) {
    if (signal.aborted || ['TimeoutError', 'AbortError'].includes(error?.name)) return result('timeout');
    if (error instanceof SyntaxError) return result('unexpected_response', 200);
    return result('network_error');
  }
}

function createDiagnosticRouter(options = {}) {
  const router = express.Router();
  let nextAllowedAt = 0;
  const clock = options.now || Date.now;
  router.post('/connection-test',
    requireSameOrigin,
    requireSession('admin'),
    requirePermission('ai_cost_control', 'admin'),
    async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const now = clock();
      if (now < nextAllowedAt) {
        res.setHeader('Retry-After', String(Math.ceil((nextAllowedAt - now) / 1000)));
        return res.status(429).json(result('cooldown'));
      }
      // Per-process guard also covers overlapping requests from different administrators.
      nextAllowedAt = now + 15000;
      return res.json(await testOpenAICostConnection(options));
    });
  return router;
}

module.exports = { testOpenAICostConnection, createDiagnosticRouter };
