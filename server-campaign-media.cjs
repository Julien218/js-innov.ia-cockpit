const crypto = require('node:crypto');

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const BUCKET = 'campaign-media';
const MAX_BYTES = 256 * 1024 * 1024;
let bucketReady = null;

function requireConfig() {
  if (!SUPABASE_KEY) throw Object.assign(new Error('Stockage campagne non configuré.'), { status: 503 });
}
function encoded(value) {
  return String(value).split('/').map(encodeURIComponent).join('/');
}
function extension(mime) {
  return ({ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov' })[mime] || null;
}
async function request(endpoint, options = {}) {
  requireConfig();
  const response = await fetch(SUPABASE_URL + endpoint, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      ...(options.body !== undefined && !options.headers?.['Content-Type'] ? { 'Content-Type':'application/json' } : {}),
      ...(options.headers || {}),
    },
    ...(options.body !== undefined ? { body: options.body } : {}),
    signal: options.signal || AbortSignal.timeout(120000),
  });
  return response;
}
async function ensureBucket() {
  if (bucketReady) return bucketReady;
  bucketReady = (async () => {
    let response = await request('/storage/v1/bucket/' + encodeURIComponent(BUCKET));
    if (response.ok) {
      await response.body?.cancel();
      const update = await request('/storage/v1/bucket/' + encodeURIComponent(BUCKET), {
        method:'PUT',
        body:JSON.stringify({ public:true, file_size_limit:MAX_BYTES }),
      });
      await update.body?.cancel();
      return;
    }
    await response.body?.cancel();
    if (response.status !== 404) throw Object.assign(new Error('Vérification du bucket Campagnes impossible.'), { status:502 });
    response = await request('/storage/v1/bucket', {
      method:'POST',
      body:JSON.stringify({ id:BUCKET, name:BUCKET, public:true, file_size_limit:MAX_BYTES }),
    });
    if (!response.ok && response.status !== 409) {
      const detail = await response.text();
      throw Object.assign(new Error('Création du bucket Campagnes impossible: ' + detail.slice(0,300)), { status:502 });
    }
    await response.body?.cancel();
  })().catch(error => { bucketReady = null; throw error; });
  return bucketReady;
}
function checkedStoragePath(value) {
  const path = String(value || '');
  if (!/^campaigns\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\/(image|video)-[0-9a-f-]{36}\.(png|jpg|webp|mp4|webm|mov)$/i.test(path)) {
    throw Object.assign(new Error('Chemin média campagne invalide.'), { status:400 });
  }
  return path;
}
async function uploadBuffer({ buffer, mime, postId, kind }) {
  await ensureBucket();
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES) throw Object.assign(new Error('Média vide ou trop volumineux.'), { status:413 });
  if (!['image','video'].includes(kind)) throw Object.assign(new Error('Type média campagne invalide.'), { status:400 });
  const ext = extension(mime);
  if (!ext || (kind === 'image' && !mime.startsWith('image/')) || (kind === 'video' && !mime.startsWith('video/'))) {
    throw Object.assign(new Error('Format média campagne non autorisé.'), { status:415 });
  }
  const day = new Date().toISOString().slice(0,10);
  const safePost = /^[0-9a-f-]{36}$/i.test(String(postId || '')) ? String(postId) : crypto.randomUUID();
  const storagePath = `campaigns/${day}/${safePost}/${kind}-${crypto.randomUUID()}.${ext}`;
  const response = await request('/storage/v1/object/' + encodeURIComponent(BUCKET) + '/' + encoded(storagePath), {
    method:'POST',
    headers:{ 'Content-Type':mime, 'x-upsert':'false' },
    body:buffer,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw Object.assign(new Error('Upload média campagne impossible: ' + detail.slice(0,300)), { status:502 });
  }
  await response.body?.cancel();
  const publicUrl = SUPABASE_URL + '/storage/v1/object/public/' + encodeURIComponent(BUCKET) + '/' + encoded(storagePath);
  return { storage_path:storagePath, public_url:publicUrl, mime, bytes:buffer.length };
}
async function downloadBuffer(storagePath) {
  const safe = checkedStoragePath(storagePath);
  const response = await request('/storage/v1/object/' + encodeURIComponent(BUCKET) + '/' + encoded(safe));
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error('Média campagne introuvable.'), { status:404 });
  }
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) { await response.body?.cancel(); throw Object.assign(new Error('Média campagne trop volumineux.'), { status:413 }); }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw Object.assign(new Error('Média campagne trop volumineux.'), { status:413 });
  return { buffer, mime:String(response.headers.get('content-type') || 'application/octet-stream').split(';')[0].toLowerCase() };
}

module.exports = { BUCKET, MAX_BYTES, ensureBucket, uploadBuffer, downloadBuffer, checkedStoragePath };