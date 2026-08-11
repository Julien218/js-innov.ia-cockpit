const express = require('express');
const crypto = require('crypto');
const { requireSession } = require('./server-security.cjs');

const router = express.Router();
router.use(express.urlencoded({ extended: false }));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const SOCIAL_TEXT_MODEL = process.env.SOCIAL_TEXT_MODEL || 'gpt-5.6-terra';
const RESEARCH_WEBHOOK_URL = process.env.SOCIAL_RESEARCH_WEBHOOK_URL || '';
const RESEARCH_WEBHOOK_KEY = process.env.SOCIAL_RESEARCH_WEBHOOK_KEY || '';
const VIDEO_WEBHOOK_URL = process.env.SOCIAL_VIDEO_GENERATOR_URL || '';
const VIDEO_WEBHOOK_KEY = process.env.SOCIAL_VIDEO_GENERATOR_KEY || '';
const PUBLISHER_WEBHOOK_URL = process.env.SOCIAL_PUBLISHER_URL || '';
const PUBLISHER_WEBHOOK_KEY = process.env.SOCIAL_PUBLISHER_KEY || '';
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const DEFAULT_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || '';
const COCKPIT_URL = process.env.COCKPIT_URL || 'https://cockpit.jsinnovia.com';

function assertServerConfig() {
  if (!SUPABASE_URL || !SUPABASE_SECRET) throw new Error('Supabase serveur non configure');
}

function sbHeaders(extra = {}) {
  assertServerConfig();
  return {
    apikey: SUPABASE_SECRET,
    Authorization: `Bearer ${SUPABASE_SECRET}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function sb(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: sbHeaders(options.headers || {}),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.error || `Supabase ${response.status}`);
  return data;
}

async function selectOne(table, id) {
  const rows = await sb(`${table}?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows?.[0] || null;
}

async function patchOne(table, id, values) {
  const rows = await sb(`${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(values),
  });
  return rows?.[0] || null;
}

async function insertOne(table, values) {
  const rows = await sb(table, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(values),
  });
  return rows?.[0] || null;
}

function cleanText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function cleanArray(value, max = 20) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map(v => typeof v === 'string' ? cleanText(v, 1000) : v);
}

function randomApprovalCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function normalizePhone(value) {
  const raw = cleanText(value, 40).replace(/^whatsapp:/i, '');
  if (!raw) return '';
  return `whatsapp:${raw}`;
}

function parseApprovalCommand(body) {
  const raw = cleanText(body, 1000);
  const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const codeMatch = normalized.match(/\b([A-F0-9]{8})\b/);
  const code = codeMatch?.[1] || null;
  if (/\b(VALIDER|VALIDE|APPROUVER|APPROUVE|OK)\b/.test(normalized)) return { action: 'approved', code, note: raw };
  if (/\b(REFUSER|REFUSE|REJETER|REJETE)\b/.test(normalized)) return { action: 'rejected', code, note: raw };
  if (/\b(MODIFIER|MODIF|CORRIGER|CHANGE|CHANGER)\b/.test(normalized)) return { action: 'changes_requested', code, note: raw };
  return { action: null, code, note: raw };
}

function buildApprovalMessage(profile, item) {
  const planned = item.scheduled_for ? new Date(item.scheduled_for).toLocaleString('fr-BE', { timeZone: profile.timezone || 'Europe/Brussels' }) : 'non planifie';
  return [
    `🎬 ${profile.display_name} — contenu a valider`,
    item.editorial_series ? `Rubrique : ${item.editorial_series}` : null,
    `Sujet : ${item.topic}`,
    `Publication : ${planned}`,
    '',
    item.caption ? `Texte :\n${item.caption}` : null,
    '',
    `Code : ${item.approval_code}`,
    `Repondre : VALIDER ${item.approval_code}`,
    `ou MODIFIER ${item.approval_code} + votre remarque`,
    `ou REFUSER ${item.approval_code}`,
  ].filter(Boolean).join('\n');
}

async function logApproval(contentId, profileId, eventType, values = {}) {
  return insertOne('social_approval_events', {
    content_id: contentId,
    profile_id: profileId,
    event_type: eventType,
    actor: values.actor || null,
    channel: values.channel || 'whatsapp',
    external_message_id: values.externalMessageId || null,
    note: values.note || null,
    payload: values.payload || {},
  });
}

async function researchTopic(profile, item) {
  if (!RESEARCH_WEBHOOK_URL) return { source_urls: item.source_urls || [], notes: 'Recherche externe non configuree' };
  const response = await fetch(RESEARCH_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: RESEARCH_WEBHOOK_KEY ? `Bearer ${RESEARCH_WEBHOOK_KEY}` : '' },
    body: JSON.stringify({
      client_id: profile.client_id,
      profile_slug: profile.slug,
      locale: profile.locale,
      topic: item.topic,
      editorial_series: item.editorial_series,
      existing_sources: item.source_urls || [],
      rule: 'Retourner uniquement des faits sourcables et les URL des sources. Ne jamais inventer.',
    }),
  });
  if (!response.ok) throw new Error(`Recherche externe ${response.status}`);
  return response.json();
}

function extractOpenAIText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const parts = [];
  for (const output of data?.output || []) {
    for (const content of output?.content || []) {
      if (content?.type === 'output_text' && content?.text) parts.push(content.text);
    }
  }
  return parts.join('\n');
}

async function generateEditorialPackage(profile, item, research) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY non configuree');
  const prompt = `Tu es l'agent editorial de ${profile.display_name}.\n\nPROFIL CLIENT\nVertical: ${profile.vertical}\nLocale: ${profile.locale}\nVoix de marque: ${JSON.stringify(profile.brand_voice)}\nADN visuel: ${JSON.stringify(profile.visual_dna)}\nRegles editoriales: ${JSON.stringify(profile.editorial_rules)}\nCanaux: ${JSON.stringify(profile.channels)}\n\nCONTENU\nRubrique: ${item.editorial_series || 'libre'}\nSujet: ${item.topic}\nRecherche/source: ${JSON.stringify(research)}\n\nGenere un package editorial professionnel en JSON strict avec: script, caption, hashtags (tableau), storyboard (tableau d'objets scene/visual/voiceover/duration_seconds), source_urls (tableau), quality_checks (tableau). Ne fabrique aucun fait. Si une information historique ou factuelle n'est pas suffisamment sourcee, signale-la dans quality_checks et ne la presente pas comme certaine. Le contenu doit etre directement exploitable pour une video sociale courte.`;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SOCIAL_TEXT_MODEL,
      input: prompt,
      text: { format: { type: 'json_object' } },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI ${response.status}`);
  const text = extractOpenAIText(data);
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('Le modele n a pas retourne un JSON exploitable'); }
  return { package: parsed, usage: data.usage || {}, model: data.model || SOCIAL_TEXT_MODEL };
}

async function requestVideo(profile, item, editorialPackage) {
  if (!VIDEO_WEBHOOK_URL) return { media_url: null, status: 'not_configured' };
  const response = await fetch(VIDEO_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: VIDEO_WEBHOOK_KEY ? `Bearer ${VIDEO_WEBHOOK_KEY}` : '' },
    body: JSON.stringify({
      client_id: profile.client_id,
      profile_slug: profile.slug,
      content_id: item.id,
      visual_dna: profile.visual_dna,
      script: editorialPackage.script,
      storyboard: editorialPackage.storyboard,
      channels: profile.channels,
      callback_url: `${COCKPIT_URL}/api/social-agent/video-callback`,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Generateur video ${response.status}`);
  return data;
}

async function sendWhatsApp(profile, item) {
  if (!TWILIO_SID || !TWILIO_TOKEN) throw new Error('Twilio WhatsApp non configure');
  const to = normalizePhone(profile.approver_phone);
  const from = normalizePhone(profile.whatsapp_from || DEFAULT_WHATSAPP_FROM);
  if (!to || !from) throw new Error('Numero WhatsApp approbateur/emetteur manquant');
  const params = new URLSearchParams();
  params.set('To', to);
  params.set('From', from);
  params.set('Body', buildApprovalMessage(profile, item));
  if (item.media_url) params.set('MediaUrl', item.media_url);
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.message || `Twilio ${response.status}`);
  return data;
}

function verifyTwilioSignature(req) {
  if (!TWILIO_TOKEN) return false;
  const signature = req.get('x-twilio-signature') || '';
  if (!signature) return false;
  const url = `${COCKPIT_URL}${req.originalUrl}`;
  const keys = Object.keys(req.body || {}).sort();
  let payload = url;
  for (const key of keys) payload += key + String(req.body[key] ?? '');
  const expected = crypto.createHmac('sha1', TWILIO_TOKEN).update(payload).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch { return false; }
}

async function publishItem(profile, item) {
  const channels = Array.isArray(profile.channels) ? profile.channels : [];
  if (!channels.length) throw new Error('Aucun reseau configure pour ce client');
  if (!PUBLISHER_WEBHOOK_URL) throw new Error('SOCIAL_PUBLISHER_URL non configure');

  const results = [];
  for (const channel of channels) {
    const channelName = typeof channel === 'string' ? channel : channel.name;
    if (!channelName) continue;
    const event = await insertOne('social_publication_events', {
      content_id: item.id, profile_id: profile.id, channel: channelName, status: 'publishing',
    });
    try {
      const response = await fetch(PUBLISHER_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: PUBLISHER_WEBHOOK_KEY ? `Bearer ${PUBLISHER_WEBHOOK_KEY}` : '' },
        body: JSON.stringify({
          client_id: profile.client_id,
          profile_slug: profile.slug,
          channel,
          content_id: item.id,
          caption: item.caption,
          hashtags: item.hashtags,
          media_url: item.media_url,
          scheduled_for: item.scheduled_for,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Publisher ${response.status}`);
      await patchOne('social_publication_events', event.id, {
        status: 'published', external_post_id: data.external_post_id || null,
        external_url: data.external_url || null, response_payload: data, published_at: new Date().toISOString(),
      });
      results.push({ channel: channelName, ok: true, ...data });
    } catch (error) {
      await patchOne('social_publication_events', event.id, { status: 'failed', error_message: error.message });
      results.push({ channel: channelName, ok: false, error: error.message });
    }
  }
  const allOk = results.length > 0 && results.every(r => r.ok);
  await patchOne('social_content_items', item.id, {
    status: allOk ? 'published' : 'failed', published_at: allOk ? new Date().toISOString() : null,
    failure_reason: allOk ? null : results.filter(r => !r.ok).map(r => `${r.channel}: ${r.error}`).join('; '),
  });
  return results;
}

router.get('/profiles', requireSession('admin'), async (req, res) => {
  try {
    const client = cleanText(req.query.client_id, 120);
    const filter = client ? `&client_id=eq.${encodeURIComponent(client)}` : '';
    const rows = await sb(`social_agent_profiles?select=*&order=created_at.desc${filter}`);
    res.json({ profiles: rows || [] });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/profiles', requireSession('admin'), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.client_id || !body.slug || !body.display_name) return res.status(400).json({ error: 'client_id, slug et display_name requis' });
    const row = await insertOne('social_agent_profiles', {
      client_id: cleanText(body.client_id, 120), slug: cleanText(body.slug, 120).toLowerCase(), display_name: cleanText(body.display_name, 200),
      vertical: cleanText(body.vertical || 'general', 100), locale: cleanText(body.locale || 'fr-BE', 20), timezone: cleanText(body.timezone || 'Europe/Brussels', 80),
      brand_voice: body.brand_voice || {}, visual_dna: body.visual_dna || {}, editorial_rules: body.editorial_rules || {}, weekly_schedule: body.weekly_schedule || {},
      channels: cleanArray(body.channels, 10), approver_name: cleanText(body.approver_name, 200) || null, approver_phone: cleanText(body.approver_phone, 40) || null,
      whatsapp_from: cleanText(body.whatsapp_from, 40) || null, require_human_approval: body.require_human_approval !== false,
      auto_publish_after_approval: body.auto_publish_after_approval !== false, enabled: body.enabled !== false,
    });
    res.status(201).json({ profile: row });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.patch('/profiles/:id', requireSession('admin'), async (req, res) => {
  try {
    const allowed = ['display_name','vertical','locale','timezone','brand_voice','visual_dna','editorial_rules','weekly_schedule','channels','approver_name','approver_phone','whatsapp_from','require_human_approval','auto_publish_after_approval','enabled','metadata'];
    const patch = {};
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) patch[key] = req.body[key];
    const row = await patchOne('social_agent_profiles', req.params.id, patch);
    res.json({ profile: row });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/items', requireSession('admin'), async (req, res) => {
  try {
    const profileId = cleanText(req.query.profile_id, 100);
    const filter = profileId ? `&profile_id=eq.${encodeURIComponent(profileId)}` : '';
    const rows = await sb(`social_content_items?select=*&order=created_at.desc&limit=100${filter}`);
    res.json({ items: rows || [] });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/items', requireSession('admin'), async (req, res) => {
  try {
    const profile = await selectOne('social_agent_profiles', req.body?.profile_id);
    if (!profile) return res.status(404).json({ error: 'Profil agent introuvable' });
    const topic = cleanText(req.body?.topic, 500);
    if (!topic) return res.status(400).json({ error: 'Sujet requis' });
    const row = await insertOne('social_content_items', {
      profile_id: profile.id, client_id: profile.client_id, topic,
      editorial_series: cleanText(req.body?.editorial_series, 250) || null,
      scheduled_for: req.body?.scheduled_for || null,
      source_urls: cleanArray(req.body?.source_urls, 20), status: 'draft', approval_code: randomApprovalCode(),
    });
    res.status(201).json({ item: row });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/items/:id/generate', requireSession('admin'), async (req, res) => {
  try {
    let item = await selectOne('social_content_items', req.params.id);
    if (!item) return res.status(404).json({ error: 'Contenu introuvable' });
    const profile = await selectOne('social_agent_profiles', item.profile_id);
    if (!profile?.enabled) return res.status(409).json({ error: 'Profil agent desactive' });
    await patchOne('social_content_items', item.id, { status: 'research', failure_reason: null });
    const research = await researchTopic(profile, item);
    await patchOne('social_content_items', item.id, { status: 'generating', research });
    const generated = await generateEditorialPackage(profile, item, research);
    const pkg = generated.package || {};
    item = await patchOne('social_content_items', item.id, {
      script: cleanText(pkg.script, 15000), caption: cleanText(pkg.caption, 10000), hashtags: cleanArray(pkg.hashtags, 50), storyboard: Array.isArray(pkg.storyboard) ? pkg.storyboard.slice(0, 30) : [],
      source_urls: cleanArray(pkg.source_urls?.length ? pkg.source_urls : research.source_urls, 30), generation_provider: 'openai', generation_model: generated.model,
      metadata: { ...(item.metadata || {}), quality_checks: pkg.quality_checks || [], openai_usage: generated.usage || {} }, status: 'review',
    });
    const video = await requestVideo(profile, item, pkg);
    if (video.media_url) item = await patchOne('social_content_items', item.id, { media_url: video.media_url, thumbnail_url: video.thumbnail_url || null });
    res.json({ item, video });
  } catch (error) {
    try { await patchOne('social_content_items', req.params.id, { status: 'failed', failure_reason: error.message }); } catch {}
    res.status(500).json({ error: error.message });
  }
});

router.post('/items/:id/send-approval', requireSession('admin'), async (req, res) => {
  try {
    let item = await selectOne('social_content_items', req.params.id);
    if (!item) return res.status(404).json({ error: 'Contenu introuvable' });
    const profile = await selectOne('social_agent_profiles', item.profile_id);
    if (!profile) return res.status(404).json({ error: 'Profil introuvable' });
    if (!item.approval_code) item = await patchOne('social_content_items', item.id, { approval_code: randomApprovalCode() });
    const message = await sendWhatsApp(profile, item);
    item = await patchOne('social_content_items', item.id, { status: 'pending_approval' });
    await logApproval(item.id, profile.id, 'sent', { actor: req.user.email, externalMessageId: message.sid, payload: { to: message.to, status: message.status } });
    res.json({ item, message_sid: message.sid });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/items/:id/approve', requireSession('admin'), async (req, res) => {
  try {
    let item = await selectOne('social_content_items', req.params.id);
    if (!item) return res.status(404).json({ error: 'Contenu introuvable' });
    const profile = await selectOne('social_agent_profiles', item.profile_id);
    item = await patchOne('social_content_items', item.id, { status: 'approved', approved_by: req.user.email, approved_at: new Date().toISOString(), approved_version: item.version });
    await logApproval(item.id, profile.id, 'approved', { actor: req.user.email, channel: 'cockpit', note: cleanText(req.body?.note, 1000) });
    const publications = profile.auto_publish_after_approval ? await publishItem(profile, item) : [];
    res.json({ item: await selectOne('social_content_items', item.id), publications });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/whatsapp/webhook', async (req, res) => {
  try {
    if (!verifyTwilioSignature(req)) return res.status(403).send('Invalid signature');
    const command = parseApprovalCommand(req.body?.Body);
    if (!command.action || !command.code) return res.type('text/xml').send('<Response></Response>');
    const rows = await sb(`social_content_items?select=*&approval_code=eq.${encodeURIComponent(command.code)}&limit=1`);
    let item = rows?.[0];
    if (!item) return res.type('text/xml').send('<Response><Message>Code de validation introuvable.</Message></Response>');
    const profile = await selectOne('social_agent_profiles', item.profile_id);
    const sender = cleanText(req.body?.From, 80);
    const expected = normalizePhone(profile.approver_phone);
    if (expected && sender.toLowerCase() !== expected.toLowerCase()) return res.status(403).send('Approver mismatch');
    const now = new Date().toISOString();
    if (command.action === 'approved') {
      item = await patchOne('social_content_items', item.id, { status: 'approved', approved_by: profile.approver_name || sender, approved_at: now, approved_version: item.version });
      await logApproval(item.id, profile.id, 'approved', { actor: profile.approver_name || sender, note: command.note, payload: req.body });
      if (profile.auto_publish_after_approval) await publishItem(profile, item);
    } else if (command.action === 'changes_requested') {
      item = await patchOne('social_content_items', item.id, { status: 'changes_requested', version: Number(item.version || 1) + 1, metadata: { ...(item.metadata || {}), requested_changes: command.note } });
      await logApproval(item.id, profile.id, 'changes_requested', { actor: profile.approver_name || sender, note: command.note, payload: req.body });
    } else {
      item = await patchOne('social_content_items', item.id, { status: 'rejected' });
      await logApproval(item.id, profile.id, 'rejected', { actor: profile.approver_name || sender, note: command.note, payload: req.body });
    }
    res.type('text/xml').send(`<Response><Message>Demande ${command.action === 'approved' ? 'validee' : command.action === 'changes_requested' ? 'a modifier' : 'refusee'} (${command.code}).</Message></Response>`);
  } catch (error) {
    console.error('[social-agent] WhatsApp webhook:', error.message);
    res.status(500).type('text/xml').send('<Response></Response>');
  }
});

router.post('/video-callback', async (req, res) => {
  try {
    const key = req.get('x-social-callback-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!VIDEO_WEBHOOK_KEY || key !== VIDEO_WEBHOOK_KEY) return res.status(403).json({ error: 'Callback non autorise' });
    const item = await selectOne('social_content_items', req.body?.content_id);
    if (!item) return res.status(404).json({ error: 'Contenu introuvable' });
    const updated = await patchOne('social_content_items', item.id, { media_url: cleanText(req.body?.media_url, 2000) || item.media_url, thumbnail_url: cleanText(req.body?.thumbnail_url, 2000) || item.thumbnail_url, status: 'review' });
    res.json({ item: updated });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/dashboard', requireSession('admin'), async (req, res) => {
  try {
    const [profiles, items, publications] = await Promise.all([
      sb('social_agent_profiles?select=id,enabled'),
      sb('social_content_items?select=id,status,generation_cost_usd,created_at&order=created_at.desc&limit=500'),
      sb('social_publication_events?select=id,status,channel,created_at&order=created_at.desc&limit=500'),
    ]);
    const counts = {};
    for (const item of items || []) counts[item.status] = (counts[item.status] || 0) + 1;
    res.json({
      active_profiles: (profiles || []).filter(p => p.enabled).length,
      content_total: (items || []).length,
      status_counts: counts,
      publications_total: (publications || []).filter(p => p.status === 'published').length,
      failed_publications: (publications || []).filter(p => p.status === 'failed').length,
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = {
  router,
  _test: { parseApprovalCommand, buildApprovalMessage, normalizePhone, randomApprovalCode },
};
