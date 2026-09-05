const express = require('express');

const router = express.Router();

const PROVIDERS = Object.freeze([
  { id: 'facebook', label: 'Facebook', group: 'meta', status: 'planned' },
  { id: 'instagram', label: 'Instagram', group: 'meta', status: 'planned' },
  { id: 'tiktok', label: 'TikTok', group: 'tiktok', status: 'planned' },
  { id: 'linkedin', label: 'LinkedIn', group: 'linkedin', status: 'planned' },
  { id: 'youtube', label: 'YouTube', group: 'google', status: 'planned' },
]);

const MODULE_VERSION = 'lot1-foundation';

function safeOrganisation(user) {
  return String(user?.organisation || '').trim() || null;
}

router.get('/status', (req, res) => {
  res.json({
    module: 'publisya',
    product_name: 'PUBLISYA',
    signature: 'Un contenu. Chaque réseau. Le bon message.',
    version: MODULE_VERSION,
    ready: true,
    publishing_enabled: false,
    human_approval_required: true,
    timezone: 'Europe/Brussels',
    organisation: safeOrganisation(req.user),
    providers: PROVIDERS,
    capabilities: {
      media_upload: false,
      ai_analysis: false,
      network_variants: false,
      approval_workflow: false,
      scheduling: false,
      direct_publish: false,
      analytics: false,
    },
  });
});

router.get('/dashboard', (_req, res) => {
  res.json({
    campaigns: {
      draft: 0,
      awaiting_approval: 0,
      scheduled: 0,
      publishing: 0,
      published: 0,
      failed: 0,
    },
    connections: {
      connected: 0,
      reconnect_required: 0,
      total_supported: PROVIDERS.length,
    },
    foundation_mode: true,
  });
});

function startPublisyaScheduler() {
  return {
    started: false,
    reason: 'Lot 1 : publication volontairement désactivée',
  };
}

module.exports = {
  router,
  PROVIDERS,
  MODULE_VERSION,
  startPublisyaScheduler,
};
