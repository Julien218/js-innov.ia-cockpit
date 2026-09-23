const crypto = require('node:crypto');
const { crm, one, jsonValue, loadBrandContext, brandPrompt } = require('./server-campaigns-core.cjs');
const mediaStore = require('./server-campaign-media.cjs');

const XAI_KEY = process.env.XAI_API_KEY || '';
const XAI_IMAGE_MODEL = process.env.MUSIC_MOTION_XAI_IMAGE_MODEL || 'grok-imagine-image-2.0';
const XAI_VIDEO_MODEL = process.env.MUSIC_MOTION_XAI_VIDEO_MODEL || 'grok-imagine-video-1.5';
let scheduler = null;
let schedulerBusy = false;

function engineError(message, status = 400, code = null) {
  const error = Object.assign(new Error(message), { status });
  if (code) error.code = code;
  return error;
}
function formatForPost(post) {
  const platforms = jsonValue(post.platforms, []);
  return platforms.includes('tiktok') || platforms.includes('instagram') ? '9:16' : '1:1';
}
async function patch(table, query, body) {
  const rows = await crm(table + '?' + query, {
    method:'PATCH',
    headers:{ Prefer:'return=representation' },
    body:JSON.stringify({ ...body, updated_at:new Date().toISOString() }),
  });
  return rows?.[0] || null;
}
async function insert(table, body) {
  const rows = await crm(table, {
    method:'POST',
    headers:{ Prefer:'return=representation' },
    body:JSON.stringify(body),
  });
  return rows?.[0] || null;
}
async function bundle(postId, org) {
  const post = await one('campaign_posts', postId, org);
  if (!post) throw engineError('Contenu introuvable.',404);
  const campaign = await one('campaigns', post.campaign_id, org);
  if (!campaign) throw engineError('Campagne introuvable.',404);
  const brand = await one('campaign_brands', campaign.brand_id, org);
  if (!brand) throw engineError('Marque introuvable.',404);
  const context = await loadBrandContext(brand,campaign);
  return { post,campaign,brand,context };
}
function recentWorker(row) {
  return row?.status === 'active' && row.last_seen_at && Date.now() - Date.parse(row.last_seen_at) < 45000;
}
async function activeWorker({ userId, org, kind, brand }) {
  const rows = await crm(
    'campaign_local_workers?organisation_id=eq.' + encodeURIComponent(org)
    + '&user_id=eq.' + encodeURIComponent(userId)
    + '&status=eq.active&order=last_seen_at.desc&limit=5'
  );
  for (const worker of rows || []) {
    if (!recentWorker(worker)) continue;
    const caps = jsonValue(worker.capabilities,{});
    if (!caps.comfy) continue;
    if (kind === 'image') {
      const checkpoints = Array.isArray(caps.checkpoints) ? caps.checkpoints : [];
      const wanted = brand.local_image_checkpoint || checkpoints[0] || '';
      if (wanted && checkpoints.includes(wanted)) return { worker, checkpoint:wanted };
    } else {
      const workflows = Array.isArray(caps.video_workflows) ? caps.video_workflows.filter(w => w?.available) : [];
      const wanted = brand.local_workflow_id || workflows[0]?.id || '';
      if (wanted && workflows.some(w => w.id === wanted)) return { worker, workflow_id:wanted };
    }
  }
  return null;
}
async function activeJob(postId,kind) {
  const rows=await crm('campaign_generation_jobs?post_id=eq.'+encodeURIComponent(postId)+'&kind=eq.'+encodeURIComponent(kind)+'&status=in.(queued,claimed,submitting,submitted,running)&order=created_at.desc&limit=1');
  return rows?.[0] || null;
}
async function createJob({ org,userId,postId,kind,engine,provider,payload,paidConsent=false }) {
  const existing=await activeJob(postId,kind);
  if(existing)return { ...existing, reused:true };
  return insert('campaign_generation_jobs',{
    organisation_id:org,user_id:String(userId),post_id:postId,kind,engine,provider:provider||engine,
    status:engine === 'local' ? 'queued' : 'submitting',payload,paid_consent:paidConsent,
  });
}
async function xai(endpoint, body) {
  if (!XAI_KEY) throw engineError('XAI_API_KEY non configurée.',503,'API_ENGINE_UNAVAILABLE');
  const response = await fetch('https://api.x.ai/v1' + endpoint,{
    method:body ? 'POST':'GET',
    headers:{ Authorization:'Bearer ' + XAI_KEY, ...(body ? {'Content-Type':'application/json'}:{}) },
    ...(body ? {body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(body ? 180000:30000),
    redirect:'error',
  });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw engineError('xAI HTTP ' + response.status + ': ' + String(data?.error?.message || data?.error || '').slice(0,300),502);
  return data;
}
async function downloadProvider(url, kind) {
  const u = new URL(url);
  const allowed = new Set(kind === 'video' ? ['vidgen.x.ai'] : ['imgen.x.ai']);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !allowed.has(u.hostname)) throw engineError('Hôte fournisseur non autorisé.',502);
  const response = await fetch(u.href,{redirect:'error',signal:AbortSignal.timeout(120000)});
  if (!response.ok) throw engineError('Téléchargement fournisseur impossible.',502);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > mediaStore.MAX_BYTES) throw engineError('Résultat fournisseur invalide ou trop volumineux.',502);
  const mime = String(response.headers.get('content-type') || (kind === 'video' ? 'video/mp4':'image/jpeg')).split(';')[0].toLowerCase();
  return {buffer,mime};
}
async function markJobFailed(job,error) {
  await patch('campaign_generation_jobs','id=eq.' + encodeURIComponent(job.id),{
    status:'failed',error:String(error.message || error).slice(0,2000),completed_at:new Date().toISOString(),
  }).catch(()=>null);
  const postPatch = job.kind === 'image'
    ? {image_status:'failed',image_error:String(error.message || error).slice(0,2000),status:'prepared'}
    : {video_status:'failed',video_error:String(error.message || error).slice(0,2000),status:'image_approved'};
  await patch('campaign_posts','id=eq.' + encodeURIComponent(job.post_id),postPatch).catch(()=>null);
}
async function runApiImage(job) {
  try {
    const payload = jsonValue(job.payload,{});
    const result = await xai('/images/generations',{
      model:XAI_IMAGE_MODEL,prompt:payload.prompt,n:1,response_format:'b64_json',aspect_ratio:payload.format || '9:16'
    });
    const item = result.data?.[0];
    if (!item || item.respect_moderation === false) throw engineError('Aucune image autorisée reçue.',502);
    const media = item.b64_json
      ? {buffer:Buffer.from(item.b64_json,'base64'),mime:'image/jpeg'}
      : await downloadProvider(item.url,'image');
    const stored = await mediaStore.uploadBuffer({buffer:media.buffer,mime:media.mime,postId:job.post_id,kind:'image'});
    await patch('campaign_generation_jobs','id=eq.' + encodeURIComponent(job.id),{
      status:'completed',result_url:stored.public_url,storage_path:stored.storage_path,completed_at:new Date().toISOString()
    });
    await patch('campaign_posts','id=eq.' + encodeURIComponent(job.post_id),{
      image_provider:'xai',image_job_id:job.id,image_url:stored.public_url,image_storage_path:stored.storage_path,
      image_status:'review',image_error:null,status:'image_review'
    });
  } catch (error) {
    // A failed or ambiguous paid POST is never automatically retried.
    const status = /timeout|abort/i.test(String(error.message||'')) ? 'unknown':'failed';
    await patch('campaign_generation_jobs','id=eq.' + encodeURIComponent(job.id),{
      status,error:String(error.message||error).slice(0,2000),completed_at:new Date().toISOString()
    }).catch(()=>null);
    await patch('campaign_posts','id=eq.' + encodeURIComponent(job.post_id),{
      image_status:'failed',image_error:String(error.message||error).slice(0,2000),status:'prepared'
    }).catch(()=>null);
  }
}
async function imageSource(post) {
  if (post.image_storage_path) return mediaStore.downloadBuffer(post.image_storage_path);
  if (!post.image_url) throw engineError('Image validée introuvable.',409);
  const url = new URL(post.image_url);
  const extra = String(process.env.CAMPAIGN_MEDIA_HOSTS || '').split(',').map(v=>v.trim()).filter(Boolean);
  const allowed = ['media.base44.com','imgen.x.ai',new URL(process.env.SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co').hostname,...extra];
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowed.some(h=>h===url.hostname || (h.startsWith('*.')&&url.hostname.endsWith(h.slice(1))))) {
    throw engineError('Hôte de l’image validée non autorisé.',403);
  }
  const response = await fetch(url.href,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw engineError('Image validée inaccessible.',502);
  const buffer=Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length>14*1024*1024) throw engineError('Image validée trop volumineuse.',413);
  return {buffer,mime:String(response.headers.get('content-type')||'image/jpeg').split(';')[0]};
}
async function runApiVideoSubmit(job) {
  try {
    const payload=jsonValue(job.payload,{});
    const post=await one('campaign_posts',job.post_id,job.organisation_id);
    if (!post) throw engineError('Contenu vidéo introuvable.',404);
    const source=await imageSource(post);
    const dataUrl='data:'+source.mime+';base64,'+source.buffer.toString('base64');
    const result=await xai('/videos/generations',{
      model:XAI_VIDEO_MODEL,prompt:payload.prompt,image:{url:dataUrl},
      duration:payload.duration_seconds || 8,resolution:'720p',
      ...(XAI_VIDEO_MODEL === 'grok-imagine-video-1.5' ? {generate_audio:false}:{})
    });
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(result.request_id || '')) throw engineError('Réponse xAI sans identifiant vidéo. Ne pas relancer automatiquement.',502);
    await patch('campaign_generation_jobs','id=eq.'+encodeURIComponent(job.id),{
      status:'submitted',provider_job_id:result.request_id
    });
  } catch(error) {
    const status=/timeout|abort/i.test(String(error.message||''))?'unknown':'failed';
    await patch('campaign_generation_jobs','id=eq.'+encodeURIComponent(job.id),{
      status,error:String(error.message||error).slice(0,2000),completed_at:new Date().toISOString()
    }).catch(()=>null);
    await patch('campaign_posts','id=eq.'+encodeURIComponent(job.post_id),{
      video_status:'failed',video_error:String(error.message||error).slice(0,2000),status:'image_approved'
    }).catch(()=>null);
  }
}
async function pollApiVideo(job) {
  try {
    const result=await xai('/videos/'+encodeURIComponent(job.provider_job_id));
    if (result.status === 'done') {
      if (result.video?.respect_moderation === false || !result.video?.url) throw engineError('Génération vidéo refusée ou vide.',422);
      const downloaded=await downloadProvider(result.video.url,'video');
      const stored=await mediaStore.uploadBuffer({buffer:downloaded.buffer,mime:downloaded.mime,postId:job.post_id,kind:'video'});
      await patch('campaign_generation_jobs','id=eq.'+encodeURIComponent(job.id),{
        status:'completed',result_url:stored.public_url,storage_path:stored.storage_path,completed_at:new Date().toISOString()
      });
      await patch('campaign_posts','id=eq.'+encodeURIComponent(job.post_id),{
        video_provider:'xai',video_job_id:job.id,video_status:'completed',video_url:stored.public_url,
        video_storage_path:stored.storage_path,video_error:null,status:'video_review'
      });
    } else if (['failed','expired'].includes(result.status)) {
      throw engineError('xAI a terminé sans vidéo exploitable ('+result.status+').',422);
    } else {
      await patch('campaign_generation_jobs','id=eq.'+encodeURIComponent(job.id),{status:'submitted'});
    }
  } catch(error) {
    if (/HTTP 5|timeout|abort/i.test(String(error.message||''))) return;
    await markJobFailed(job,error);
  }
}
async function startImageGeneration({ postId,org,userId,allowPaidApi=false }) {
  const {post,brand,context}=await bundle(postId,org);
  const prompt=post.image_prompt || brandPrompt(context,post.brief||post.title,'image');
  const desired=post.image_engine || brand.image_engine || 'auto';
  const local=desired==='local'||desired==='auto' ? await activeWorker({userId,org,kind:'image',brand}) : null;
  if (local) {
    const job=await createJob({org,userId,postId:post.id,kind:'image',engine:'local',provider:'comfyui',payload:{
      prompt,format:formatForPost(post),checkpoint:local.checkpoint,worker_id:local.worker.id
    }});
    if(job.reused)return {engine:job.engine,job,reused:true};
    await patch('campaign_posts','id=eq.'+encodeURIComponent(post.id),{
      image_provider:'local',image_job_id:job.id,image_status:'queued',image_error:null,image_prompt:prompt,status:'prepared'
    });
    return {engine:'local',job,worker:{id:local.worker.id,name:local.worker.name}};
  }
  if (desired==='local') throw engineError('Moteur image local indisponible ou aucun checkpoint compatible.',503,'LOCAL_ENGINE_UNAVAILABLE');
  const apiAllowed=desired==='api'||brand.fallback_image_to_api===true;
  if (!apiAllowed) throw engineError('Moteur local indisponible et fallback image API désactivé.',503,'LOCAL_ENGINE_UNAVAILABLE');
  if (!allowPaidApi) throw engineError('La génération image xAI est payante et nécessite une confirmation.',409,'PAID_API_CONFIRMATION_REQUIRED');
  const job=await createJob({org,userId,postId:post.id,kind:'image',engine:'api',provider:'xai',paidConsent:true,payload:{prompt,format:formatForPost(post)}});
  if(job.reused)return {engine:job.engine,job,reused:true};
  await patch('campaign_posts','id=eq.'+encodeURIComponent(post.id),{
    image_provider:'xai',image_job_id:job.id,image_status:'generating',image_error:null,image_prompt:prompt,status:'prepared'
  });
  void runApiImage(job);
  return {engine:'api',job};
}
async function approveAndStartVideo({ postId,org,userId,allowPaidApi=false }) {
  const {post,brand,context}=await bundle(postId,org);
  if (!post.image_url || !['review','approved'].includes(post.image_status)) throw engineError('Aucune image validable pour lancer la vidéo.',409);
  if (post.image_status==='review') {
    await patch('campaign_posts','id=eq.'+encodeURIComponent(post.id),{
      image_status:'approved',image_approved_at:new Date().toISOString(),status:'image_approved'
    });
  }
  const prompt=post.video_prompt || brandPrompt(context,post.brief||post.title,'video');
  const desired=post.video_engine || brand.video_engine || 'auto';
  const local=desired==='local'||desired==='auto' ? await activeWorker({userId,org,kind:'video',brand}) : null;
  if (local) {
    const job=await createJob({org,userId,postId:post.id,kind:'video',engine:'local',provider:'comfyui',payload:{
      prompt,format:formatForPost(post),duration_seconds:8,workflow_id:local.workflow_id,worker_id:local.worker.id
    }});
    if(job.reused)return {engine:job.engine,job,reused:true};
    await patch('campaign_posts','id=eq.'+encodeURIComponent(post.id),{
      video_provider:'local',video_job_id:job.id,video_status:'queued',video_error:null,video_prompt:prompt,status:'video_generating'
    });
    return {engine:'local',job,worker:{id:local.worker.id,name:local.worker.name}};
  }
  if (desired==='local') throw engineError('Moteur vidéo local indisponible ou aucun workflow compatible.',503,'LOCAL_ENGINE_UNAVAILABLE');
  const apiAllowed=desired==='api'||brand.fallback_to_api===true;
  if (!apiAllowed) throw engineError('Moteur local indisponible et fallback vidéo API désactivé.',503,'LOCAL_ENGINE_UNAVAILABLE');
  if (!allowPaidApi) throw engineError('La génération vidéo xAI est payante et nécessite une confirmation.',409,'PAID_API_CONFIRMATION_REQUIRED');
  const job=await createJob({org,userId,postId:post.id,kind:'video',engine:'api',provider:'xai',paidConsent:true,payload:{prompt,format:formatForPost(post),duration_seconds:8}});
  if(job.reused)return {engine:job.engine,job,reused:true};
  await patch('campaign_posts','id=eq.'+encodeURIComponent(post.id),{
    video_provider:'xai',video_job_id:job.id,video_status:'generating',video_error:null,video_prompt:prompt,status:'video_generating'
  });
  void runApiVideoSubmit(job);
  return {engine:'api',job};
}
async function schedulerTick() {
  if (schedulerBusy) return;
  schedulerBusy=true;
  try {
    const rows=await crm('campaign_generation_jobs?engine=eq.api&kind=eq.video&status=eq.submitted&order=updated_at.asc&limit=20');
    for (const job of rows||[]) if (job.provider_job_id) await pollApiVideo(job);
    const stale=await crm('campaign_generation_jobs?engine=eq.api&status=eq.submitting&updated_at=lt.'+encodeURIComponent(new Date(Date.now()-10*60*1000).toISOString())+'&limit=20');
    for (const job of stale||[]) {
      await patch('campaign_generation_jobs','id=eq.'+encodeURIComponent(job.id),{
        status:'unknown',error:'Soumission payante interrompue ou résultat inconnu. Relance automatique interdite.'
      });
    }
  } finally { schedulerBusy=false; }
}
function startCampaignGenerationScheduler() {
  if (scheduler) return {started:false,reason:'already_started'};
  scheduler=setInterval(()=>void schedulerTick().catch(e=>console.error('[campaign-engine]',e.message)),10000);
  scheduler.unref?.();
  void schedulerTick().catch(e=>console.error('[campaign-engine]',e.message));
  return {started:true,interval_ms:10000};
}

module.exports={ startImageGeneration,approveAndStartVideo,startCampaignGenerationScheduler,activeWorker,formatForPost,engineError,activeJob };