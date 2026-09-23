const express = require('express');
const crypto = require('node:crypto');
const { crm, one, jsonValue, clean } = require('./server-campaigns-core.cjs');
const mediaStore = require('./server-campaign-media.cjs');

const workerRouter = express.Router();
const MAX_RESULT_BYTES = 256 * 1024 * 1024;

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}
async function patch(table, query, body) {
  const rows = await crm(table + '?' + query,{
    method:'PATCH',headers:{Prefer:'return=representation'},
    body:JSON.stringify({...body,updated_at:new Date().toISOString()})
  });
  return rows?.[0] || null;
}
async function insert(table, body) {
  const rows = await crm(table,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body)});
  return rows?.[0] || null;
}
function bearer(req) {
  const match=String(req.headers.authorization||'').match(/^Bearer\s+([A-Za-z0-9_-]{20,200})$/);
  return match?.[1] || '';
}
async function authenticate(req) {
  const token=bearer(req);
  if (!token) return null;
  const rows=await crm('campaign_local_workers?token_hash=eq.'+encodeURIComponent(hashToken(token))+'&status=eq.active&limit=1');
  return rows?.[0] || null;
}
async function pairWorker(req, body={}) {
  const org=String(req.user?.organisation||'jsinnovia');
  const userId=String(req.user?.id||req.user?.email||'');
  if (!userId) throw Object.assign(new Error('Utilisateur Cockpit introuvable.'),{status:401});
  await crm('campaign_local_workers?organisation_id=eq.'+encodeURIComponent(org)+'&user_id=eq.'+encodeURIComponent(userId)+'&status=eq.active',{
    method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'disabled',updated_at:new Date().toISOString()})
  }).catch(()=>null);
  const token=crypto.randomBytes(32).toString('base64url');
  const worker=await insert('campaign_local_workers',{
    organisation_id:org,user_id:userId,name:clean(body.name||'Elynea Local Worker',160),
    token_hash:hashToken(token),status:'active',created_at:new Date().toISOString(),updated_at:new Date().toISOString()
  });
  return {worker:{id:worker.id,name:worker.name,status:worker.status},token};
}
async function workerStatus(req) {
  const org=String(req.user?.organisation||'jsinnovia');
  const userId=String(req.user?.id||req.user?.email||'');
  const rows=await crm('campaign_local_workers?organisation_id=eq.'+encodeURIComponent(org)+'&user_id=eq.'+encodeURIComponent(userId)+'&status=eq.active&order=last_seen_at.desc&limit=1');
  const worker=rows?.[0]||null;
  const online=Boolean(worker?.last_seen_at && Date.now()-Date.parse(worker.last_seen_at)<45000);
  return worker ? {paired:true,online,worker:{id:worker.id,name:worker.name,version:worker.version,last_seen_at:worker.last_seen_at,capabilities:jsonValue(worker.capabilities,{})}} : {paired:false,online:false,worker:null};
}
async function readBinary(req,limit=MAX_RESULT_BYTES) {
  const parts=[];let total=0;
  for await (const chunk of req) {
    total+=chunk.length;
    if(total>limit) throw Object.assign(new Error('Résultat local trop volumineux.'),{status:413});
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}
async function loadRemoteImage(urlValue) {
  const url=new URL(urlValue);
  const supaHost=new URL(process.env.SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co').hostname;
  const extra=String(process.env.CAMPAIGN_MEDIA_HOSTS||'').split(',').map(v=>v.trim()).filter(Boolean);
  const allowed=['media.base44.com','imgen.x.ai',supaHost,...extra];
  if(url.protocol!=='https:'||url.port||url.username||url.password||!allowed.some(h=>h===url.hostname||(h.startsWith('*.')&&url.hostname.endsWith(h.slice(1))))) {
    throw Object.assign(new Error('Source image non autorisée.'),{status:403});
  }
  const response=await fetch(url.href,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw Object.assign(new Error('Source image inaccessible.'),{status:502});
  const buffer=Buffer.from(await response.arrayBuffer());
  if(!buffer.length||buffer.length>14*1024*1024) throw Object.assign(new Error('Source image trop volumineuse.'),{status:413});
  return {buffer,mime:String(response.headers.get('content-type')||'image/jpeg').split(';')[0]};
}
async function jobForWorker(req, id) {
  const worker=await authenticate(req);
  if(!worker) throw Object.assign(new Error('Worker non autorisé.'),{status:401});
  const rows=await crm('campaign_generation_jobs?id=eq.'+encodeURIComponent(id)+'&organisation_id=eq.'+encodeURIComponent(worker.organisation_id)+'&user_id=eq.'+encodeURIComponent(worker.user_id)+'&engine=eq.local&limit=1');
  const job=rows?.[0]||null;
  if(!job) throw Object.assign(new Error('Job local introuvable.'),{status:404});
  if(job.worker_id && job.worker_id!==worker.id) throw Object.assign(new Error('Job attribué à un autre worker.'),{status:403});
  return {worker,job};
}
workerRouter.post('/heartbeat',async(req,res)=>{
  try{
    const worker=await authenticate(req);
    if(!worker)return res.status(401).json({error:'Worker non autorisé.'});
    const raw=req.body||{};
    const caps=raw.capabilities&&typeof raw.capabilities==='object'?raw.capabilities:{};
    if(JSON.stringify(caps).length>100000)return res.status(413).json({error:'Capacités trop volumineuses.'});
    const updated=await patch('campaign_local_workers','id=eq.'+encodeURIComponent(worker.id),{
      last_seen_at:new Date().toISOString(),version:clean(raw.version,60)||null,capabilities:caps
    });
    res.json({ok:true,worker_id:updated.id});
  }catch(e){res.status(e.status||500).json({error:e.message});}
});
workerRouter.get('/jobs/next',async(req,res)=>{
  try{
    const worker=await authenticate(req);
    if(!worker)return res.status(401).json({error:'Worker non autorisé.'});
    await patch('campaign_local_workers','id=eq.'+encodeURIComponent(worker.id),{last_seen_at:new Date().toISOString()}).catch(()=>null);
    const rows=await crm('campaign_generation_jobs?engine=eq.local&status=eq.queued&organisation_id=eq.'+encodeURIComponent(worker.organisation_id)+'&user_id=eq.'+encodeURIComponent(worker.user_id)+'&order=created_at.asc&limit=5');
    for(const candidate of rows||[]){
      const claimed=await patch('campaign_generation_jobs','id=eq.'+encodeURIComponent(candidate.id)+'&status=eq.queued',{
        status:'claimed',worker_id:worker.id,claimed_at:new Date().toISOString()
      });
      if(claimed)return res.json({job:{id:claimed.id,kind:claimed.kind,payload:jsonValue(claimed.payload,{}),source_required:claimed.kind==='video'}});
    }
    res.status(204).end();
  }catch(e){res.status(e.status||500).json({error:e.message});}
});
workerRouter.get('/jobs/:id/source',async(req,res)=>{
  try{
    const {job}=await jobForWorker(req,req.params.id);
    if(job.kind!=='video')return res.status(409).json({error:'Ce job ne nécessite pas de source vidéo.'});
    const post=await one('campaign_posts',job.post_id,job.organisation_id);
    if(!post)return res.status(404).json({error:'Contenu campagne introuvable.'});
    const source=post.image_storage_path?await mediaStore.downloadBuffer(post.image_storage_path):await loadRemoteImage(post.image_url);
    if(!source.mime.startsWith('image/'))return res.status(415).json({error:'Source non image.'});
    res.set({'Content-Type':source.mime,'Content-Length':String(source.buffer.length),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(source.buffer);
  }catch(e){res.status(e.status||500).json({error:e.message});}
});
workerRouter.post('/jobs/:id/result',async(req,res)=>{
  try{
    const {job}=await jobForWorker(req,req.params.id);
    if(!['claimed','running'].includes(job.status))return res.status(409).json({error:'Job local non actif.'});
    const mime=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
    if(job.kind==='image'&&!['image/png','image/jpeg','image/webp'].includes(mime))return res.status(415).json({error:'Résultat image invalide.'});
    if(job.kind==='video'&&!['video/mp4','video/webm','video/quicktime'].includes(mime))return res.status(415).json({error:'Résultat vidéo invalide.'});
    const buffer=await readBinary(req);
    const stored=await mediaStore.uploadBuffer({buffer,mime,postId:job.post_id,kind:job.kind});
    await patch('campaign_generation_jobs','id=eq.'+encodeURIComponent(job.id),{
      status:'completed',result_url:stored.public_url,storage_path:stored.storage_path,completed_at:new Date().toISOString(),error:null
    });
    if(job.kind==='image'){
      await patch('campaign_posts','id=eq.'+encodeURIComponent(job.post_id),{
        image_provider:'local',image_job_id:job.id,image_url:stored.public_url,image_storage_path:stored.storage_path,
        image_status:'review',image_error:null,status:'image_review'
      });
    }else{
      await patch('campaign_posts','id=eq.'+encodeURIComponent(job.post_id),{
        video_provider:'local',video_job_id:job.id,video_url:stored.public_url,video_storage_path:stored.storage_path,
        video_status:'completed',video_error:null,status:'video_review'
      });
    }
    res.status(201).json({ok:true,url:stored.public_url});
  }catch(e){res.status(e.status||500).json({error:e.message});}
});
workerRouter.post('/jobs/:id/fail',async(req,res)=>{
  try{
    const {job}=await jobForWorker(req,req.params.id);
    const message=clean(req.body?.error||'Échec du moteur local.',1800);
    await patch('campaign_generation_jobs','id=eq.'+encodeURIComponent(job.id),{status:'failed',error:message,completed_at:new Date().toISOString()});
    if(job.kind==='image')await patch('campaign_posts','id=eq.'+encodeURIComponent(job.post_id),{image_status:'failed',image_error:message,status:'prepared'});
    else await patch('campaign_posts','id=eq.'+encodeURIComponent(job.post_id),{video_status:'failed',video_error:message,status:'image_approved'});
    res.json({ok:true});
  }catch(e){res.status(e.status||500).json({error:e.message});}
});

module.exports={workerRouter,pairWorker,workerStatus,hashToken};