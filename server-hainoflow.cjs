const express = require('express');
const router = express.Router();

const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';

function tenantFor(user) {
  return String(user?.organisation || 'jsinnovia').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

async function list(entity, tenant) {
  const url = new URL(`/data/${entity}`, AGENT_URL);
  url.searchParams.set('organisation_id', tenant);
  url.searchParams.set('limit', '500');
  const response = await fetch(url, {
    headers: { 'x-agent-key': AGENT_KEY, 'x-organisation-id': tenant },
  });
  if (!response.ok) throw new Error(`${entity}: HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

router.get('/summary', async (req, res) => {
  try {
    if (!AGENT_KEY) return res.status(503).json({ error: 'Connexion HainoFlow non configurée.' });
    const tenant = tenantFor(req.user);
    const [clients, quotes, invoices] = await Promise.all([
      list('Client', tenant), list('Devis', tenant), list('Facture', tenant),
    ]);
    const paid = invoices.filter((invoice) => invoice.statut === 'payee');
    const overdue = invoices.filter((invoice) => invoice.statut === 'en_retard');
    const turnover = paid.reduce((sum, invoice) => sum + Number(invoice.montant_ttc || 0), 0);
    const incompleteClients = clients.filter((client) => client.facturation_statut !== 'verifie').length;
    return res.json({
      success: true,
      product: 'HainoFlow by JS-Innov.IA',
      organisation: tenant,
      scope: tenant === 'jsinnovia' ? 'interne' : 'client',
      metrics: {
        clients: clients.length,
        devis: quotes.length,
        factures: invoices.length,
        impayees: overdue.length,
        chiffreAffairesTtc: Math.round(turnover * 100) / 100,
        clientsACompleter: incompleteClients,
      },
      modules: {
        clients: 'active', devis: 'active', factures: 'active', pdfDropbox: 'active',
        suiviEnvois: 'active', paiements: 'preparation', peppol: 'preparation',
        relances: 'preparation', comptable: 'preparation',
      },
    });
  } catch (error) {
    console.error('[HainoFlow summary]', error.message);
    return res.status(502).json({ error: 'HainoFlow est momentanément indisponible.', details: error.message });
  }
});

module.exports = router;

