import path from 'node:path';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';

const POLL_MS = 5000;
const HEARTBEAT_MS = 15000;

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function safeCloud(value){
  const url=new URL(String(value||''));
  const dev=/^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  if(url.protocol!=='https:'&&!dev)throw new Error('campaign_worker_cloud_url_invalid');
  if(!dev&&url.hostname!=='cockpit.jsinnovia.com')throw new Error('campaign_worker_cloud_host_not_allowed');
  url.pathname='';url.search='';url.hash='';return url.toString().replace(/\/$/,'');
}
function validToken(value){return /^[A-Za-z0-9_-]{32,200}$/.test(String(value||''));}
function validUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));}

export function createCampaignWorker({root,port,localToken=''}) {
  const configPath=path.join(root,'campaign-worker.json');
  const state={configured:false,running:false,active_job:null,last_error:null,last_heartbeat:null,last_poll:null,worker_id:null,cloud_url:null};
  let config=null;let stopped=false;let loopPromise=null;

  async function persist(value){
    await mkdir(path.dirname(configPath),{recursive:true});
    const temp=configPath+'.tmp';
    await writeFile(temp,JSON.stringify(value),'utf8');
    await rename(temp,configPath);
  }
  async function load(){
    try{
      const value=JSON.parse(await readFile(configPath,'utf8'));
      if(!validUuid(value.worker_id)||!validToken(value.token))throw new Error('invalid_config');
      config={worker_id:value.worker_id,token:value.token,cloud_url:safeCloud(value.cloud_url)};
      state.configured=true;state.worker_id=config.worker_id;state.cloud_url=config.cloud_url;
    }catch{config=null;state.configured=false;state.worker_id=null;state.cloud_url=null;}
  }
  async function configure(body={}){
    const next={worker_id:String(body.worker_id||''),token:String(body.token||''),cloud_url:safeCloud(body.cloud_url||'https://cockpit.jsinnovia.com')};
    if(!validUuid(next.worker_id)||!validToken(next.token))throw Object.assign(new Error('campaign_worker_pairing_invalid'),{status:400});
    await persist(next);config=next;state.configured=true;state.worker_id=next.worker_id;state.cloud_url=next.cloud_url;state.last_error=null;
    if(!loopPromise)loopPromise=loop();
    return status();
  }
  function status(){return {...state,token:undefined};}
  async function local(pathname,options={}){
    const response=await fetch('http://127.0.0.1:'+port+pathname,{
      ...options,
      headers:{...(localToken?{Authorization:'Bearer '+localToken}:{}),...(options.headers||{})},
      signal:options.signal||AbortSignal.timeout(120000)
    });
    return response;
  }
  async function cloud(pathname,options={}){
    if(!config)throw new Error('campaign_worker_not_configured');
    const response=await fetch(config.cloud_url+pathname,{
      ...options,
      headers:{Authorization:'Bearer '+config.token,...(options.headers||{})},
      signal:options.signal||AbortSignal.timeout(120000)
    });
    return response;
  }
  async function localJson(pathname,body){
    const response=await local(pathname,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||data.details||('local_http_'+response.status));
    return data;
  }
  async function heartbeat(){
    const capsResponse=await local('/api/music-motion/production/capabilities');
    const caps=await capsResponse.json().catch(()=>({}));
    if(!capsResponse.ok)throw new Error(caps.error||'local_capabilities_unavailable');
    const response=await cloud('/api/campaign-worker/heartbeat',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({version:'1.7.0',capabilities:caps})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||('worker_heartbeat_'+response.status));
    state.last_heartbeat=new Date().toISOString();
  }
  async function failRemote(jobId,error){
    await cloud('/api/campaign-worker/jobs/'+encodeURIComponent(jobId)+'/fail',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({error:String(error?.message||error).slice(0,1800)})
    }).catch(()=>null);
  }
  async function execute(job){
    state.active_job=job.id;
    try{
      let sourceId='';
      if(job.source_required){
        const source=await cloud('/api/campaign-worker/jobs/'+encodeURIComponent(job.id)+'/source');
        if(!source.ok)throw new Error((await source.json().catch(()=>({}))).error||'campaign_source_unavailable');
        const blob=await source.blob();
        const uploaded=await local('/api/music-motion/production/assets?name='+encodeURIComponent('campaign-'+job.id+'.jpg'),{
          method:'POST',headers:{'Content-Type':blob.type||'image/jpeg'},body:blob,signal:AbortSignal.timeout(120000)
        });
        const asset=await uploaded.json().catch(()=>({}));
        if(!uploaded.ok||!asset.id)throw new Error(asset.error||'local_source_upload_failed');
        sourceId=asset.id;
      }
      const payload=job.payload||{};
      const input={
        request_id:'cw-'+job.id,
        type:job.kind,
        prompt:String(payload.prompt||''),
        format:payload.format||'9:16',
        ...(job.kind==='image'?{checkpoint:payload.checkpoint}:{workflow_id:payload.workflow_id,duration_seconds:Number(payload.duration_seconds||8),source_id:sourceId})
      };
      const created=await localJson('/api/music-motion/production/jobs',input);
      let current=created;
      const deadline=Date.now()+25*60*1000;
      while(!['completed','failed','cancelled'].includes(current.status)&&Date.now()<deadline){
        await sleep(3000);
        const response=await local('/api/music-motion/production/jobs/'+encodeURIComponent(created.id),{signal:AbortSignal.timeout(30000)});
        current=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(current.error||'local_job_poll_failed');
      }
      if(current.status!=='completed'||!current.result?.id)throw new Error(current.error||'local_generation_failed');
      const output=await local('/api/music-motion/production/assets/'+encodeURIComponent(current.result.id),{signal:AbortSignal.timeout(120000)});
      if(!output.ok)throw new Error('local_result_download_failed');
      const resultBlob=await output.blob();
      const sent=await cloud('/api/campaign-worker/jobs/'+encodeURIComponent(job.id)+'/result',{
        method:'POST',headers:{'Content-Type':resultBlob.type||current.result.mime||'application/octet-stream'},body:resultBlob,signal:AbortSignal.timeout(180000)
      });
      if(!sent.ok)throw new Error((await sent.json().catch(()=>({}))).error||'campaign_result_upload_failed');
    }catch(error){
      state.last_error=String(error.message||error).slice(0,1000);
      await failRemote(job.id,error);
    }finally{state.active_job=null;}
  }
  async function pollOnce(){
    state.last_poll=new Date().toISOString();
    const response=await cloud('/api/campaign-worker/jobs/next',{signal:AbortSignal.timeout(30000)});
    if(response.status===204)return;
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||('worker_poll_'+response.status));
    if(data.job)await execute(data.job);
  }
  async function loop(){
    state.running=true;let lastBeat=0;
    while(!stopped){
      try{
        if(!config){await load();if(!config){await sleep(POLL_MS);continue;}}
        if(Date.now()-lastBeat>=HEARTBEAT_MS){await heartbeat();lastBeat=Date.now();}
        await pollOnce();state.last_error=null;
      }catch(error){state.last_error=String(error.message||error).slice(0,1000);}
      await sleep(POLL_MS);
    }
    state.running=false;
  }
  async function start(){await load();if(!loopPromise)loopPromise=loop();return status();}
  function stop(){stopped=true;}
  return {configure,status,start,stop};
}
