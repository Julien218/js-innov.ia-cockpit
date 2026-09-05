const express = require('express');
const { resolveTenant } = require('./server-tenant.cjs');

const router = express.Router();
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLATFORM_SET = new Set(['facebook', 'instagram', 'tiktok', 'linkedin', 'youtube']);

function textField(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function context(req) {
  const tenantId = resolveTenant(req);
  return {
    tenantId,
    clientId: tenantId,
    actor: String(req.user?.id || req.user?.email || 'unknown').slice(0, 200),
  };
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_SECRET) throw new Error('Clé serveur Supabase non configurée.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET,
      Authorization: `Bearer ${SUPABASE_SECRET}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`Supabase ${response.status}: ${body.slice(0, 220)}`);
    error.status = response.status;
    throw error;
  }
  return body ? JSON.parse(body) : [];
}

async function campaignFor(req, campaignId) {
  if (!UUID_RE.test(String(campaignId || ''))) return null;
  const { tenantId, clientId } = context(req);
  const rows = await supabaseRequest(
    `publisya_campaigns?select=*&id=eq.${encodeURIComponent(campaignId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}&limit=1`,
  );
  return rows[0] || null;
}

async function variantsFor(req, campaignId) {
  const { tenantId, clientId } = context(req);
  return supabaseRequest(
    `publisya_post_variants?select=*&campaign_id=eq.${encodeURIComponent(campaignId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}&order=platform.asc,version.desc`,
  );
}

async function variantFor(req, campaignId, variantId) {
  if (!UUID_RE.test(String(variantId || ''))) return null;
  const { tenantId, clientId } = context(req);
  const rows = await supabaseRequest(
    `publisya_post_variants?select=*&id=eq.${encodeURIComponent(variantId)}&campaign_id=eq.${encodeURIComponent(campaignId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}&limit=1`,
  );
  return rows[0] || null;
}

function latestByPlatform(rows, targetPlatforms) {
  const result = new Map();
  for (const row of rows || []) {
    if (!PLATFORM_SET.has(row.platform) || !targetPlatforms.includes(row.platform)) continue;
    const current = result.get(row.platform);
    if (!current || Number(row.version || 0) > Number(current.version || 0)) result.set(row.platform, row);
  }
  return result;
}

function editPatch(variant, body, actor) {
  if (variant.platform === 'youtube') {
    return {
      title: textField(body?.title, 200),
      description: textField(body?.description, 5000),
      tags: Array.isArray(body?.tags) ? body.tags.map((item) => textField(item, 80)).filter(Boolean).slice(0, 20) : variant.tags || [],
      cover_text: textField(body?.cover_text, 120),
      status: 'generated',
      last_edited_by: actor,
    };
  }
  const providerOptions = variant.platform === 'tiktok'
    ? { ...(variant.provider_options || {}), hook: textField(body?.hook ?? variant.provider_options?.hook, 240) }
    : (variant.provider_options || {});
  return {
    caption: textField(body?.caption, 5000),
    hashtags: Array.isArray(body?.hashtags) ? body.hashtags.map((item) => textField(item, 100)).filter(Boolean).slice(0, 20) : variant.hashtags || [],
    call_to_action: textField(body?.call_to_action, 500),
    alt_text: textField(body?.alt_text, 1000),
    cover_text: textField(body?.cover_text, 240),
    provider_options: providerOptions,
    status: 'generated',
    last_edited_by: actor,
  };
}

router.patch('/campaigns/:campaignId/variants/:variantId', async (req, res) => {
  const { campaignId, variantId } = req.params;
  if (!UUID_RE.test(String(campaignId || '')) || !UUID_RE.test(String(variantId || ''))) {
    return res.status(400).json({ error: 'Identifiant invalide.' });
  }
  try {
    const campaign = await campaignFor(req, campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campagne introuvable.' });
    if (!['awaiting_approval', 'needs_changes'].includes(campaign.status)) {
      return res.status(409).json({ error: 'Cette campagne n’est pas modifiable dans son état actuel.' });
    }
    const variant = await variantFor(req, campaignId, variantId);
    if (!variant) return res.status(404).json({ error: 'Version réseau introuvable.' });

    const { tenantId, clientId, actor } = context(req);
    const rows = await supabaseRequest(
      `publisya_post_variants?id=eq.${encodeURIComponent(variantId)}&campaign_id=eq.${encodeURIComponent(campaignId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(editPatch(variant, req.body || {}, actor)),
      },
    );
    res.json({ variant: rows[0] });
  } catch (error) {
    console.error('[publisya-review] edit:', error.message);
    res.status(500).json({ error: 'Impossible d’enregistrer cette correction.' });
  }
});

router.post('/campaigns/:campaignId/request-changes', async (req, res) => {
  const campaignId = String(req.params.campaignId || '');
  if (!UUID_RE.test(campaignId)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const comment = textField(req.body?.comment, 2000);
  try {
    const campaign = await campaignFor(req, campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campagne introuvable.' });
    if (!['awaiting_approval', 'needs_changes'].includes(campaign.status)) {
      return res.status(409).json({ error: 'Cette campagne n’attend pas de correction.' });
    }
    const { tenantId, clientId, actor } = context(req);
    await supabaseRequest('publisya_approvals', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        tenant_id: tenantId,
        client_id: clientId,
        campaign_id: campaignId,
        post_variant_id: null,
        action: 'changes_requested',
        comment: comment || 'Corrections demandées',
        variant_snapshot: {},
        acted_by: actor,
      }),
    });
    const rows = await supabaseRequest(
      `publisya_campaigns?id=eq.${encodeURIComponent(campaignId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'needs_changes' }) },
    );
    res.json({ campaign: rows[0] });
  } catch (error) {
    console.error('[publisya-review] request changes:', error.message);
    res.status(500).json({ error: 'Impossible d’enregistrer la demande de correction.' });
  }
});

router.post('/campaigns/:campaignId/approve', async (req, res) => {
  const campaignId = String(req.params.campaignId || '');
  if (!UUID_RE.test(campaignId)) return res.status(400).json({ error: 'Identifiant invalide.' });
  try {
    const campaign = await campaignFor(req, campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campagne introuvable.' });
    if (!['awaiting_approval', 'needs_changes'].includes(campaign.status)) {
      return res.status(409).json({ error: 'Cette campagne n’est pas en attente de validation.' });
    }

    const targets = Array.isArray(campaign.target_platforms)
      ? [...new Set(campaign.target_platforms.map((item) => String(item).toLowerCase()).filter((item) => PLATFORM_SET.has(item)))]
      : [];
    const latest = latestByPlatform(await variantsFor(req, campaignId), targets);
    if (targets.length === 0 || latest.size !== targets.length) {
      return res.status(409).json({ error: 'Toutes les versions réseau doivent exister avant validation.' });
    }

    const { tenantId, clientId, actor } = context(req);
    const approvedAt = new Date().toISOString();
    const approvedVariants = [];
    for (const platform of targets) {
      const variant = latest.get(platform);
      const rows = await supabaseRequest(
        `publisya_post_variants?id=eq.${encodeURIComponent(variant.id)}&campaign_id=eq.${encodeURIComponent(campaignId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ status: 'approved', approved_at: approvedAt, approved_by: actor }),
        },
      );
      approvedVariants.push(rows[0] || variant);
    }

    await supabaseRequest('publisya_approvals', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(approvedVariants.map((variant) => ({
        tenant_id: tenantId,
        client_id: clientId,
        campaign_id: campaignId,
        post_variant_id: variant.id,
        action: 'approved',
        comment: textField(req.body?.comment, 2000) || null,
        variant_snapshot: variant,
        acted_by: actor,
        acted_at: approvedAt,
      }))),
    });

    const campaigns = await supabaseRequest(
      `publisya_campaigns?id=eq.${encodeURIComponent(campaignId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'approved', approved_at: approvedAt, approved_by: actor }),
      },
    );
    res.json({ campaign: campaigns[0], variants: approvedVariants, publishing_enabled: false });
  } catch (error) {
    console.error('[publisya-review] approve:', error.message);
    res.status(500).json({ error: 'Impossible de valider cette campagne.' });
  }
});

module.exports = router;
