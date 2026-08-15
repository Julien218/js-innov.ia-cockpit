const express = require('express');
const crypto = require('crypto');
const { requireSession } = require('./server-security.cjs');
const { postgresRest } = require('./server-postgres.cjs');
const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_CRM_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_CRM_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN || '';
const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY || '';
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET || '';
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN || '';
const DROPBOX_ROOT_PATH = String(process.env.DROPBOX_ROOT_PATH || '/Clients').replace(/\/$/, '');
const FFmpeg_PROFILE = { video_codec: 'h264', pixel_format: 'yuv420p', audio_codec: 'aac', container: 'mp4', faststart: true };
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
// 96 bits, uppercase hexadecimal only: secure while remaining practical to
// enter with an Android TV remote (no ambiguous upper/lower-case characters).
const token = () => crypto.randomBytes(12).toString('hex').toUpperCase();
const cleanDropboxSegment = value => String(value || '').replace(/[\\/:*?"<>|]/g, '-').trim();
const mediaRoot = req => DROPBOX_ROOT_PATH === '/Clients'
  ? `${DROPBOX_ROOT_PATH}/${cleanDropboxSegment(owner(req))}/Digital Signage/Medias`
  : `${DROPBOX_ROOT_PATH}/Medias`;

let dropboxTokenCache = { value: DROPBOX_ACCESS_TOKEN, expiresAt: DROPBOX_ACCESS_TOKEN ? Number.MAX_SAFE_INTEGER : 0 };

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function dropboxMessage(data, operation, status) {
  const detail = data && (
    data.error_description ||
    data.error_summary ||
    (typeof data.error === 'string' ? data.error : '')
  );
  if (/invalid_grant|expired_access_token|invalid_access_token/i.test(detail || '')) {
    return 'La connexion Dropbox du cockpit doit être renouvelée.';
  }
  return detail || `Dropbox a refusé ${operation} (HTTP ${status}).`;
}

async function dropboxJson(url, options, operation) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await fetch(url, options);
    } catch {
      if (attempt === 0) { await wait(300); continue; }
      throw new Error(`Dropbox est injoignable pendant ${operation}. Réessayez dans quelques secondes.`);
    }

    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();
    let data = null;
    if (raw && contentType.includes('application/json')) {
      try { data = JSON.parse(raw); } catch { data = null; }
    }

    if (data && response.ok) return data;
    if (data) throw new Error(dropboxMessage(data, operation, response.status));

    console.error(`[signage][dropbox] ${operation}: réponse non JSON (HTTP ${response.status}, ${contentType || 'type inconnu'})`);
    if (attempt === 0) { await wait(300); continue; }
    throw new Error(`Dropbox a renvoyé une réponse invalide pendant ${operation} (HTTP ${response.status}). Réessayez dans quelques secondes.`);
  }
  throw new Error(`Dropbox est indisponible pendant ${operation}.`);
}

async function getDropboxToken() {
  if (dropboxTokenCache.value && Date.now() < dropboxTokenCache.expiresAt - 60000) return dropboxTokenCache.value;
  if (!DROPBOX_APP_KEY || !DROPBOX_APP_SECRET || !DROPBOX_REFRESH_TOKEN) return '';
  const credentials = Buffer.from(`${DROPBOX_APP_KEY}:${DROPBOX_APP_SECRET}`).toString('base64');
  const data = await dropboxJson('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: DROPBOX_REFRESH_TOKEN })
  }, "l'authentification");
  if (!data.access_token) throw new Error('Dropbox n’a pas fourni de jeton d’accès.');
  dropboxTokenCache = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 14400) * 1000 };
  return dropboxTokenCache.value;
}

async function temporaryDropboxLink(path) {
  const accessToken = await getDropboxToken();
  if (!accessToken) return null;
  const data = await dropboxJson('https://api.dropboxapi.com/2/files/get_temporary_link', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  }, 'la création du lien de lecture');
  return data.link;
}

async function db(resource, options = {}) {
  if (process.env.DATABASE_URL) return postgresRest(resource, options);
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase runtime non configure');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, { ...options, headers: {
    apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {})
  }});
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 240)}`);
  return body ? JSON.parse(body) : null;
}
const owner = req => String(req.user.email).trim().toLowerCase();
const filterOwner = (req, path='') => `${path}${path.includes('?')?'&':'?'}owner_email=eq.${encodeURIComponent(owner(req))}`;

async function requireEntitlement(req, res, next) {
  try {
    if (req.user.role !== 'client') return next();
    const rows = await db(`client_module_entitlements?select=id&email=eq.${encodeURIComponent(owner(req))}&module_code=eq.digital_signage&enabled=eq.true&limit=1`);
    if (!rows?.length) return res.status(403).json({ error: 'Module Digital Signage non actif' });
    next();
  } catch (e) { res.status(503).json({ error: e.message }); }
}

router.use('/manage', requireSession('client'), requireEntitlement);
router.get('/manage/dashboard', async (req,res) => {
  try {
    const email = encodeURIComponent(owner(req));
    const [players,media,playlists,publications] = await Promise.all([
      db(`signage_players?select=id,name,resolution,status,last_seen_at,current_publication_id,app_version,diagnostics&owner_email=eq.${email}&order=created_at.asc`),
      db(`signage_media?select=*&owner_email=eq.${email}&order=created_at.desc`),
      db(`signage_playlists?select=*&owner_email=eq.${email}&order=created_at.desc`),
      db(`signage_publications?select=*&owner_email=eq.${email}&order=created_at.desc&limit=20`)
    ]);
    res.json({players,media,playlists,publications});
  } catch(e) { res.status(503).json({error:e.message}); }
});
router.post('/manage/players', async (req,res) => {
  try { const raw=token(); const rows=await db('signage_players',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_email:owner(req),name:String(req.body.name||'Player Olivier').slice(0,100),resolution:String(req.body.resolution||'1920x1080'),token_hash:hash(raw)})}); res.status(201).json({player:rows[0],enrollmentToken:raw}); }
  catch(e){res.status(400).json({error:e.message});}
});
router.post('/manage/players/:id/rotate-token', async (req,res) => {
  try {
    const playerId=encodeURIComponent(req.params.id);
    const rows=await db(filterOwner(req,`signage_players?select=id&id=eq.${playerId}&limit=1`));
    if(!rows?.[0]) return res.status(404).json({error:'Player introuvable'});
    const raw=token();
    await db(`signage_players?id=eq.${playerId}&owner_email=eq.${encodeURIComponent(owner(req))}`,{
      method:'PATCH',
      body:JSON.stringify({token_hash:hash(raw),status:'provisioning',last_seen_at:null,updated_at:new Date().toISOString()})
    });
    res.json({playerId:req.params.id,enrollmentToken:raw});
  } catch(e){res.status(400).json({error:e.message});}
});
router.post('/manage/media/upload-session', async (req,res) => {
  try {
    const accessToken = await getDropboxToken();
    if (!accessToken) return res.status(503).json({error:'Dropbox non configure'});
    const name=String(req.body.name||'').replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,180);
    if(!name) return res.status(400).json({error:'Nom requis'});
    const path=`${mediaRoot(req)}/${Date.now()}-${name}`;
    const data=await dropboxJson('https://content.dropboxapi.com/2/files/get_temporary_upload_link',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({commit_info:{path,mode:'add',autorename:true,mute:false},duration:14400})}, 'la préparation de l’envoi');
    res.json({uploadUrl:data.link,dropboxPath:path,expiresIn:14400});
  } catch(e){res.status(502).json({error:e.message});}
});
router.post('/manage/media', async (req,res) => {
  try { const p=req.body||{}; const rows=await db('signage_media',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_email:owner(req),name:String(p.name||'Media'),mime_type:String(p.mimeType||'application/octet-stream'),dropbox_path:String(p.dropboxPath||''),size_bytes:Number(p.sizeBytes||0)||null,checksum_sha256:p.checksumSha256||null,status:'uploaded',rendition:{profile:FFmpeg_PROFILE,state:'queued'}})}); res.status(201).json(rows[0]); }
  catch(e){res.status(400).json({error:e.message});}
});
router.get('/manage/media/:id/download', async (req,res) => {
  try {
    if (!await getDropboxToken()) return res.status(503).json({error:'Dropbox non configure'});
    const rows=await db(filterOwner(req,`signage_media?select=id,dropbox_path,status&id=eq.${encodeURIComponent(req.params.id)}&limit=1`));
    if(!rows?.[0]) return res.status(404).json({error:'Media introuvable'});
    res.json({url:await temporaryDropboxLink(rows[0].dropbox_path),expiresIn:14400});
  } catch(e){res.status(502).json({error:e.message});}
});
router.post('/manage/playlists', async (req,res) => {
  try { const rows=await db('signage_playlists',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_email:owner(req),name:String(req.body.name||'Playlist'),items:Array.isArray(req.body.items)?req.body.items:[]})}); res.status(201).json(rows[0]); }
  catch(e){res.status(400).json({error:e.message});}
});
router.post('/manage/publications', async (req,res) => {
  try {
    const email=owner(req), playerId=String(req.body.playerId||''), playlistId=String(req.body.playlistId||'');
    const [players,lists]=await Promise.all([db(`signage_players?select=*&id=eq.${encodeURIComponent(playerId)}&owner_email=eq.${encodeURIComponent(email)}&limit=1`),db(`signage_playlists?select=*&id=eq.${encodeURIComponent(playlistId)}&owner_email=eq.${encodeURIComponent(email)}&limit=1`)]);
    if(!players?.[0]||!lists?.[0]) return res.status(404).json({error:'Player ou playlist introuvable'});
    const manifest={version:1,revision:lists[0].revision,playlistId,items:lists[0].items,profile:FFmpeg_PROFILE,createdAt:new Date().toISOString()};
    const rows=await db('signage_publications',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_email:email,player_id:playerId,playlist_id:playlistId,status:'pending',manifest,previous_publication_id:players[0].current_publication_id})});
    res.status(201).json(rows[0]);
  } catch(e){res.status(400).json({error:e.message});}
});
router.post('/manage/publications/:id/rollback', async (req,res) => {
  try { const rows=await db(filterOwner(req,`signage_publications?select=*&id=eq.${encodeURIComponent(req.params.id)}`)); const pub=rows?.[0]; if(!pub?.previous_publication_id)return res.status(409).json({error:'Aucune version precedente'}); await db(`signage_players?id=eq.${encodeURIComponent(pub.player_id)}`,{method:'PATCH',body:JSON.stringify({current_publication_id:pub.previous_publication_id,status:'online',updated_at:new Date().toISOString()})}); await db(`signage_publications?id=eq.${encodeURIComponent(pub.id)}`,{method:'PATCH',body:JSON.stringify({status:'rolled_back',updated_at:new Date().toISOString()})}); res.json({success:true,publicationId:pub.previous_publication_id}); }
  catch(e){res.status(400).json({error:e.message});}
});

async function device(req, table) { const bearer=String(req.headers.authorization||'').replace(/^Bearer\s+/i,''); if(!bearer)return null; const rows=await db(`${table}?select=*&token_hash=eq.${hash(bearer)}&limit=1`); return rows?.[0]||null; }
router.post('/player/verify', async (req,res)=>{try{const p=await device(req,'signage_players');if(!p)return res.status(401).json({error:'Jeton Player refuse'});res.json({valid:true,playerId:p.id,name:p.name});}catch(e){res.status(503).json({error:e.message});}});
router.post('/player/heartbeat', async (req,res)=>{ try{const p=await device(req,'signage_players');if(!p)return res.status(401).json({error:'Player non autorise'});await db(`signage_players?id=eq.${p.id}`,{method:'PATCH',body:JSON.stringify({status:'online',last_seen_at:new Date().toISOString(),app_version:String(req.body.appVersion||''),diagnostics:req.body.diagnostics||{},updated_at:new Date().toISOString()})});const pubs=await db(`signage_publications?select=*&player_id=eq.${p.id}&status=eq.pending&order=created_at.desc&limit=1`);const publication=pubs?.[0]||null;if(publication&&await getDropboxToken()){const items=Array.isArray(publication.manifest?.items)?publication.manifest.items:[];const resolved=[];for(const item of items){const mediaId=String(item.mediaId||item.media_id||'');if(!mediaId){resolved.push(item);continue;}const media=await db(`signage_media?select=id,name,mime_type,dropbox_path,checksum_sha256,rendition&owner_email=eq.${encodeURIComponent(p.owner_email)}&id=eq.${encodeURIComponent(mediaId)}&limit=1`);if(!media?.[0])throw new Error(`Media ${mediaId} introuvable`);resolved.push({...item,media:{...media[0],url:await temporaryDropboxLink(media[0].dropbox_path),expiresIn:14400}});}publication.manifest={...publication.manifest,items:resolved};}res.json({playerId:p.id,publication,nextHeartbeatSeconds:30});}catch(e){res.status(503).json({error:e.message});}});
router.post('/player/publications/:id/ack', async(req,res)=>{try{const p=await device(req,'signage_players');if(!p)return res.status(401).json({error:'Player non autorise'});const ok=req.body.status==='active';await db(`signage_publications?id=eq.${encodeURIComponent(req.params.id)}&player_id=eq.${p.id}`,{method:'PATCH',body:JSON.stringify({status:ok?'active':'failed',acknowledged_at:new Date().toISOString(),error:ok?null:String(req.body.error||'Validation Player echouee'),updated_at:new Date().toISOString()})});if(ok)await db(`signage_players?id=eq.${p.id}`,{method:'PATCH',body:JSON.stringify({current_publication_id:req.params.id,status:'online',updated_at:new Date().toISOString()})});res.json({success:true});}catch(e){res.status(400).json({error:e.message});}});

router.post('/manage/camera-gateways', async(req,res)=>{try{const raw=token();const rows=await db('camera_gateways',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_email:owner(req),name:String(req.body.name||'Passerelle Olivier'),token_hash:hash(raw)})});res.status(201).json({gateway:rows[0],enrollmentToken:raw});}catch(e){res.status(400).json({error:e.message});}});
router.get('/manage/cameras', async(req,res)=>{try{const rows=await db(filterOwner(req,'cameras?select=id,gateway_id,name,model,enabled,created_at'));res.json({cameras:rows||[]});}catch(e){res.status(503).json({error:e.message});}});
router.post('/gateway/heartbeat', async(req,res)=>{try{const g=await device(req,'camera_gateways');if(!g)return res.status(401).json({error:'Passerelle non autorisee'});await db(`camera_gateways?id=eq.${g.id}`,{method:'PATCH',body:JSON.stringify({status:'online',last_seen_at:new Date().toISOString(),diagnostics:req.body.diagnostics||{},updated_at:new Date().toISOString()})});const cameras=await db(`cameras?select=id,name,model,local_stream_key,enabled&gateway_id=eq.${g.id}&enabled=eq.true`);res.json({gatewayId:g.id,cameras:cameras||[],nextHeartbeatSeconds:30});}catch(e){res.status(503).json({error:e.message});}});

module.exports=router;

