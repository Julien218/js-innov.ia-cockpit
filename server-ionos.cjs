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
        const accounts = Number(state.dns_account_count || 0);
        return res.json({ message: state.hosting_configured || state.dns_configured
          ? `Le connecteur IONOS est installé. DNS: ${accounts || 1} compte(s) configuré(s). Demandez « vérifie le DNS de mon-domaine.be » ou ouvrez Domaines → IONOS. La connexion sera vérifiée lors de la consultation.`
          : 'Le connecteur IONOS est installé. Ajoutez IONOS_PAT pour tous les produits, ou IONOS_DNS_API_KEY pour les DNS, dans les variables Railway du cockpit.', ionos: state });
      }
      try {
        if (intent === 'dns_domain') {
          const domain = service.domainFromMessage(req.body?.message);
          const result = await service.readDomainDns(domain);
          const items = service.rows(result.data);
          const lines = items.slice(0, 100).map(item => {
            if (typeof item !== 'object' || !item) return `- ${String(item).slice(0, 180)}`;
            const name = String(item.name || domain || '').replace(/[\r\n]/g, ' ').slice(0, 180);
            const type = String(item.type || '').toUpperCase().slice(0, 16);
            const content = String(item.content ?? item.value ?? '').replace(/[\r\n]/g, ' ').slice(0, 300);
            const ttl = Number(item.ttl || 0);
            return `- ${type || 'DNS'} ${name}${content ? ` → ${content}` : ''}${ttl ? ` (TTL ${ttl})` : ''}`;
          });
          const message = [
            `DNS IONOS vérifié le ${result.checked_at}.`,
            `Domaine: ${result.domain}.`,
            `Source: ${result.account_label || 'compte IONOS configuré'}.`,
            ...lines,
            items.length ? '' : 'Aucun enregistrement DNS retourné pour cette zone.',
          ].filter(Boolean).join('\n');
          return res.json({ message, response: message, confirmation: null, inspection_only: true, ionos: result });
        }
        const result = await service.read(intent, intent === 'domains_list_domains' ? { offset: 0, limit: 100 } : {});
        const items = service.rows(result.data);
        const lines = items.slice(0, 100).map(item => {
          if (typeof item !== 'object' || !item) return `- ${String(item).slice(0, 180)}`;
          return `- ${String(item.name || item.zoneName || item.properties?.name || item.contract_name || item.id || 'Ressource').replace(/[\r\n]/g, ' ').slice(0, 180)}${item.id ? ` — ${item.id}` : ''}`;
        });
        const contracts = intent.includes('contracts');
        const message = [`Consultation IONOS vérifiée le ${result.checked_at}.`, result.notice || '', ...lines,
          items.length ? '' : 'Aucune ressource retournée pour cette consultation.',
          contracts ? 'Ouvrez Domaines → IONOS et sélectionnez un contrat pour consulter ses serveurs.' : 'Ouvrez Domaines → IONOS pour les détails et la suite des pages.',
          'Cette réponse correspond à la page consultée, pas nécessairement à tout le compte.'].filter(Boolean).join('\n');
        return res.json({ message, response: message, confirmation: null, inspection_only: true, ionos: result });
      } catch (error) {
        // Sans mention explicite d'IONOS, une zone absente doit laisser les
        // autres diagnostics DNS du Cockpit prendre la main au lieu d'inventer
        // une absence d'accès.
        if (error?.code === 'IONOS_ZONE_NOT_FOUND' && !/\bionos\b/i.test(String(req.body?.message || ''))) return next();
        return res.status(error.status || 502).json({ error: error.message, confirmation: null });
      }
    }));
  });
  return { router, chatRouter };
}
module.exports = { ...createRouters(), createRouters };
