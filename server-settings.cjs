const express = require('express');
const { AGENT_REGISTRY } = require('./server-agent-registry.cjs');
const { MANAGED_DOMAINS } = require('./server-domain-ops.cjs');

const router = express.Router();

function has(...names) {
  return names.every((name) => String(process.env[name] || '').trim().length > 0);
}

function oneOf(...names) {
  return names.some((name) => String(process.env[name] || '').trim().length > 0);
}

function integration(variable, service, configured, description, required = false) {
  return { variable, service, configured: Boolean(configured), description, required, server_side_only: true };
}

function settingsStatus(user = {}) {
  const integrations = [
    integration('OPENAI_API_KEY', 'OpenAI', has('OPENAI_API_KEY'), 'NOVA et fonctions IA principales', true),
    integration('XAI_API_KEY', 'xAI / Grok', has('XAI_API_KEY'), 'Génération vidéo et image'),
    integration('AGENT_API_KEY', 'Railway Agent', oneOf('JSINNOVIA_AGENT_KEY', 'AGENT_API_KEY'), 'Backend agent JS-Innov.IA', true),
    integration('SUPABASE_URL', 'Supabase Cockpit', has('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'), 'Données principales et authentification', true),
    integration('SUPABASE_CRM_URL', 'Supabase CRM', has('SUPABASE_CRM_URL', 'SUPABASE_CRM_KEY'), 'Données CRM séparées'),
    integration('DROPBOX_REFRESH_TOKEN', 'Dropbox', has('DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'DROPBOX_REFRESH_TOKEN'), 'Documents et mémoire historique'),
    integration('IONOS_API_KEY', 'IONOS DNS', has('IONOS_API_KEY'), 'Gestion DNS confirmée des domaines autorisés'),
    integration('GOOGLE_CLIENT_ID', 'Google Gmail OAuth', oneOf('GOOGLE_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID'), 'Identifiant OAuth pour connecter plusieurs boîtes Gmail ou Google Workspace'),
    integration('GOOGLE_CLIENT_SECRET', 'Google Gmail OAuth', oneOf('GOOGLE_CLIENT_SECRET', 'GOOGLE_OAUTH_CLIENT_SECRET'), 'Secret OAuth conservé uniquement côté serveur'),
    integration('GOOGLE_MAIL_ENCRYPTION_KEY', 'Google Gmail OAuth', has('GOOGLE_MAIL_ENCRYPTION_KEY'), 'Chiffrement local des jetons de renouvellement Google'),
    integration('TWILIO_AUTH_TOKEN', 'Twilio', has('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'), 'Téléphonie et coûts'),
    integration('EMAIL_PASSWORD', 'IONOS Mail', has('EMAIL_JSINNOVIA_ADDRESS', 'EMAIL_PASSWORD'), 'Messagerie JS-Innov.IA'),
    integration('VAPID_PRIVATE_KEY', 'Notifications Push', has('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'), 'Notifications de l’application'),
    integration('GITHUB_TOKEN', 'GitHub', oneOf('GITHUB_TOKEN', 'GH_TOKEN'), 'Écriture directe depuis le Cockpit'),
    integration('RAILWAY_API_TOKEN', 'Railway', oneOf('RAILWAY_API_TOKEN', 'RAILWAY_TOKEN'), 'Déploiement direct depuis le Cockpit'),
  ];

  return {
    checked_at: new Date().toISOString(),
    agents: AGENT_REGISTRY.map((agent) => ({
      key: agent.key,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      domains: agent.domains || [],
      provider: agent.provider || 'NOVA interne',
    })),
    builder: {
      inline_editor: false,
      nova_site_ops: true,
      github_write: oneOf('GITHUB_TOKEN', 'GH_TOKEN'),
      railway_write: oneOf('RAILWAY_API_TOKEN', 'RAILWAY_TOKEN'),
      sites: Object.entries(MANAGED_DOMAINS).map(([domain, meta]) => ({
        domain,
        url: meta.primary_url || `https://${domain}`,
        repository: meta.repository || null,
        repository_url: meta.repository ? `https://github.com/${meta.repository}` : null,
        hosting: meta.hosting || null,
        agent: meta.agent_hint || null,
      })),
    },
    integrations,
    data_engines: [
      { name: 'Supabase Cockpit', configured: has('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'), purpose: 'Données, sessions et journaux du Cockpit' },
      { name: 'Supabase CRM', configured: has('SUPABASE_CRM_URL', 'SUPABASE_CRM_KEY'), purpose: 'Clients, projets et facturation' },
      { name: 'Backend Agent Railway', configured: oneOf('JSINNOVIA_AGENT_KEY', 'AGENT_API_KEY'), purpose: 'Relais métier et automatisations' },
      { name: 'Dropbox', configured: has('DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'DROPBOX_REFRESH_TOKEN'), purpose: 'Documents et mémoire historique' },
    ],
    notifications: {
      push_server: has('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'),
      service_worker: true,
      email: has('EMAIL_JSINNOVIA_ADDRESS', 'EMAIL_PASSWORD'),
    },
    security: {
      authenticated: Boolean(user?.id),
      role: user?.role || null,
      permissions_server_side: true,
      secrets_server_side: true,
      dns_confirmation_required: true,
      tenant_isolation: true,
    },
  };
}

router.get('/status', (req, res) => res.json(settingsStatus(req.user)));

module.exports = router;
module.exports.settingsStatus = settingsStatus;
