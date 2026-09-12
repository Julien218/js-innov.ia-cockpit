const express = require('express');
const connector = require('./server-ionos-connector.cjs');
const { requireSession } = require('./server-security.cjs');

function createRouters(service = connector) {
  const router = express.Router();
  // Provider credentials cover the owner's account, not tenant-specific resources.
  router.use(requireSession('superadmin'));
  const recent = new Map();
  function rate(req, res, next) {
    const now = Date.now();
    for (const [id, entry] of recent) if (entry.until < now) recent.delete(id);
    const item = recent.get(req.user.id) || { count: 0, until: now + 60_000 };
    recent.set(req.user.id, item);
    if (++item.count > 20) return res.status(429).json({ error: 'Trop de consultations IONOS. Réessayer dans une minute.' });
    next();
  }
  router.get('/status', (_req, res) => res.json(service.configuration()));
  router.post('/read', rate, async (req, res) => {
    try { res.json(await service.read(req.body?.tool, req.body?.arguments || {})); }
    catch (error) { res.status(error.status || 502).json({ error: error.message }); }
  });
  const chatRouter = express.Router();
  chatRouter.post('/chat', (req, res, next) => {
    const intent = service.chatIntent(req.body?.message);
    if (!intent) return next();
    return requireSession('superadmin')(req, res, () => rate(req, res, async () => {
      if (intent === 'write_unsupported') return res.json({
        message: 'Le connecteur IONOS de NOVA consulte les domaines, DNS et serveurs. Aucune modification n’a été effectuée. Une opération d’administration exige un aperçu précis et une confirmation séparée.', confirmation: null });
      if (intent === 'status') {
        const state = service.configuration();
        return res.json({ message: state.hosting_configured ? 'Le connecteur IONOS est installé. Demandez « Liste mes domaines IONOS » ou ouvrez Domaines → IONOS. La validité du jeton sera vérifiée lors de la consultation.' : 'Le connecteur IONOS est installé. Ajoutez IONOS_PAT dans les variables Railway du cockpit pour activer la consultation.', ionos: state });
      }
      try {
        const result = await service.read(intent, intent === 'domains_list_domains' ? { offset: 0, limit: 100 } : {});
        const items = service.rows(result.data);
        const lines = items.slice(0, 100).map(item => {
          if (typeof item !== 'object' || !item) return `- ${String(item).slice(0, 180)}`;
          return `- ${String(item.name || item.zoneName || item.properties?.name || item.contract_name || item.id || 'Ressource').replace(/[\r\n]/g, ' ').slice(0, 180)}${item.id ? ` — ${item.id}` : ''}`;
        });
        const contracts = intent.includes('contracts');
        const message = [`Consultation IONOS vérifiée le ${result.checked_at}.`, ...lines,
          items.length ? '' : 'Aucune ressource retournée pour cette consultation.',
          contracts ? 'Ouvrez Domaines → IONOS et sélectionnez un contrat pour consulter ses serveurs.' : 'Ouvrez Domaines → IONOS pour les détails et la suite des pages.',
          'Cette réponse correspond à la page consultée, pas nécessairement à tout le compte.'].filter(Boolean).join('\n');
        return res.json({ message, response: message, confirmation: null, inspection_only: true, ionos: result });
      } catch (error) { return res.status(error.status || 502).json({ error: error.message, confirmation: null }); }
    }));
  });
  return { router, chatRouter };
}
module.exports = { ...createRouters(), createRouters };
