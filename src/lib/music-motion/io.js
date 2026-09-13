import { newProject, normalizeProject, parseTime, SCHEMA, uid } from './model.js';

export const MAX_ZIP = 512 * 1024 * 1024;
const MAX_EXPANDED = 512 * 1024 * 1024;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i; for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
export function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export async function sha256(blob) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join(''); }
export function safeArchivePath(name) {
  if (!name || name.length > 500 || name.includes('\\') || name.startsWith('/') || /[\0-\x1f:]/.test(name) || name.split('/').some(s => s === '..' || s === '.')) throw new Error('Chemin ZIP non autorisé.');
  return name;
}
/** Read only standard single-disk ZIPs. Sizes and CRC are checked before any import. */
export async function readZip(blob) {
  if (blob.size > MAX_ZIP) throw new Error('Archive trop volumineuse (512 Mo maximum).');
  const bytes = new Uint8Array(await blob.arrayBuffer()); const view = new DataView(bytes.buffer);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === bytes.length) { end = p; break; }
  }
  if (end < 0) throw new Error('Archive ZIP invalide ou tronquée.');
  const count = view.getUint16(end + 10, true); const offset = view.getUint32(end + 16, true); const centralSize = view.getUint32(end + 12, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) || count > 2500 || offset + centralSize !== end) throw new Error('ZIP fractionné, ZIP64 ou index trop volumineux non pris en charge.');
  let pos = offset; let expanded = 0; const entries = []; const names = new Set();
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) throw new Error('Index ZIP invalide.');
    const flags = view.getUint16(pos + 8, true), method = view.getUint16(pos + 10, true);
    const compressed = view.getUint32(pos + 20, true), size = view.getUint32(pos + 24, true);
    const nameSize = view.getUint16(pos + 28, true), extra = view.getUint16(pos + 30, true), comment = view.getUint16(pos + 32, true);
    if (pos + 46 + nameSize + extra + comment > end) throw new Error('Index ZIP tronqué.');
    const name = safeArchivePath(decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameSize)));
    const mode = view.getUint32(pos + 38, true) >>> 16;
    if ((flags & 0x41) || ![0, 8].includes(method) || (mode & 0xf000) === 0xa000 || size === 0xffffffff || compressed === 0xffffffff) throw new Error('ZIP chiffré, lien symbolique ou compression non autorisée.');
    if (names.has(name.toLowerCase())) throw new Error('Fichier ZIP dupliqué ou ambigu.'); names.add(name.toLowerCase());
    expanded += size;
    if (size > 256 * 1024 * 1024 || expanded > MAX_EXPANDED || (size > 2 * 1024 * 1024 && size > Math.max(1, compressed) * 250)) throw new Error('Limite de décompression ZIP dépassée.');
    const local = view.getUint32(pos + 42, true);
    if (local + 30 > offset || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 8, true) !== method || view.getUint16(local + 6, true) !== flags) throw new Error('En-tête ZIP incohérent.');
    const localNameSize = view.getUint16(local + 26, true);
    const start = local + 30 + localNameSize + view.getUint16(local + 28, true);
    if (start + compressed > offset || decoder.decode(bytes.subarray(local + 30, local + 30 + localNameSize)) !== name) throw new Error('Données ZIP hors limites.');
    entries.push({ name, size, compressed, method, start, crc: view.getUint32(pos + 16, true) });
    pos += 46 + nameSize + extra + comment;
  }
  if (pos !== end) throw new Error('Index ZIP incohérent.');
  const files = new Map();
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    const compressed = bytes.subarray(entry.start, entry.start + entry.compressed);
    let data;
    if (entry.method === 0) data = compressed;
    else {
      if (typeof DecompressionStream === 'undefined') throw new Error('Ce navigateur ne permet pas la décompression ZIP. Utilisez le cockpit desktop ou un navigateur récent.');
      const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      data = new Uint8Array(entry.size); let read = 0;
      try {
        while (true) { const part = await reader.read(); if (part.done) break; if (read + part.value.length > entry.size) throw new Error('Taille décompressée excessive.'); data.set(part.value, read); read += part.value.length; }
        if (read !== entry.size) throw new Error('Fichier ZIP tronqué.');
      } catch (e) { await reader.cancel().catch(() => {}); throw e; }
    }
    if (data.length !== entry.size || crc32(data) !== entry.crc) throw new Error(`Intégrité incorrecte : ${entry.name}.`);
    files.set(entry.name, new Blob([data]));
  }
  return files;
}
/** Uncompressed output: media already use compressed formats; avoids third-party executables. */
export async function writeZip(files) {
  const parts = [], central = []; let offset = 0; let centralLength = 0;
  for (const [name, blob] of files) {
    safeArchivePath(name); const path = encoder.encode(name); const data = new Uint8Array(await blob.arrayBuffer()); const crc = crc32(data);
    if (offset + data.length > MAX_EXPANDED) throw new Error('Projet trop volumineux pour cet export ZIP (512 Mo).');
    const head = new Uint8Array(30 + path.length), h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, path.length, true); head.set(path, 30);
    const dir = new Uint8Array(46 + path.length), d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true); d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, path.length, true); d.setUint32(42, offset, true); dir.set(path, 46);
    parts.push(head, data); central.push(dir); offset += head.length + data.length; centralLength += dir.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.size, true); e.setUint16(10, files.size, true); e.setUint32(12, centralLength, true); e.setUint32(16, offset, true);
  const output = new Blob([...parts, ...central, end], { type: 'application/zip' }); if(output.size > MAX_ZIP) throw new Error('Projet ZIP supérieur à 512 Mo.'); return output;
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac', ogg: 'audio/ogg', pdf: 'application/pdf' };
export const extension = name => String(name).split('.').pop().toLowerCase();
export async function makeAsset(file, role) {
  if(file.size>256*1024*1024) throw new Error('Média supérieur à 256 Mo.');
  const mime = MIME[extension(file.name)] || file.type;
  if (!Object.values(MIME).includes(mime)) throw new Error('Format média non pris en charge.');
  const blob = file.type === mime ? file : new Blob([file], { type: mime });
  return { asset: { id: uid('asset'), name: file.name || 'media', mime, role, size: file.size, sha256: await sha256(blob), duration_seconds: 0 }, blob };
}
export function parseCsv(source) {
  const rows = []; let row = [], field = '', quote = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') { if (quote && source[i + 1] === '"') { field += '"'; i++; } else quote = !quote; }
    else if (!quote && (c === ';' || c === '\n')) { row.push(field.replace(/\r$/, '')); field = ''; if (c === '\n') { rows.push(row); row = []; } }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = (rows.shift() || []).map(s => s.replace(/^\uFEFF/, '').trim().toLowerCase());
  return rows.filter(r => r.some(Boolean)).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] || ''])));
}
function promptBlock(source, label, fallback = '') {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(escaped + '[^\\n]*\\n([\\s\\S]*?)(?=\\n[A-ZÀ-Ÿ][A-ZÀ-Ÿ /’()]+\\n|$)', 'i'));
  return match ? match[1].trim() : fallback;
}
export async function importProjectZip(file) {
  const files = await readZip(file); const manifestNames = [...files.keys()].filter(n => n.endsWith('project.elynea.json'));
  if (manifestNames.length > 1) throw new Error('Plusieurs projets dans cette archive : import ambigu.');
  const blobs = new Map(); const warnings = [];
  if (manifestNames.length) {
    const manifestName = manifestNames[0], root = manifestName.slice(0, -'project.elynea.json'.length);
    if (files.get(manifestName).size > 8 * 1024 * 1024) throw new Error('Manifeste trop volumineux.');
    const project = normalizeProject(JSON.parse(await files.get(manifestName).text()));
    for (const a of project.assets) {
      const name = root + safeArchivePath(a.path); const found = files.get(name);
      if (!found) throw new Error(`Média absent de l’archive : ${a.name}.`);
      const blob = new Blob([found], { type: a.mime }); const digest = await sha256(blob);
      if (a.sha256 && digest !== a.sha256) throw new Error(`Empreinte différente : ${a.name}.`);
      a.sha256 = digest; a.size = blob.size; blobs.set(a.id, blob);
    }
    if (project.audio && !blobs.has(project.audio.asset_id)) throw new Error('Source audio absente du projet.');
    project.review.storyboard = false;
    warnings.push('Projet réimporté : vérifier les durées vidéo et valider le storyboard avant un nouveau rendu.');
    return { project, blobs, warnings };
  }
  const project = newProject(); project.title = file.name.replace(/\.zip$/i, '');
  const mediaNames = [...files.keys()].filter(n => MIME[extension(n)] && extension(n) !== 'pdf');
  for (const name of mediaNames) {
    const mime = MIME[extension(name)]; const role = mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : /01_images|keyframe/i.test(name) ? 'keyframe' : 'reference';
    const result = await makeAsset(new File([files.get(name)], name.split('/').pop(), { type: mime }), role);
    result.asset.import_path = name; project.assets.push(result.asset); blobs.set(result.asset.id, result.blob);
    if (role === 'audio') { if (project.audio) warnings.push('Plusieurs pistes audio : seule la première est sélectionnée.'); else project.audio = { asset_id: result.asset.id, name: result.asset.name, duration_seconds: 0, sha256: result.asset.sha256 }; }
  }
  const master = [...files.keys()].find(n => /master_prompt/i.test(n) && /\.txt$/i.test(n));
  if (master) project.direction.brief = (await files.get(master).text()).slice(0, 16000);
  const csv = [...files.keys()].find(n => /tableau_montage.*\.csv$/i.test(n));
  const rows = csv ? parseCsv(await files.get(csv).text()) : [];
  const prompts = [...files.keys()].filter(n => /02_prompts_scenes\/.*\.txt$/i.test(n)).sort();
  const sceneRows = rows.length ? rows : prompts.map((n, i) => ({ scene: String(i + 1).padStart(2, '0'), titre: n.split('/').pop().replace(/\.txt$/i, '') }));
  for (const [i, row] of sceneRows.entries()) {
    const num = String(row.scene || i + 1).padStart(2, '0');
    const promptName = prompts.find(n => n.split('/').pop().startsWith(num + '_'));
    const raw = promptName ? (await files.get(promptName).text()).slice(0, 40000) : '';
    const tc = row.timecode || raw.match(/\d{1,3}:\d{2}(?:[.,]\d+)?\s*→\s*\d{1,3}:\d{2}(?:[.,]\d+)?/)?.[0] || '';
    const times = tc.split(/\s*(?:→|-->|–)\s*/).map(parseTime);
    const image = project.assets.find(a => a.mime.startsWith('image/') && (a.name === row.image || a.name.startsWith(num + '_')));
    if (image) image.role = 'keyframe';
    const scene = { id: uid('scene'), label: row.titre || `Scène ${num}`, type: 'imported', start: Number.isFinite(times[0]) ? times[0] : 0, end: Number.isFinite(times[1]) ? times[1] : 0,
      prompt: promptBlock(raw, 'PROMPT VIDÉO / ANIMATION GROK', raw), image_prompt: promptBlock(raw, 'PROMPT IMAGE FIXE', ''), motion: row.camera || '', negative_prompt: '', keyframe_id: image?.id || '', locked: false, dance: false, provenance: 'imported-unverified' };
    project.scenes.push(scene);
  }
  if (!project.scenes.length && !project.assets.length) throw new Error('Aucun storyboard ni média reconnu. Cette archive n’est pas un pack de clip.');
  for (const [name, data] of files) {
    if (extension(name) === 'pdf') {
      const { asset, blob } = await makeAsset(new File([data], name.split('/').pop(), { type: 'application/pdf' }), 'document');
      project.assets.push(asset); blobs.set(asset.id, blob); project.sources.push({ asset_id: asset.id, name: asset.name, text: '', warning: 'PDF importé comme source, extraction du texte à lancer séparément.' });
    }
  }
  if (!project.audio) warnings.push('La chanson originale n’est pas dans le ZIP : importez-la pour analyser et synchroniser le clip.');
  warnings.push('Les timecodes importés sont des propositions, pas des mesures audio. Les images ne sont pas encore des vidéos.');
  if ([...files.keys()].some(n => /\.(?:js|mjs|py|sh|ps1|exe|bat|cmd)$/i.test(n))) warnings.push('Les fichiers exécutables ont été ignorés. Aucun script de l’archive n’a été lancé.');
  return { project, blobs, warnings };
}
export async function exportProjectZip(project, blobs) {
  const clean = normalizeProject(project); const files = new Map();
  for (const a of clean.assets) {
    const blob = blobs.get(a.id); if (!blob) throw new Error(`Média introuvable : ${a.name}.`);
    a.path = `media/${a.id}.${extension(a.name) || 'bin'}`; a.sha256 = await sha256(blob); a.size = blob.size; files.set(a.path, blob);
  }
  files.set('project.elynea.json', new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' }));
  files.set('README.txt', new Blob(['Projet Elynea Music Motion Studio v2. Réimporter le ZIP dans le studio. Les médias sont inclus. Aucune clé API. Les moteurs locaux et la configuration fournisseur restent propres à l’installation.']));
  for (const [i, s] of clean.scenes.entries()) files.set(`prompts/${String(i + 1).padStart(2, '0')}.txt`, new Blob([`${s.label}\n${s.start} → ${s.end}\n\nDIRECTION\n${clean.direction.brief}\n\nIMAGE\n${s.image_prompt}\n\nVIDÉO\n${s.prompt}\n\nCONTRAINTES\n${s.negative_prompt}`]));
  return writeZip(files);
}
function openDb() { return new Promise((resolve, reject) => { const request = indexedDB.open('elynea-music-motion-v2', 1); request.onupgradeneeded = () => { const db = request.result; db.createObjectStore('projects', { keyPath: 'key' }); db.createObjectStore('media', { keyPath: 'key' }); }; request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); }); }
export async function saveProject(scope, project, blobs) {
  if (!scope) throw new Error('Session utilisateur requise pour la sauvegarde.');
  const db = await openDb(); const key = `${scope}:${project.id}`;
  try { await new Promise((resolve, reject) => { const tx = db.transaction(['projects','media'], 'readwrite'); tx.objectStore('projects').put({ key, scope, document: normalizeProject(project) }); for (const [id, blob] of blobs) { const mediaKey=`${key}:${id}`, hash=project.assets.find(a=>a.id===id)?.sha256; const store=tx.objectStore('media'); const existing=store.get(mediaKey); existing.onsuccess=()=>{if(!hash || existing.result?.sha256!==hash) store.put({key:mediaKey,blob,sha256:hash});}; } tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Sauvegarde interrompue.')); }); } finally { db.close(); }
}
export async function listProjects(scope) {
  const db = await openDb(); try { return await new Promise((resolve,reject) => { const r = db.transaction('projects').objectStore('projects').getAll(); r.onsuccess = () => resolve(r.result.filter(p => p.scope === scope).map(p => ({ id:p.document.id, title:p.document.title, updated_at:p.document.updated_at }))); r.onerror = () => reject(r.error); }); } finally { db.close(); }
}
export async function loadProject(scope, id) {
  const db = await openDb(); const key = `${scope}:${id}`;
  try { const result = await new Promise((resolve,reject) => { const tx = db.transaction(['projects','media']); const r = tx.objectStore('projects').get(key); const blobs = new Map(); let project; r.onsuccess = () => { project = r.result?.document; if (!project) return; for (const a of project.assets) { const q = tx.objectStore('media').get(`${key}:${a.id}`); q.onsuccess = () => { if(q.result?.blob) blobs.set(a.id,q.result.blob); }; } }; tx.oncomplete = () => project ? resolve({ project, blobs }) : reject(new Error('Projet introuvable pour cette session.')); tx.onerror = () => reject(tx.error); }); return result; } finally { db.close(); }
}
export async function probeMedia(blob) {
  if (!blob.type.startsWith('audio/') && !blob.type.startsWith('video/') && !blob.type.startsWith('image/')) return {};
  const url = URL.createObjectURL(blob);
  try { return await new Promise((resolve,reject) => { const media = blob.type.startsWith('image/') ? new Image() : document.createElement(blob.type.startsWith('audio/') ? 'audio' : 'video'); const timer = setTimeout(() => { media.src = ''; reject(new Error('Lecture des métadonnées expirée.')); },15000); const done = () => { clearTimeout(timer); resolve(blob.type.startsWith('image/') ? { width:media.naturalWidth, height:media.naturalHeight } : { duration_seconds:Number.isFinite(media.duration) ? media.duration : 0, width:media.videoWidth || 0, height:media.videoHeight || 0 }); media.src=''; }; media.onerror = () => { clearTimeout(timer); reject(new Error('Média non décodable dans ce navigateur.')); }; if(blob.type.startsWith('image/')) media.onload=done; else { media.preload='metadata'; media.onloadedmetadata=done; } media.src=url; }); } finally { URL.revokeObjectURL(url); }
}
export async function dataUrl(blob) { return new Promise((resolve,reject) => { const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=()=>reject(r.error); r.readAsDataURL(blob); }); }
export function makeLocalClient(token = '') {
  let base = '';
  const auth = token ? { Authorization: `Bearer ${token}` } : {};
  async function locate() { if(base) return base; for(const url of ['http://127.0.0.1:8788','http://127.0.0.1:8787']) { try { const r=await fetch(url+'/api/music-motion/production/capabilities',{headers:auth,signal:AbortSignal.timeout(30000)}); if(r.status===401) throw new Error('Jeton local requis ou incorrect.'); if(r.ok) { base=url+'/api/music-motion/production'; return base; } } catch(e) { if(/Jeton/.test(e.message)) throw e; } } throw new Error('Agent local Music Motion v2 injoignable. Mettre à jour et démarrer l’agent local.'); }
  async function request(path, options = {}) { const endpoint=await locate(); const r=await fetch(endpoint+path,{...options,headers:{...auth,...options.headers},signal:options.signal || AbortSignal.timeout(path==='/chat' ? 180000 : 30000)}); if(!r.ok) { const e=await r.json().catch(()=>({})); throw Object.assign(new Error(e.details || e.error || `Agent local HTTP ${r.status}`),{status:r.status}); } return r; }
  return { json:async(path,body)=> (await request(path,body===undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json(),
    upload:async(blob,name)=> (await request('/assets?name='+encodeURIComponent(name),{method:'POST',headers:{'Content-Type':blob.type || 'application/octet-stream'},body:blob,signal:AbortSignal.timeout(120000)})).json(),
    media:async(id)=> (await request('/assets/'+encodeURIComponent(id))).blob() };
}
export async function cloudJson(path, body) { const r=await fetch('/api/music-motion'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}); const value=await r.json().catch(()=>({})); if(!r.ok) throw Object.assign(new Error(value.error || `Service Cockpit HTTP ${r.status}`),{status:r.status}); return value; }
export async function cloudMedia(id) { const r=await fetch('/api/music-motion/jobs/'+encodeURIComponent(id)+'/media',{credentials:'same-origin'}); if(!r.ok) throw new Error('Récupération du média API impossible.'); return r.blob(); }

/** Import a v1/third-party storyboard without replacing the song or inventing assets. */
export async function importStoryboardJson(file, project) {
  if(file.size>200000)throw new Error('Storyboard JSON supérieur à 200 Ko ; utiliser un projet ZIP natif.');
  const raw=await file.text(),value=JSON.parse(raw);
  const rows=value.scenes || value.sections || value.creative_plan?.sections;
  if(!Array.isArray(rows)||!rows.length||rows.length>200)throw new Error('Aucune scène reconnue dans le storyboard JSON.');
  const scenes=rows.map((s,i)=>({id:uid('scene'),label:String(s.label||s.title||`Scène ${i+1}`).slice(0,160),type:String(s.type||'imported').slice(0,60),start:typeof s.start==='number'?s.start:parseTime(s.start),end:typeof s.end==='number'?s.end:parseTime(s.end),motion:String(s.motion||s.intention||'').slice(0,16000),prompt:String(s.prompt||s.video_prompt||'').slice(0,16000),image_prompt:String(s.image_prompt||'').slice(0,16000),negative_prompt:String(s.negative_prompt||'').slice(0,16000),keyframe_id:project.assets.find(a=>a.name===s.image&&a.mime.startsWith('image/'))?.id||'',locked:false,dance:s.dance===true,provenance:'imported-json-unverified'}));
  if(scenes.some(s=>!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start))throw new Error('Les timecodes du JSON doivent être renseignés et valides.');
  return {scenes,source:{asset_id:'',name:file.name,text:raw,warning:'Storyboard JSON importé ; timecodes et intentions à valider sur la chanson.'}};
}

/** Re-probe imported media, never trust durations written by another application. */
export async function verifyImportedMedia(imported, probe = probeMedia) {
  const project = structuredClone(imported.project), warnings = [...(imported.warnings || [])];
  for (const asset of project.assets) {
    const blob = imported.blobs.get(asset.id);
    if (!blob) throw new Error(`Média importé manquant : ${asset.name}.`);
    if (!/^(audio|video|image)\//.test(asset.mime)) continue;
    let measured;
    try { measured = await probe(blob); }
    catch (e) { throw new Error(`${asset.name} : ${e.message}`); }
    if (/^(audio|video)\//.test(asset.mime) && !(measured.duration_seconds > 0)) throw new Error(`Durée réelle impossible à vérifier : ${asset.name}.`);
    Object.assign(asset, measured);
    if (asset.id === project.audio?.asset_id) {
      if (project.audio.sha256 !== asset.sha256 || Math.abs((project.audio.duration_seconds || 0) - measured.duration_seconds) > 0.1) {
        project.analysis = null;
        project.review = { lyrics: false, storyboard: false };
        warnings.push('Les métadonnées audio ont été relues : analyse et validations à renouveler.');
      }
      project.audio = { ...project.audio, name: asset.name, sha256: asset.sha256, duration_seconds: measured.duration_seconds };
    }
  }
  return { ...imported, project, warnings };
}
