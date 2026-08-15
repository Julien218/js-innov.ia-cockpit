const express = require('express');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
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
const MAX_MEDIA_BYTES = 150 * 1024 * 1024;
const MAX_CAMERA_SNAPSHOT_BYTES = 3 * 1024 * 1024;
const MAX_CAMERA_RECORDING_BYTES = 150 * 1024 * 1024;
const FFmpeg_PROFILE = { video_codec: 'h264', pixel_format: 'yuv420p', audio_codec: 'aac', container: 'mp4', faststart: true };
const hash = value => crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
// 96 bits, uppercase hexadecimal only: secure while remaining practical to
// enter with an Android TV remote (no ambiguous upper/lower-case characters).
const token = () => crypto.randomBytes(12).toString('hex').toUpperCase();
const cleanDropboxSegment = value => String(value || '').replace(/[\\/:*?"<>|]/g, '-').trim();
const mediaRoot = req => DROPBOX_ROOT_PATH === '/Clients'
  ? `${DROPBOX_ROOT_PATH}/${cleanDropboxSegment(owner(req))}/Digital Signage/Medias`
  : `${DROPBOX_ROOT_PATH}/Medias`;
const cameraRecordingRoot = ownerEmail => DROPBOX_ROOT_PATH === '/Clients'
  ? `${DROPBOX_ROOT_PATH}/${cleanDropboxSegment(ownerEmail)}/Videosurveillance/Enregistrements`
  : `${DROPBOX_ROOT_PATH}/Videosurveillance/Enregistrements`;

let dropboxTokenCache = { value: DROPBOX_ACCESS_TOKEN, expiresAt: DROPBOX_ACCESS_TOKEN ? Number.MAX_SAFE_INTEGER : 0 };
const cameraSnapshots = new Map();

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const isVideo = (name, mimeType) => String(mimeType || '').startsWith('video/') || /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(String(name || ''));

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('La conversion video a depasse 4 minutes.'));
    }, 240000);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.once('error', error => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg indisponible: ${error.message}`));
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`Conversion video impossible (FFmpeg ${code}): ${stderr.slice(-1200)}`));
    });
  });
}

async function preparePlayerMedia(input, name, mimeType) {
  if (!isVideo(name, mimeType)) {
    return {
      body: input,
      name,
      mimeType,
      rendition: { profile: FFmpeg_PROFILE, state: 'ready', transcoded: false }
    };
  }

  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'pixelium-signage-'));
  const source = path.join(work, 'source.bin');
  const output = path.join(work, 'player.mp4');
  try {
    await fs.writeFile(source, input);
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', source,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1',
      '-r', '30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-profile:v', 'main', '-level:v', '4.1', '-pix_fmt', 'yuv420p',
      '-maxrate', '8M', '-bufsize', '16M', '-g', '60',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart',
      output
    ]);
    const body = await fs.readFile(output);
    const base = String(name || 'media').replace(/\.[^.]+$/, '');
    return {
      body,
      name: `${base}-player.mp4`,
      mimeType: 'video/mp4',
      rendition: {
        profile: FFmpeg_PROFILE,
        state: 'ready',
        transcoded: true,
        sourceBytes: input.length,
        outputBytes: body.length,
        resolution: '1920x1080',
        frameRate: 30
      }
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

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

async function dropboxJson(url, options, operation, maxAttempts = 2) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, options);
    } catch {
      if (attempt + 1 < maxAttempts) { await wait(300); continue; }
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
    if (attempt + 1 < maxAttempts) { await wait(300); continue; }
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

async function deleteDropboxPath(dropboxPath) {
  const accessToken = await getDropboxToken();
  if (!accessToken || !dropboxPath) return false;
  await dropboxJson('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dropboxPath })
  }, 'la suppression du fichier', 1);
  return true;
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
const sessionOwner = req => String(req.user.email).trim().toLowerCase();
const owner = req => String(req.signageOwner || sessionOwner(req)).trim().toLowerCase();
const filterOwner = (req, path='') => `${path}${path.includes('?')?'&':'?'}owner_email=eq.${encodeURIComponent(owner(req))}`;
const actor = req => String(req.user?.email || 'device').trim().toLowerCase();

async function audit(req, action, entityType, entityId, details = {}) {
  await db('signage_audit_events', {
    method: 'POST',
    body: JSON.stringify({ owner_email: owner(req), actor_email: actor(req), action, entity_type: entityType, entity_id: entityId || null, details })
  }).catch(error => console.error('[signage][audit]', error.message));
}

function normalizeRecurrence(input) {
  const type = String(input?.type || 'none');
  if (!['none', 'daily', 'weekly'].includes(type)) throw new Error('Récurrence invalide');
  return { type };
}

function nextScheduledAt(current, recurrence) {
  const date = new Date(current || Date.now());
  if (!Number.isFinite(date.getTime()) || recurrence?.type === 'none') return null;
  date.setUTCDate(date.getUTCDate() + (recurrence.type === 'weekly' ? 7 : 1));
  return date.toISOString();
}

async function cleanupExpiredRecordings(ownerEmail) {
  const rows=await db(`camera_recordings?select=id,dropbox_path,expires_at&owner_email=eq.${encodeURIComponent(ownerEmail)}&limit=500`);
  const expired=(rows||[]).filter(row=>new Date(row.expires_at).getTime()<=Date.now());
  for(const row of expired){
    await deleteDropboxPath(row.dropbox_path).catch(error=>console.error('[signage][retention]',error.message));
    await db(`camera_recordings?id=eq.${encodeURIComponent(row.id)}&owner_email=eq.${encodeURIComponent(ownerEmail)}`,{method:'DELETE'});
  }
  return expired.length;
}

async function requireEntitlement(req, res, next) {
  try {
    if (req.user.role !== 'client') return next();
    const rows = await db(`client_module_entitlements?select=id&email=eq.${encodeURIComponent(owner(req))}&module_code=eq.digital_signage&enabled=eq.true&limit=1`);
    if (!rows?.length) return res.status(403).json({ error: 'Module Digital Signage non actif' });
    next();
  } catch (e) { res.status(503).json({ error: e.message }); }
}

async function requireCameraEntitlement(req, res, next) {
  try {
    if (req.user.role !== 'client') return next();
    const rows = await db(`client_module_entitlements?select=id&email=eq.${encodeURIComponent(owner(req))}&module_code=eq.videosurveillance&enabled=eq.true&limit=1`);
    if (!rows?.length) return res.status(403).json({ error: 'Module Vidéosurveillance non actif' });
    next();
  } catch (e) { res.status(503).json({ error: e.message }); }
}

async function resolveManagedOwner(req, res, next) {
  try {
    req.signageOwner = sessionOwner(req);
    if (!['admin', 'superadmin'].includes(req.user.role)) return next();
    const requested = String(req.headers['x-client-email'] || '').trim().toLowerCase();
    if (!requested) return next();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requested)) return res.status(400).json({ error: 'Client sélectionné invalide' });
    const cameraRequest=/camera|recording/.test(req.path);
    const moduleCode=cameraRequest?'videosurveillance':'digital_signage';
    const rows = await db(`client_module_entitlements?select=id&email=eq.${encodeURIComponent(requested)}&module_code=eq.${moduleCode}&enabled=eq.true&limit=1`);
    if (!rows?.length) return res.status(403).json({ error: cameraRequest ? 'Ce client ne possède pas le module Vidéosurveillance' : 'Ce client ne possède pas le module Digital Signage' });
    req.signageOwner = requested;
    next();
  } catch (e) { res.status(503).json({ error: e.message }); }
}

router.use('/manage', requireSession('client'), requireEntitlement, resolveManagedOwner);
router.get('/manage/clients', requireSession('admin'), async (req, res) => {
  try {
    const moduleCode = String(req.query.module || 'digital_signage');
    if (!['digital_signage', 'videosurveillance'].includes(moduleCode)) return res.status(400).json({ error: 'Module invalide' });
    const entitlements = await db(`client_module_entitlements?select=email,updated_at&module_code=eq.${moduleCode}&enabled=eq.true&order=email.asc`);
    const orders = await db('commerce_orders?select=email,company&order=created_at.desc&limit=500');
    const companyByEmail = new Map((orders || []).map(row => [String(row.email || '').toLowerCase(), row.company]));
    const seen = new Set();
    const clients = (entitlements || []).filter(row => {
      const email = String(row.email || '').toLowerCase();
      if (!email || seen.has(email)) return false;
      seen.add(email);
      return true;
    }).map(row => ({
      email: String(row.email).toLowerCase(),
      name: companyByEmail.get(String(row.email).toLowerCase()) || String(row.email).toLowerCase(),
    }));
    res.json({ clients });
  } catch (e) { res.status(503).json({ error: e.message }); }
});
router.get('/manage/dashboard', async (req,res) => {
  try {
    const email = encodeURIComponent(owner(req));
    const [players,media,playlists,publications,auditEvents] = await Promise.all([
      db(`signage_players?select=id,name,resolution,status,last_seen_at,current_publication_id,app_version,diagnostics&owner_email=eq.${email}&order=created_at.asc`),
      db(`signage_media?select=*&owner_email=eq.${email}&order=created_at.desc`),
      db(`signage_playlists?select=*&owner_email=eq.${email}&order=created_at.desc`),
      db(`signage_publications?select=*&owner_email=eq.${email}&order=created_at.desc&limit=20`),
      db(`signage_audit_events?select=*&owner_email=eq.${email}&order=created_at.desc&limit=30`)
    ]);
    res.json({players,media,playlists,publications,auditEvents});
  } catch(e) { res.status(503).json({error:e.message}); }
});
router.post('/manage/players', async (req,res) => {
  try { const raw=token(); const rows=await db('signage_players',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_email:owner(req),name:String(req.body.name||'Player Olivier').slice(0,100),resolution:String(req.body.resolution||'1920x1080'),token_hash:hash(raw)})}); await audit(req,'player.created','player',rows[0]?.id,{}); res.status(201).json({player:rows[0],enrollmentToken:raw}); }
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
    await audit(req,'player.token_rotated','player',req.params.id,{});
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
    const data=await dropboxJson('https://api.dropboxapi.com/2/files/get_temporary_upload_link',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({commit_info:{path,mode:'add',autorename:true,mute:false},duration:14400})}, 'la préparation de l’envoi');
    res.json({uploadUrl:data.link,dropboxPath:path,expiresIn:14400});
  } catch(e){res.status(502).json({error:e.message});}
});
const mediaBody = express.raw({type:'application/octet-stream',limit:MAX_MEDIA_BYTES});
router.post('/manage/media/upload', (req,res,next) => mediaBody(req,res,error => {
  if (!error) return next();
  if (error.type === 'entity.too.large') return res.status(413).json({error:'Le média dépasse la limite de 150 Mo.'});
  return res.status(400).json({error:'Le fichier envoyé est illisible.'});
}), async (req,res) => {
  try {
    const accessToken = await getDropboxToken();
    if (!accessToken) return res.status(503).json({error:'Dropbox non configuré'});
    const name=String(req.query.name||'').replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,180);
    if(!name) return res.status(400).json({error:'Nom requis'});
    if(!Buffer.isBuffer(req.body)||!req.body.length) return res.status(400).json({error:'Fichier vide ou illisible'});
    const sourceMimeType=String(req.headers['x-media-content-type']||'application/octet-stream').slice(0,120);
    const prepared=await preparePlayerMedia(req.body,name,sourceMimeType);
    const finalName=cleanDropboxSegment(prepared.name);
    const dropboxPath=`${mediaRoot(req)}/${Date.now()}-${finalName}`;
    await dropboxJson('https://content.dropboxapi.com/2/files/upload',{
      method:'POST',
      headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/octet-stream','Dropbox-API-Arg':JSON.stringify({path:dropboxPath,mode:'add',autorename:true,mute:false,strict_conflict:false})},
      body:prepared.body
    }, 'l’envoi du fichier', 1);
    const rows=await db('signage_media',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_email:owner(req),name:finalName,mime_type:prepared.mimeType,dropbox_path:dropboxPath,size_bytes:prepared.body.length,checksum_sha256:hash(prepared.body),status:'ready',rendition:prepared.rendition})});
    await audit(req,'media.ready','media',rows[0]?.id,{name:finalName,sizeBytes:prepared.body.length,transcoded:prepared.rendition.transcoded});
    res.status(201).json({media:rows[0]});
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
  try {
    const items=Array.isArray(req.body.items)?req.body.items:[];
    if(!items.length) return res.status(400).json({error:'La playlist doit contenir au moins un média'});
    const rows=await db('signage_playlists',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_email:owner(req),name:String(req.body.name||'Playlist').slice(0,120),items})});
    await audit(req,'playlist.created','playlist',rows[0]?.id,{itemCount:items.length});
    res.status(201).json(rows[0]);
  }
  catch(e){res.status(400).json({error:e.message});}
});
router.patch('/manage/playlists/:id', async (req,res) => {
  try {
    const playlistId=encodeURIComponent(req.params.id);
    const current=await db(filterOwner(req,`signage_playlists?select=*&id=eq.${playlistId}&limit=1`));
    if(!current?.[0]) return res.status(404).json({error:'Playlist introuvable'});
    const items=Array.isArray(req.body.items)?req.body.items:current[0].items;
    if(!items.length) return res.status(400).json({error:'La playlist doit contenir au moins un média'});
    const rows=await db(`signage_playlists?id=eq.${playlistId}&owner_email=eq.${encodeURIComponent(owner(req))}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({name:String(req.body.name||current[0].name).slice(0,120),items,revision:Number(current[0].revision||1)+1,updated_at:new Date().toISOString()})});
    await audit(req,'playlist.updated','playlist',req.params.id,{itemCount:items.length});
    res.json(rows[0]);
  } catch(e){res.status(400).json({error:e.message});}
});
router.post('/manage/publications', async (req,res) => {
  try {
    const email=owner(req), playerId=String(req.body.playerId||''), playlistId=String(req.body.playlistId||'');
    const recurrence=normalizeRecurrence(req.body.recurrence);
    const scheduledAt=new Date(req.body.scheduledAt||Date.now());
    if(!Number.isFinite(scheduledAt.getTime())) return res.status(400).json({error:'Date de diffusion invalide'});
    if(scheduledAt.getTime()<Date.now()-60000) return res.status(400).json({error:'La diffusion ne peut pas être programmée dans le passé'});
    const [players,lists]=await Promise.all([db(`signage_players?select=*&owner_email=eq.${encodeURIComponent(email)}`),db(`signage_playlists?select=*&id=eq.${encodeURIComponent(playlistId)}&owner_email=eq.${encodeURIComponent(email)}&limit=1`)]);
    const requestedPlayer=players?.find(player=>player.id===playerId);
    const recentPlayers=(players||[])
      .filter(player=>player.status==='online'&&player.last_seen_at&&Date.now()-new Date(player.last_seen_at).getTime()<120000)
      .sort((a,b)=>new Date(b.last_seen_at).getTime()-new Date(a.last_seen_at).getTime());
    const targetPlayer=recentPlayers[0]||requestedPlayer;
    if(!targetPlayer||!lists?.[0]) return res.status(404).json({error:'Player ou playlist introuvable'});
    const playlistItems=Array.isArray(lists[0].items)?lists[0].items:[];
    for (const item of playlistItems) {
      const mediaId=String(item.mediaId||item.media_id||'');
      const rows=mediaId?await db(`signage_media?select=id,status,rendition&id=eq.${encodeURIComponent(mediaId)}&owner_email=eq.${encodeURIComponent(email)}&limit=1`):[];
      if(!rows?.[0]) return res.status(409).json({error:'Un media de la playlist est introuvable.'});
      if(rows[0].status!=='ready'||rows[0].rendition?.state!=='ready') return res.status(409).json({error:'Le media doit etre converti pour le Player avant sa diffusion.'});
    }
    const manifest={version:1,revision:lists[0].revision,playlistId,items:lists[0].items,profile:FFmpeg_PROFILE,createdAt:new Date().toISOString()};
    const rows=await db('signage_publications',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_email:email,player_id:targetPlayer.id,playlist_id:playlistId,status:'pending',manifest,previous_publication_id:targetPlayer.current_publication_id,scheduled_at:scheduledAt.toISOString(),recurrence})});
    await audit(req,'publication.scheduled','publication',rows[0]?.id,{scheduledAt:scheduledAt.toISOString(),recurrence:recurrence.type,playlistId});
    res.status(201).json(rows[0]);
  } catch(e){res.status(400).json({error:e.message});}
});
router.post('/manage/publications/:id/rollback', async (req,res) => {
  try { const rows=await db(filterOwner(req,`signage_publications?select=*&id=eq.${encodeURIComponent(req.params.id)}`)); const pub=rows?.[0]; if(!pub?.previous_publication_id)return res.status(409).json({error:'Aucune version precedente'}); const now=new Date().toISOString(); await db(`signage_players?id=eq.${encodeURIComponent(pub.player_id)}`,{method:'PATCH',body:JSON.stringify({current_publication_id:pub.previous_publication_id,status:'online',updated_at:now})}); await db(`signage_publications?id=eq.${encodeURIComponent(pub.id)}`,{method:'PATCH',body:JSON.stringify({status:'rolled_back',rolled_back_at:now,updated_at:now})}); await audit(req,'publication.rolled_back','publication',pub.id,{publicationId:pub.previous_publication_id}); res.json({success:true,publicationId:pub.previous_publication_id}); }
  catch(e){res.status(400).json({error:e.message});}
});

async function device(req, table) { const bearer=String(req.headers.authorization||'').replace(/^Bearer\s+/i,''); if(!bearer)return null; const rows=await db(`${table}?select=*&token_hash=eq.${hash(bearer)}&limit=1`); return rows?.[0]||null; }
router.post('/player/verify', async (req,res)=>{try{const p=await device(req,'signage_players');if(!p)return res.status(401).json({error:'Jeton Player refuse'});res.json({valid:true,playerId:p.id,name:p.name});}catch(e){res.status(503).json({error:e.message});}});
router.post('/player/heartbeat', async (req,res) => {
  try {
    const p=await device(req,'signage_players');
    if(!p) return res.status(401).json({error:'Player non autorise'});
    const now=new Date().toISOString();
    await db(`signage_players?id=eq.${p.id}`,{method:'PATCH',body:JSON.stringify({status:'online',last_seen_at:now,app_version:String(req.body.appVersion||''),diagnostics:req.body.diagnostics||{},updated_at:now})});
    const pending=await db(`signage_publications?select=*&player_id=eq.${p.id}&status=eq.pending&order=scheduled_at.desc&limit=50`);
    const publication=(pending||[]).filter(item=>new Date(item.scheduled_at||item.created_at).getTime()<=Date.now()).sort((a,b)=>new Date(b.scheduled_at||b.created_at)-new Date(a.scheduled_at||a.created_at))[0]||null;
    if(publication&&await getDropboxToken()){
      const items=Array.isArray(publication.manifest?.items)?publication.manifest.items:[];
      const resolved=[];
      for(const item of items){
        const mediaId=String(item.mediaId||item.media_id||'');
        if(!mediaId){resolved.push(item);continue;}
        const media=await db(`signage_media?select=id,name,mime_type,dropbox_path,checksum_sha256,rendition&owner_email=eq.${encodeURIComponent(p.owner_email)}&id=eq.${encodeURIComponent(mediaId)}&limit=1`);
        if(!media?.[0]) throw new Error(`Media ${mediaId} introuvable`);
        resolved.push({...item,media:{...media[0],url:await temporaryDropboxLink(media[0].dropbox_path),expiresIn:14400}});
      }
      publication.manifest={...publication.manifest,items:resolved};
    }
    res.json({playerId:p.id,publication,nextHeartbeatSeconds:30});
  } catch(e){res.status(503).json({error:e.message});}
});
router.post('/player/publications/:id/ack', async(req,res)=>{
  try{
    const p=await device(req,'signage_players');
    if(!p)return res.status(401).json({error:'Player non autorise'});
    const publications=await db(`signage_publications?select=*&id=eq.${encodeURIComponent(req.params.id)}&player_id=eq.${p.id}&limit=1`);
    const publication=publications?.[0];
    if(!publication) return res.status(404).json({error:'Publication introuvable'});
    const ok=req.body.status==='active', now=new Date().toISOString();
    await db(`signage_publications?id=eq.${encodeURIComponent(publication.id)}&player_id=eq.${p.id}`,{method:'PATCH',body:JSON.stringify({status:ok?'active':'failed',acknowledged_at:now,error:ok?null:String(req.body.error||'Validation Player echouee'),rolled_back_at:ok?null:now,updated_at:now})});
    if(ok){
      await db(`signage_players?id=eq.${p.id}`,{method:'PATCH',body:JSON.stringify({current_publication_id:publication.id,status:'online',updated_at:now})});
      const next=nextScheduledAt(publication.scheduled_at,publication.recurrence);
      if(next) await db('signage_publications',{method:'POST',body:JSON.stringify({owner_email:p.owner_email,player_id:p.id,playlist_id:publication.playlist_id,status:'pending',manifest:publication.manifest,previous_publication_id:publication.id,scheduled_at:next,recurrence:publication.recurrence})});
    } else if(publication.previous_publication_id) {
      await db(`signage_players?id=eq.${p.id}`,{method:'PATCH',body:JSON.stringify({current_publication_id:publication.previous_publication_id,status:'online',updated_at:now})});
    }
    res.json({success:true,rolledBack:!ok&&Boolean(publication.previous_publication_id)});
  }catch(e){res.status(400).json({error:e.message});}
});

router.get('/manage/camera-dashboard', requireCameraEntitlement, async(req,res)=>{
  try{
    const email=encodeURIComponent(owner(req));
    await cleanupExpiredRecordings(owner(req));
    const [gateways,cameras,recordings]=await Promise.all([
      db(`camera_gateways?select=id,name,status,last_seen_at,app_version,diagnostics,created_at&owner_email=eq.${email}&order=created_at.desc`),
      db(`cameras?select=id,gateway_id,name,model,enabled,status,last_seen_at,snapshot_at,retention_days,created_at&owner_email=eq.${email}&order=created_at.asc`),
      db(`camera_recordings?select=*&owner_email=eq.${email}&order=created_at.desc&limit=50`)
    ]);
    res.json({gateways:gateways||[],cameras:cameras||[],recordings:recordings||[]});
  }catch(e){res.status(503).json({error:e.message});}
});
router.get('/manage/cameras', requireCameraEntitlement, async(req,res)=>{try{const rows=await db(filterOwner(req,'cameras?select=id,gateway_id,name,model,enabled,status,last_seen_at,snapshot_at,retention_days,created_at'));res.json({cameras:rows||[]});}catch(e){res.status(503).json({error:e.message});}});
router.post('/manage/camera-gateways', requireSession('admin'), requireCameraEntitlement, async(req,res)=>{
  try{
    const raw=token();
    const rows=await db('camera_gateways',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_email:owner(req),name:String(req.body.name||'Passerelle locale').slice(0,120),token_hash:hash(raw)})});
    await audit(req,'camera_gateway.created','camera_gateway',rows[0]?.id,{});
    res.status(201).json({gateway:rows[0],enrollmentToken:raw});
  }catch(e){res.status(400).json({error:e.message});}
});
router.post('/manage/cameras', requireSession('admin'), requireCameraEntitlement, async(req,res)=>{
  try{
    const gatewayId=String(req.body.gatewayId||'');
    const gateways=await db(filterOwner(req,`camera_gateways?select=id&id=eq.${encodeURIComponent(gatewayId)}&limit=1`));
    if(!gateways?.[0]) return res.status(404).json({error:'Passerelle introuvable'});
    const localStreamKey=String(req.body.localStreamKey||'camera-1').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
    const retentionDays=Math.min(90,Math.max(1,Number(req.body.retentionDays||14)));
    const rows=await db('cameras',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_email:owner(req),gateway_id:gatewayId,name:String(req.body.name||'Caméra').slice(0,120),model:String(req.body.model||'CTRONICS').slice(0,120),local_stream_key:localStreamKey,retention_days:retentionDays})});
    await audit(req,'camera.created','camera',rows[0]?.id,{gatewayId,localStreamKey,retentionDays});
    res.status(201).json(rows[0]);
  }catch(e){res.status(400).json({error:e.message});}
});
router.get('/manage/cameras/:id/snapshot', requireCameraEntitlement, async(req,res)=>{
  try{
    const rows=await db(filterOwner(req,`cameras?select=id&id=eq.${encodeURIComponent(req.params.id)}&limit=1`));
    if(!rows?.[0]) return res.status(404).json({error:'Caméra introuvable'});
    const snapshot=cameraSnapshots.get(req.params.id);
    if(!snapshot||Date.now()-snapshot.at>120000) return res.status(404).json({error:'Aucune image récente'});
    res.setHeader('Content-Type','image/jpeg');
    res.setHeader('Cache-Control','no-store, max-age=0');
    res.setHeader('X-Snapshot-At',new Date(snapshot.at).toISOString());
    res.send(snapshot.body);
  }catch(e){res.status(503).json({error:e.message});}
});
router.get('/manage/recordings/:id/download', requireCameraEntitlement, async(req,res)=>{
  try{
    const rows=await db(filterOwner(req,`camera_recordings?select=id,dropbox_path,status&id=eq.${encodeURIComponent(req.params.id)}&limit=1`));
    if(!rows?.[0]) return res.status(404).json({error:'Enregistrement introuvable'});
    res.json({url:await temporaryDropboxLink(rows[0].dropbox_path),expiresIn:14400});
  }catch(e){res.status(502).json({error:e.message});}
});

router.post('/gateway/heartbeat', async(req,res)=>{
  try{
    const g=await device(req,'camera_gateways');
    if(!g)return res.status(401).json({error:'Passerelle non autorisee'});
    const now=new Date().toISOString();
    await db(`camera_gateways?id=eq.${g.id}`,{method:'PATCH',body:JSON.stringify({status:'online',last_seen_at:now,app_version:String(req.body.appVersion||''),diagnostics:req.body.diagnostics||{},updated_at:now})});
    for(const state of Array.isArray(req.body.cameras)?req.body.cameras:[]){
      await db(`cameras?id=eq.${encodeURIComponent(String(state.id||''))}&gateway_id=eq.${g.id}`,{method:'PATCH',body:JSON.stringify({status:state.online?'online':'offline',last_seen_at:now})}).catch(()=>{});
    }
    const cameras=await db(`cameras?select=id,name,model,local_stream_key,retention_days,enabled&gateway_id=eq.${g.id}&enabled=eq.true`);
    res.json({gatewayId:g.id,cameras:cameras||[],nextHeartbeatSeconds:30});
  }catch(e){res.status(503).json({error:e.message});}
});
const cameraSnapshotBody=express.raw({type:['image/jpeg','application/octet-stream'],limit:MAX_CAMERA_SNAPSHOT_BYTES});
router.post('/gateway/cameras/:id/snapshot',(req,res,next)=>cameraSnapshotBody(req,res,error=>error?res.status(413).json({error:'Image caméra trop volumineuse'}):next()),async(req,res)=>{
  try{
    const g=await device(req,'camera_gateways');
    if(!g)return res.status(401).json({error:'Passerelle non autorisee'});
    const rows=await db(`cameras?select=id&gateway_id=eq.${g.id}&id=eq.${encodeURIComponent(req.params.id)}&limit=1`);
    if(!rows?.[0])return res.status(404).json({error:'Caméra introuvable'});
    if(!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:'Image vide'});
    cameraSnapshots.set(req.params.id,{body:Buffer.from(req.body),at:Date.now()});
    await db(`cameras?id=eq.${encodeURIComponent(req.params.id)}&gateway_id=eq.${g.id}`,{method:'PATCH',body:JSON.stringify({status:'online',last_seen_at:new Date().toISOString(),snapshot_at:new Date().toISOString()})});
    res.status(202).json({accepted:true});
  }catch(e){res.status(502).json({error:e.message});}
});
const cameraRecordingBody=express.raw({type:['video/mp4','application/octet-stream'],limit:MAX_CAMERA_RECORDING_BYTES});
router.post('/gateway/cameras/:id/recordings',(req,res,next)=>cameraRecordingBody(req,res,error=>error?res.status(413).json({error:'Enregistrement trop volumineux'}):next()),async(req,res)=>{
  try{
    const g=await device(req,'camera_gateways');
    if(!g)return res.status(401).json({error:'Passerelle non autorisee'});
    const cameras=await db(`cameras?select=id,owner_email,name,retention_days&gateway_id=eq.${g.id}&id=eq.${encodeURIComponent(req.params.id)}&limit=1`);
    const camera=cameras?.[0];
    if(!camera)return res.status(404).json({error:'Caméra introuvable'});
    if(!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:'Enregistrement vide'});
    const startedAt=new Date(req.query.startedAt||Date.now());
    const safeName=`${startedAt.toISOString().replace(/[:.]/g,'-')}-${cleanDropboxSegment(camera.name)}.mp4`;
    const dropboxPath=`${cameraRecordingRoot(camera.owner_email)}/${safeName}`;
    const accessToken=await getDropboxToken();
    if(!accessToken)return res.status(503).json({error:'Dropbox non configuré'});
    await dropboxJson('https://content.dropboxapi.com/2/files/upload',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/octet-stream','Dropbox-API-Arg':JSON.stringify({path:dropboxPath,mode:'add',autorename:true,mute:false})},body:req.body},"l’archivage caméra",1);
    const expiresAt=new Date(startedAt.getTime()+Number(camera.retention_days||14)*86400000).toISOString();
    const rows=await db('camera_recordings',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_email:camera.owner_email,camera_id:camera.id,name:safeName,mime_type:'video/mp4',dropbox_path:dropboxPath,size_bytes:req.body.length,duration_seconds:Number(req.query.durationSeconds||0)||null,started_at:startedAt.toISOString(),expires_at:expiresAt,status:'ready'})});
    res.status(201).json({recording:rows[0]});
  }catch(e){res.status(502).json({error:e.message});}
});

module.exports=router;


