const express = require('express');
const {
  clean, arr, jsonValue, crm, organisation, one,
  loadBrandContext, brandPrompt, draftWithElynea, normalizeBrand
} = require('./server-campaigns-core.cjs');

const router = express.Router();
const MAX_IMAGE_BYTES = 14 * 1024 * 1024;

async function brandForCampaign(campaign, org) {
  return campaign && campaign.brand_id ? one('campaign_brands', campaign.brand_id, org) : null;
}
async function campaignForPost(post, org) {
  return post && post.campaign_id ? one('campaigns', post.campaign_id, org) : null;
}
function adnSnapshot(context, brand) {
  const bible = context?.bible || {};
  return {
    source: bible.source || 'canonical-registry',
    brand_id: bible.brand_id || context?.brand?.slug || brand?.slug || null,
    registry_version: bible.registry_version || null,
    repository: bible.repository || null,
    path: bible.manifest_path || null,
    ref: bible.ref || null,
    sha: bible.manifest_sha || null,
    brand_board_url: brand?.brand_board_url || null
  };
}

router.get('/brands', async function(req, res) {
  try {
    const rows = await crm('campaign_brands?organisation_id=eq.' + encodeURIComponent(organisation(req)) + '&order=name.asc');
    res.json({ brands: rows || [] });
  } catch (e) { res.status(503).json({ error: e.message }); }
});

router.post('/brands', async function(req, res) {
  try {
    const payload = normalizeBrand(req.body || {}, organisation(req));
    if (!payload.slug || !payload.name) return res.status(400).json({ error: 'Nom et slug de marque requis.' });
    payload.created_by = (req.user && (req.user.id || req.user.email)) || null;
    const rows = await crm('campaign_brands', {
      method: 'POST',
      headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify(payload)
    });
    res.status(201).json({ brand: rows && rows[0] || null });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch('/brands/:id', async function(req, res) {
  try {
    const org = organisation(req);
    const existing = await one('campaign_brands', req.params.id, org);
    if (!existing) return res.status(404).json({ error: 'Marque introuvable.' });
    const payload = normalizeBrand(Object.assign({}, existing, req.body), org);
    delete payload.organisation_id;
    const rows = await crm('campaign_brands?id=eq.' + encodeURIComponent(req.params.id) + '&organisation_id=eq.' + encodeURIComponent(org), {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload)
    });
    res.json({ brand: rows && rows[0] || null });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/brands/:id/context', async function(req, res) {
  try {
    const brand = await one('campaign_brands', req.params.id, organisation(req));
    if (!brand) return res.status(404).json({ error: 'Marque introuvable.' });
    res.json(await loadBrandContext(brand, null));
  } catch (e) { res.status(503).json({ error: e.message }); }
});

router.get('/', async function(req, res) {
  try {
    const filter = req.query.brand_id ? '&brand_id=eq.' + encodeURIComponent(req.query.brand_id) : '';
    const rows = await crm('campaigns?organisation_id=eq.' + encodeURIComponent(organisation(req)) + filter + '&order=created_at.desc');
    res.json({ campaigns: rows || [] });
  } catch (e) { res.status(503).json({ error: e.message }); }
});

router.post('/', async function(req, res) {
  try {
    const org = organisation(req);
    const brand = await one('campaign_brands', req.body && req.body.brand_id, org);
    if (!brand) return res.status(400).json({ error: 'Marque invalide.' });
    const row = {
      organisation_id: org,
      brand_id: brand.id,
      name: clean(req.body.name, 220),
      objective: clean(req.body.objective, 3000) || null,
      phase: clean(req.body.phase || 'preparation', 120),
      status: ['draft','active','paused','completed','archived'].includes(req.body.status) ? req.body.status : 'draft',
      start_date: req.body.start_date || null,
      end_date: req.body.end_date || null,
      cta: clean(req.body.cta, 500) || null,
      landing_url: clean(req.body.landing_url, 1000) || null,
      channels: arr(req.body.channels || ['facebook','instagram','tiktok'], 8),
      metadata: jsonValue(req.body.metadata, {}),
      created_by: (req.user && (req.user.id || req.user.email)) || null
    };
    if (!row.name) return res.status(400).json({ error: 'Nom de campagne requis.' });
    const rows = await crm('campaigns', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
    res.status(201).json({ campaign: rows && rows[0] || null });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch('/:id', async function(req, res) {
  try {
    const org = organisation(req);
    const existing = await one('campaigns', req.params.id, org);
    if (!existing) return res.status(404).json({ error: 'Campagne introuvable.' });
    const allowed = ['name','objective','phase','status','start_date','end_date','cta','landing_url','channels','metadata'];
    const patch = {};
    allowed.forEach(function(key) {
      if (req.body[key] === undefined) return;
      patch[key] = key === 'channels' ? arr(req.body[key], 8) : key === 'metadata' ? jsonValue(req.body[key], {}) : req.body[key];
    });
    patch.updated_at = new Date().toISOString();
    const rows = await crm('campaigns?id=eq.' + encodeURIComponent(req.params.id) + '&organisation_id=eq.' + encodeURIComponent(org), {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch)
    });
    res.json({ campaign: rows && rows[0] || null });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/:campaignId/posts', async function(req, res) {
  try {
    const org = organisation(req);
    const campaign = await one('campaigns', req.params.campaignId, org);
    if (!campaign) return res.status(404).json({ error: 'Campagne introuvable.' });
    const rows = await crm('campaign_posts?campaign_id=eq.' + encodeURIComponent(campaign.id) + '&organisation_id=eq.' + encodeURIComponent(org) + '&order=created_at.desc');
    res.json({ posts: rows || [] });
  } catch (e) { res.status(503).json({ error: e.message }); }
});

router.post('/:campaignId/posts', async function(req, res) {
  try {
    const org = organisation(req);
    const campaign = await one('campaigns', req.params.campaignId, org);
    if (!campaign) return res.status(404).json({ error: 'Campagne introuvable.' });
    const brand = await brandForCampaign(campaign, org);
    const context = await loadBrandContext(brand, campaign);
    const row = {
      organisation_id: org,
      campaign_id: campaign.id,
      title: clean(req.body.title || 'Nouveau contenu', 220),
      brief: clean(req.body.brief, 12000) || null,
      status: 'draft',
      platforms: arr(req.body.platforms || campaign.channels || ['facebook','instagram','tiktok'], 8),
      video_engine: ['auto','local','api'].includes(req.body.video_engine) ? req.body.video_engine : null,
      adn_source: adnSnapshot(context, brand),
      created_by: (req.user && (req.user.id || req.user.email)) || null
    };
    const rows = await crm('campaign_posts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
    res.status(201).json({ post: rows && rows[0] || null, context: context });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch('/posts/:id', async function(req, res) {
  try {
    const org = organisation(req);
    const post = await one('campaign_posts', req.params.id, org);
    if (!post) return res.status(404).json({ error: 'Contenu introuvable.' });
    const allowed = ['title','brief','status','platforms','copy','seo','hashtags','image_prompt','image_url','image_status','image_approved_at','video_prompt','video_engine','video_provider','video_job_id','video_status','video_url','video_approved_at','scheduled_at','published_at','analytics','metadata'];
    const patch = {};
    allowed.forEach(function(key) {
      if (req.body[key] === undefined) return;
      patch[key] = key === 'platforms' ? arr(req.body[key], 8) : ['copy','seo','hashtags','analytics','metadata'].includes(key) ? jsonValue(req.body[key], {}) : req.body[key];
    });
    patch.updated_at = new Date().toISOString();
    const rows = await crm('campaign_posts?id=eq.' + encodeURIComponent(post.id) + '&organisation_id=eq.' + encodeURIComponent(org), {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch)
    });
    res.json({ post: rows && rows[0] || null });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/posts/:id/draft', async function(req, res) {
  try {
    const org = organisation(req);
    const post = await one('campaign_posts', req.params.id, org);
    if (!post) return res.status(404).json({ error: 'Contenu introuvable.' });
    const campaign = await campaignForPost(post, org);
    const brand = await brandForCampaign(campaign, org);
    const context = await loadBrandContext(brand, campaign);
    const draft = await draftWithElynea(context, (req.body && req.body.brief) || post.brief || post.title, (req.body && req.body.platforms) || post.platforms);
    const patch = {
      title: draft.title, copy: draft.copy, seo: draft.seo, hashtags: draft.hashtags,
      image_prompt: draft.image_prompt, video_prompt: draft.video_prompt, status: 'prepared',
      updated_at: new Date().toISOString(),
      adn_source: adnSnapshot(context, brand)
    };
    const rows = await crm('campaign_posts?id=eq.' + encodeURIComponent(post.id) + '&organisation_id=eq.' + encodeURIComponent(org), {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch)
    });
    res.json({ post: rows && rows[0] || null, draft: draft, context: context });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/posts/:id/compile', async function(req, res) {
  try {
    const org = organisation(req);
    const post = await one('campaign_posts', req.params.id, org);
    if (!post) return res.status(404).json({ error: 'Contenu introuvable.' });
    const campaign = await campaignForPost(post, org);
    const brand = await brandForCampaign(campaign, org);
    const context = await loadBrandContext(brand, campaign);
    res.json({
      context: context,
      image_prompt: post.image_prompt || brandPrompt(context, post.brief || post.title, 'image'),
      video_prompt: post.video_prompt || brandPrompt(context, post.brief || post.title, 'video'),
      video_engine: post.video_engine || brand.video_engine || 'auto'
    });
  } catch (e) { res.status(503).json({ error: e.message }); }
});

router.post('/posts/:id/approve-image', async function(req, res) {
  try {
    const org = organisation(req);
    const post = await one('campaign_posts', req.params.id, org);
    if (!post) return res.status(404).json({ error: 'Contenu introuvable.' });
    if (!post.image_url || post.image_status !== 'review') return res.status(409).json({ error: 'Aucune image en attente de validation.' });
    const rows = await crm('campaign_posts?id=eq.' + encodeURIComponent(post.id) + '&organisation_id=eq.' + encodeURIComponent(org), {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ image_status: 'approved', status: 'image_approved', image_approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    });
    const updated = rows && rows[0];
    const campaign = await campaignForPost(updated, org);
    const brand = await brandForCampaign(campaign, org);
    const context = await loadBrandContext(brand, campaign);
    res.json({
      post: updated,
      orchestration: {
        video_engine: updated.video_engine || brand.video_engine || 'auto',
        api_provider: brand.api_provider || 'xai',
        fallback_to_api: brand.fallback_to_api === true,
        local_workflow_id: brand.local_workflow_id || '',
        video_prompt: updated.video_prompt || brandPrompt(context, updated.brief || updated.title, 'video')
      }
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

function allowedImageHost(host) {
  const configured = String(process.env.CAMPAIGN_MEDIA_HOSTS || '').split(',').map(function(v){ return v.trim(); }).filter(Boolean);
  const allowed = ['media.base44.com', 'imgen.x.ai'].concat(configured);
  return allowed.some(function(entry){ return host === entry || (entry.startsWith('*.') && host.endsWith(entry.slice(1))); });
}
async function postImage(req) {
  const post = await one('campaign_posts', req.params.id, organisation(req));
  if (!post || !post.image_url) {
    const err = new Error('Image de campagne absente.'); err.status = 404; throw err;
  }
  const url = new URL(post.image_url);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowedImageHost(url.hostname)) {
    const err = new Error('Hôte image non autorisé.'); err.status = 403; throw err;
  }
  const response = await fetch(url.href, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Téléchargement image impossible (' + response.status + ').');
  const type = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!['image/png','image/jpeg','image/webp'].includes(type)) throw new Error('Média distant non autorisé.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Image supérieure à 14 Mo.');
  return { buffer: buffer, type: type };
}
router.get('/posts/:id/image-file', async function(req, res) {
  try {
    const media = await postImage(req);
    res.set({ 'Content-Type': media.type, 'Content-Length': String(media.buffer.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(media.buffer);
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});
router.get('/posts/:id/image-data', async function(req, res) {
  try {
    const media = await postImage(req);
    res.json({ data_url: 'data:' + media.type + ';base64,' + media.buffer.toString('base64'), bytes: media.buffer.length, mime: media.type });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

module.exports = { router, allowedImageHost };
