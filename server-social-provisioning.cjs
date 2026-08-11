const express = require('express');
const crypto = require('crypto');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PROVISIONING_KEY = process.env.SOCIAL_PROVISIONING_KEY || '';

const TEMPLATES = {
  'local-media': {
    vertical: 'local-media',
    brand_voice: { tone: ['humain', 'local', 'curieux', 'accessible'], avoid: ['publicité commerciale déguisée', 'faits non sourcés'] },
    editorial_rules: { require_sources_for_facts: true, human_approval_required: true, max_video_seconds: 60 },
    weekly_schedule: {
      tuesday: { series: "Dour, c’est toute une histoire ! Le saviez-vous ?", format: 'fact-story' },
      wednesday: { series: 'LA RUÉE VERS DOUR', hook: 'Vous connaissez la rue… mais connaissez-vous son histoire ?', format: 'street-history' },
    },
    channels: ['facebook', 'instagram', 'tiktok', 'youtube'],
  },
  retail: {
    vertical: 'retail',
    brand_voice: { tone: ['visuel', 'direct', 'chaleureux'], avoid: ['promesses trompeuses'] },
    editorial_rules: { human_approval_required: true, max_video_seconds: 30 },
    weekly_schedule: { monday: { series: 'Nouveauté de la semaine' }, friday: { series: 'Coup de cœur' } },
    channels: ['facebook', 'instagram', 'tiktok'],
  },
  restaurant: {
    vertical: 'restaurant',
    brand_voice: { tone: ['appétissant', 'convivial', 'local'], avoid: ['allégations santé'] },
    editorial_rules: { human_approval_required: true, max_video_seconds: 30 },
    weekly_schedule: { tuesday: { series: 'Dans les coulisses' }, thursday: { series: 'À la carte cette semaine' } },
    channels: ['facebook', 'instagram', 'tiktok'],
  },
  'professional-services': {
    vertical: 'professional-services',
    brand_voice: { tone: ['expert', 'pédagogique', 'humain'], avoid: ['garanties de résultat'] },
    editorial_rules: { human_approval_required: true, max_video_seconds: 60 },
    weekly_schedule: { tuesday: { series: 'Le conseil de la semaine' }, friday: { series: 'Question client' } },
    channels: ['facebook', 'instagram', 'linkedin'],
  },
  regulated: {
    vertical: 'regulated',
    brand_voice: { tone: ['clair', 'prudent', 'pédagogique'], avoid: ['conseil individualisé automatique', 'promesse de rendement', 'information non vérifiée'] },
    editorial_rules: { require_sources_for_facts: true, compliance_review: true, human_approval_required: true, max_video_seconds: 60 },
    weekly_schedule: { wednesday: { series: 'Comprendre en 60 secondes' }, friday: { series: 'Le point pratique' } },
    channels: ['facebook', 'instagram', 'linkedin'],
  },
  association: {
    vertical: 'association',
    brand_voice: { tone: ['collectif', 'positif', 'accessible'], avoid: ['politisation non validée'] },
    editorial_rules: { human_approval_required: true, max_video_seconds: 45 },
    weekly_schedule: { monday: { series: 'Cette semaine' }, thursday: { series: 'Portrait / initiative' } },
    channels: ['facebook', 'instagram'],
  },
};

function constantTimeEqual(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function authorize(req, res, next) {
  const supplied = req.get('x-social-provision-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!PROVISIONING_KEY || !constantTimeEqual(supplied, PROVISIONING_KEY)) {
    return res.status(403).json({ error: 'Provisionnement non autorisé' });
  }
  next();
}

function clean(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function slugify(value) {
  return clean(value, 120)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

async function insertProfile(profile) {
  if (!SUPABASE_URL || !SUPABASE_SECRET) throw new Error('Supabase serveur non configuré');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_agent_profiles`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SECRET,
      Authorization: `Bearer ${SUPABASE_SECRET}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(profile),
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data?.message || `Supabase ${response.status}`);
  return data?.[0];
}

router.get('/templates', (req, res) => {
  res.json({
    templates: Object.entries(TEMPLATES).map(([id, t]) => ({
      id,
      vertical: t.vertical,
      channels: t.channels,
      human_approval_required: true,
    })),
  });
});

router.post('/', authorize, async (req, res) => {
  try {
    const templateId = clean(req.body?.template_id || 'professional-services', 80);
    const template = TEMPLATES[templateId];
    if (!template) return res.status(400).json({ error: 'Profil client non supporté', allowed_templates: Object.keys(TEMPLATES) });

    const displayName = clean(req.body?.display_name, 200);
    const clientId = clean(req.body?.client_id || req.body?.customer_id, 120);
    if (!displayName || !clientId) return res.status(400).json({ error: 'display_name et client_id requis' });

    const requestedChannels = Array.isArray(req.body?.channels)
      ? req.body.channels.map(v => clean(v, 40)).filter(Boolean)
      : template.channels;
    const allowedChannels = new Set(['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin']);
    const channels = requestedChannels.filter(v => allowedChannels.has(v));

    const profile = await insertProfile({
      client_id: clientId,
      slug: slugify(req.body?.slug || `${clientId}-${displayName}`),
      display_name: displayName,
      vertical: template.vertical,
      locale: clean(req.body?.locale || 'fr-BE', 20),
      timezone: clean(req.body?.timezone || 'Europe/Brussels', 80),
      brand_voice: { ...template.brand_voice, ...(req.body?.brand_voice || {}) },
      visual_dna: req.body?.visual_dna || {},
      editorial_rules: { ...template.editorial_rules, ...(req.body?.editorial_rules || {}) },
      weekly_schedule: req.body?.weekly_schedule || template.weekly_schedule,
      channels,
      approver_name: clean(req.body?.approver_name, 200) || null,
      approver_phone: clean(req.body?.approver_phone, 40) || null,
      approval_channel: 'whatsapp',
      require_human_approval: true,
      auto_publish_after_approval: req.body?.auto_publish_after_approval !== false,
      enabled: req.body?.enabled !== false,
      metadata: {
        provisioned_from: clean(req.body?.source || 'website', 80),
        order_id: clean(req.body?.order_id, 160) || null,
        plan_key: clean(req.body?.plan_key, 120) || null,
        provisioned_at: new Date().toISOString(),
      },
    });

    res.status(201).json({ success: true, profile });
  } catch (error) {
    console.error('[social-provision] failed:', error.message);
    res.status(500).json({ error: 'Provisionnement impossible', details: error.message });
  }
});

module.exports = { router, TEMPLATES, _test: { slugify, constantTimeEqual } };
