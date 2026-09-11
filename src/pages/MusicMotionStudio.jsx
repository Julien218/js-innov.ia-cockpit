import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Download, Film, ImagePlus, Loader2, Save, Sparkles, Upload, Undo2 } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import TimelinePreview from '@/components/music-motion/TimelinePreview';
import { useAuth } from '@/lib/AuthContext';
import { downloadBlob } from '@/lib/fileDownload';
import { newProject, uid, timeLabel, finite, analysisReady, createScenesFromAnalysis, splitScenes, intervalIssues, renderIssues, coverage, scenePrompt, validateAction } from '@/lib/music-motion/model';
import { importProjectZip, verifyImportedMedia, importStoryboardJson, exportProjectZip, makeAsset, probeMedia, dataUrl, saveProject, listProjects, loadProject, makeLocalClient, cloudJson, cloudMedia } from '@/lib/music-motion/io';

const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed';
const input = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
const panel = 'rounded-xl border border-border bg-card p-4 space-y-3';
const terminal = ['completed','failed','cancelled','paused_tracking'];
const labels = { analyze:'Analyse intégrale', image:'Image', video:'Animation', render:'Rendu' };
function Field({ label, children }) { return <label className="block space-y-1 text-xs text-muted-foreground"><span>{label}</span>{children}</label>; }
function Pick({ label, accept, multiple, onFiles, disabled }) { return <label className={button+(disabled?' pointer-events-none opacity-40':' cursor-pointer')}><Upload className="w-4 h-4" />{label}<input className="sr-only" type="file" accept={accept} multiple={multiple} disabled={disabled} onChange={e=>{const f=[...(e.target.files||[])];e.target.value='';if(f.length)onFiles(f);}} /></label>; }

export default function MusicMotionStudio() {
  const { user } = useAuth(); const scope = user?.id || user?.email;
  const [project, setProject] = useState(newProject);
  const [projectScope,setProjectScope] = useState(scope);
  const current = useRef(project), blobs = useRef(new Map()), urlStore = useRef(new Map()), localIds = useRef(new Map());
  const [mediaVersion, setMediaVersion] = useState(0), [selected, select] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [token, setToken] = useState(''), [caps, setCaps] = useState(null), [cloud, setCloud] = useState(null);
  const [provider,setProvider] = useState('local'), [checkpoint,setCheckpoint] = useState(''), [workflow,setWorkflow] = useState('');
  const [referenceId,setReferenceId] = useState(''), [instrumental,setInstrumental] = useState(false), [prompt,setPrompt] = useState('');
  const [pendingImport,setPendingImport] = useState(null), [paid,setPaid] = useState(null), [saved,setSaved] = useState('Non enregistré'), [library,setLibrary] = useState([]);
  const [cursor,setCursor] = useState(0), [lastRender,setLastRender] = useState('');
  const audioRef = useRef(null), undo = useRef([]), polling = useRef(false);
  const local = useMemo(()=>makeLocalClient(token),[token]);
  const localRef = useRef(local); localRef.current=local; current.current=project;
  const scene=project.scenes.find(s=>s.id===selected)||project.scenes[0];
  const shots=project.shots.filter(s=>s.scene_id===scene?.id), progress=coverage(project);
  const acoustic=project.analysis?.transcription?.acoustic;
  const ready=analysisReady(project);
  const urls = useMemo(()=>new Map(urlStore.current),[mediaVersion]);
  const change=useCallback((transform,{history=false}={})=>{
    setProject(previous=>{if(history){undo.current.push({scenes:structuredClone(previous.scenes),shots:structuredClone(previous.shots),direction:structuredClone(previous.direction)});undo.current=undo.current.slice(-15);}const next=typeof transform==='function'?transform(previous):transform;current.current={...next,updated_at:new Date().toISOString()};return current.current;});
  },[]);
  const attempt=async(fn)=>{setBusy(true);try{await fn();}catch(e){setNotice(e.message || 'Opération impossible.');}finally{setBusy(false);}};
  function putBlob(asset,blob){blobs.current.set(asset.id,blob);const old=urlStore.current.get(asset.id);if(old)URL.revokeObjectURL(old);urlStore.current.set(asset.id,URL.createObjectURL(blob));setMediaVersion(v=>v+1);}
  const uploadLocal=async(id,p=current.current)=>{
    const asset=p.assets.find(a=>a.id===id), blob=blobs.current.get(id);if(!asset||!blob)throw new Error('Média source introuvable.');
    const key=asset.sha256+':'+token;if(localIds.current.has(key))return localIds.current.get(key);
    const uploaded=await local.upload(blob,asset.name);localIds.current.set(key,uploaded.id);return uploaded.id;
  };
  useEffect(()=>()=>{for(const url of urlStore.current.values())URL.revokeObjectURL(url);},[]);
  useEffect(()=>{if(projectScope!==scope){installProject(newProject(),new Map());setProjectScope(scope);setLibrary([]);}},[scope,projectScope]);
  useEffect(()=>{if(!scope)return;listProjects(scope).then(setLibrary).catch(e=>setNotice(e.message));},[scope]);
  useEffect(()=>{
    if(!scope||projectScope!==scope)return;
    setSaved('Enregistrement…');const timer=setTimeout(()=>{saveProject(scope,project,blobs.current).then(()=>setSaved('Enregistré sur ce navigateur')).catch(e=>{setSaved('Sauvegarde échouée');setNotice('Sauvegarde locale : '+e.message+' Exportez le ZIP pour sécuriser le projet.');});},1800);
    return()=>clearTimeout(timer);
  },[project,scope,projectScope]);
  useEffect(()=>{const handler=e=>{if(current.current.jobs.some(j=>!terminal.includes(j.status))){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[]);
  function installProject(next,map){
    for(const url of urlStore.current.values())URL.revokeObjectURL(url);
    blobs.current=new Map();urlStore.current=new Map();localIds.current.clear();undo.current=[];
    for(const a of next.assets)if(map.has(a.id))putBlob(a,map.get(a.id));
    select(next.scenes[0]?.id||'');setLastRender(next.assets.filter(a=>a.role==='render').at(-1)?.id||'');setCursor(0);change(next);
  }
  async function ingest(files,role,{sceneId,shotId}={}) {
    const baseId=current.current.id;
    for(const file of files){const {asset,blob}=await makeAsset(file,role);Object.assign(asset,await probeMedia(blob));if(current.current.id!==baseId)throw new Error('Le projet a changé pendant l’import.');
      if(role==='audio'&&!(asset.duration_seconds>0))throw new Error('Durée audio impossible à vérifier.');
      putBlob(asset,blob);
      change(p=>({...p,assets:[...p.assets,asset],...(role==='audio'?{audio:{asset_id:asset.id,name:asset.name,sha256:asset.sha256,duration_seconds:asset.duration_seconds},analysis:null,review:{lyrics:false,storyboard:false},title:p.title==='Nouveau clip'?asset.name.replace(/\.[^.]+$/,''):p.title}:{}),
        scenes:p.scenes.map(s=>s.id===sceneId&&!s.locked?{...s,keyframe_id:asset.id}:s),
        shots:p.shots.map(s=>s.id===shotId&&!s.locked?{...s,...(role==='video'?{video_id:asset.id}:{image_id:asset.id})}:s)}));
      if(role==='reference')setReferenceId(asset.id);
      if(role==='logo')change(p=>({...p,render:{...p.render,logo_id:asset.id}}));
      if(role==='document'){
        change(p=>({...p,sources:[...p.sources,{asset_id:asset.id,name:asset.name,text:'',warning:'Document importé, non analysé.'}]}));
        try{const uploaded=await local.upload(blob,asset.name);const id=uploaded.id;localIds.current.set(asset.sha256+':'+token,id);const text=await local.json('/pdf',{asset_id:id});change(p=>({...p,sources:p.sources.map(s=>s.asset_id===asset.id?{...s,text:text.text||'',warning:text.warning||'Document source non validé ; son contenu ne remplace pas l’analyse audio.'}:s)}));}
        catch(e){setNotice('PDF conservé. Extraction locale indisponible : '+e.message);}
      }
    }
  }
  async function checkEngines(){const result=await Promise.allSettled([local.json('/capabilities'),cloudJson('/capabilities')]);if(result[0].status==='fulfilled'){setCaps(result[0].value);setCheckpoint(c=>c||result[0].value.checkpoints?.[0]||'');setWorkflow(w=>w||result[0].value.video_workflows?.find(v=>v.available)?.id||'');}else{setCaps(null);setNotice(result[0].reason.message);}if(result[1].status==='fulfilled')setCloud(result[1].value);else setCloud({available:false,warning:result[1].reason.message});}
  async function queue(input,meta={},paidConsent=false){
    const p=current.current, id=uid('job');
    const wire={...input,request_id:id};const target=paidConsent?'xai':'local';
    // Keep the id before sending: a lost HTTP response must not trigger a duplicate paid POST.
    const tracked={id,provider:target,type:input.type,status:'queued',applied:false,source_sha256:p.audio?.sha256,...meta};
    const scheduled={...p,jobs:[...p.jobs,tracked],updated_at:new Date().toISOString()};
    change(scheduled);
    if(scope)await saveProject(scope,scheduled,blobs.current);
    try{const result=paidConsent?await cloudJson('/jobs',{...wire,consent:{paid:true,external_transfer:true,one_request:true}}):await local.json('/jobs',wire);change(v=>v.id===p.id?{...v,jobs:v.jobs.map(j=>j.id===id?{...j,status:result.status,stage:result.stage}:j)}:v);}
    catch(e){change(v=>({...v,jobs:v.jobs.map(j=>j.id===id?{...j,status:e.status&&e.status<500?'failed':'submission_unknown',error:e.message}:j)}));throw new Error('Soumission non confirmée : '+e.message+' L’identifiant est conservé ; aucun nouvel essai automatique.');}
  }
  async function analyze(){const p=current.current;if(!p.audio)throw new Error('Importez la chanson complète.');await queue({type:'analyze',audio_id:await uploadLocal(p.audio.asset_id),instrumental});}
  async function generate(kind,s,shot){
    const p=current.current;if(!s)throw new Error('Sélectionnez une scène.');if(s.locked||shot?.locked)throw new Error('Élément verrouillé.');
    if(kind==='video'&&!shot)throw new Error('Découpez la scène en plans puis choisissez le plan à animer.');
    const sourceId=kind==='image'?(referenceId||s.keyframe_id):(shot.image_id||s.keyframe_id);
    if(!sourceId)throw new Error('Sélectionnez une référence visuelle ou une image de départ.');
    const seconds=shot?Math.ceil(shot.end-shot.start):null;if(kind==='video'&&(!seconds||seconds>15))throw new Error('Le plan doit durer de 1 à 15 secondes.');
    const text=scenePrompt(p,s,shot,kind), meta={scene_id:s.id,shot_id:shot?.id||''};
    if(provider==='xai'){
      if(!cloud?.available)throw new Error('L’API payante n’est pas disponible. Vérifiez les moteurs.');
      setPaid({projectId:p.id,sourceId,input:{type:kind,prompt:text,format:p.direction.format,duration_seconds:seconds},meta});return;
    }
    if(kind==='image'&&!checkpoint)throw new Error('Choisissez un checkpoint installé.');if(kind==='video'&&!workflow)throw new Error('Aucun workflow vidéo local configuré. Importez une vidéo ou configurez le moteur.');
    await queue({type:kind,prompt:text,source_id:await uploadLocal(sourceId),checkpoint,workflow_id:workflow,duration_seconds:seconds,format:p.direction.format},meta);
  }
  async function render(animatic){const p=current.current;const errors=renderIssues(p,{animatic});if(errors.length)throw new Error(errors.slice(0,5).join(' '));
    const audio_id=await uploadLocal(p.audio.asset_id);const plan=[];
    for(const s of p.shots)plan.push({...s,asset_id:await uploadLocal(s.video_id||(animatic?s.image_id:''))});
    const logo_id=p.render.logo_id?await uploadLocal(p.render.logo_id):'';
    await queue({type:'render',audio_id,analysis_job_id:p.analysis.local_job_id,shots:plan,duration_seconds:p.audio.duration_seconds,fps:p.render.fps,height:p.render.height,format:p.direction.format,animatic,logo_id,lyrics_validated:p.review.lyrics,subtitles:p.render.subtitles,segments:p.render.subtitles?p.analysis.transcription?.segments:[]});
  }
  useEffect(()=>{
    let disposed=false;
    async function poll(){if(polling.current||disposed)return;polling.current=true;
      try{const snapshot=current.current;
        for(const tracked of snapshot.jobs.filter(j=>!terminal.includes(j.status)||(j.status==='completed'&&!j.applied))){
          if(disposed||current.current.id!==snapshot.id)break;
          try{const result=tracked.provider==='local'?await localRef.current.json('/jobs/'+tracked.id):await cloudJson('/jobs/'+tracked.id);
            if(disposed||current.current.id!==snapshot.id)break;
            if(result.status==='completed'&&!tracked.applied){
              if(tracked.type==='analyze'){
                if(result.result.audio?.sha256!==current.current.audio?.sha256){setNotice('L’analyse concerne une ancienne source. Résultat non appliqué.');}
                else change(p=>({...p,analysis:{...result.result,local_job_id:tracked.id},review:{lyrics:false,storyboard:false}}));
              }else{
                const output=result.result.asset||result.result;const remoteId=output.id;
                const blob=tracked.provider==='local'?await localRef.current.media(remoteId):await cloudMedia(tracked.id);
                const {asset}=await makeAsset(new File([blob],output.name||'media.mp4',{type:blob.type}),tracked.type==='render'?'render':tracked.type==='video'?'video':'keyframe');
                Object.assign(asset,await probeMedia(blob));if(disposed||current.current.id!==snapshot.id)break;putBlob(asset,blob);
                if(tracked.provider==='local')localIds.current.set(asset.sha256+':'+token,remoteId);
                change(p=>({...p,assets:[...p.assets,asset],scenes:p.scenes.map(s=>s.id===tracked.scene_id&&tracked.type==='image'&&!s.locked?{...s,keyframe_id:asset.id}:s),shots:p.shots.map(s=>s.id===tracked.shot_id&&!s.locked?{...s,...(tracked.type==='video'?{video_id:asset.id}:{image_id:asset.id})}:s)}));
                if(tracked.type==='render')setLastRender(asset.id);
              }
            }
            change(p=>({...p,jobs:p.jobs.map(j=>j.id===tracked.id?{...j,status:result.status,stage:result.stage||'',error:result.error||'',progress:result.progress||0,applied:result.status==='completed'||j.applied}:j)}));
          }catch(e){setNotice('Suivi de tâche : '+e.message+' Aucune nouvelle génération n’a été déclenchée.');}
        }
      }finally{polling.current=false;}
    }
    const timer=setInterval(poll,3000);return()=>{disposed=true;clearInterval(timer);};
  },[local,change,token]);
  function editScene(patch){if(!scene||scene.locked)return;change(p=>({...p,review:{...p.review,storyboard:false},scenes:p.scenes.map(s=>s.id===scene.id?{...s,...patch}:s)}),{history:true});}
  function editShot(id,patch){change(p=>({...p,review:{...p.review,storyboard:false},shots:p.shots.map(s=>s.id===id&&!s.locked?{...s,...patch}:s)}),{history:true});}
  async function applyAction(raw){const p=current.current,a=validateAction(raw,p);
    if(a.type==='storyboard'){
      if(!analysisReady(p))throw new Error('L’analyse complète doit précéder le storyboard.');
      if(p.scenes.some(s=>s.locked))throw new Error('Déverrouillez les scènes avant de remplacer le storyboard.');
      if(p.scenes.length&&!window.confirm('Remplacer les scènes et les plans ? Les médias restent conservés dans la bibliothèque.'))return;
      const scenes=createScenesFromAnalysis(a.sections?{...p,analysis:{...p.analysis,creative_plan:{sections:a.sections}}}:p);
      change(v=>({...v,scenes,shots:[],review:{...v.review,storyboard:false}}),{history:true});select(scenes[0]?.id||'');
    }else if(a.type==='split'){
      if(p.shots.some(s=>s.locked))throw new Error('Des plans sont verrouillés.');
      if(p.shots.length&&!window.confirm('Redécouper les plans ? Les anciennes vidéos resteront dans la bibliothèque.'))return;
      change(v=>({...v,shots:splitScenes(v,8),review:{...v.review,storyboard:false}}),{history:true});
    }else if(a.type==='update_scene')change(v=>({...v,scenes:v.scenes.map(s=>s.id===a.scene_id?{...s,...a.patch}:s),review:{...v.review,storyboard:false}}),{history:true});
    else if(a.type==='preview')await render(true);
    else await generate(a.type==='generate_image'?'image':'video',p.scenes.find(s=>s.id===a.scene_id),p.shots.find(s=>s.id===a.shot_id));
  }
  async function chat(){const p=current.current;if(!prompt.trim())return;const message=prompt;setPrompt('');change(v=>({...v,messages:[...v.messages,{role:'user',text:message}]}));
    const reply=await local.json('/chat',{message,context:{title:p.title,direction:p.direction,duration_seconds:p.audio?.duration_seconds,analysis_complete:analysisReady(p),sections:acoustic?.sections||[],lyrics_reference:p.direction.lyrics_reference||'',lyrics:(p.analysis?.transcription?.segments||[]).map(s=>({start:s.start,end:s.end,text:s.text})),scenes:p.scenes,shots:p.shots.map(s=>({id:s.id,scene_id:s.scene_id,start:s.start,end:s.end,locked:s.locked})),sources:p.sources.map(s=>({name:s.name,text:s.text.slice(0,10000)})),recent_messages:p.messages.slice(-6)}});
    if(current.current.id!==p.id)return;
    change(v=>({...v,messages:[...v.messages,{role:'assistant',text:reply.message,actions:reply.actions||[]}]}));
  }
  function downloadSourceAudio(){const p=current.current;const audioFile=blobs.current.get(p.audio?.asset_id);if(!audioFile)throw new Error('La chanson originale n’est pas disponible dans ce projet.');downloadBlob(audioFile,p.audio.name||'chanson-originale.wav');}
  async function exportAll(){const file=await exportProjectZip(current.current,blobs.current);downloadBlob(file,`${current.current.title.replace(/[^\w.-]/g,'_')}-elynea.zip`);}

  return <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-5">
    <PageHeader title="Elynea Music Motion Studio" subtitle="Une chanson complète. Un storyboard vivant. Un montage vérifiable." actions={<><button className={button} disabled={busy} onClick={()=>attempt(exportAll)}><Download className="w-4 h-4"/>Exporter le projet ZIP</button><button className={button} disabled={!scope||busy} onClick={()=>attempt(async()=>{await saveProject(scope,current.current,blobs.current);setSaved('Enregistré sur ce navigateur');setLibrary(await listProjects(scope));})}><Save className="w-4 h-4"/>Enregistrer</button></>} />
    {notice&&<div role="status" className="border rounded-lg px-4 py-3 bg-muted text-sm flex justify-between gap-3"><span>{notice}</span><button aria-label="Fermer le message" onClick={()=>setNotice('')}>×</button></div>}
    {busy&&<p className="text-sm flex gap-2 items-center" role="status"><Loader2 className="w-4 h-4 animate-spin"/>Opération en cours…</p>}
    <section className={panel}>
      <div className="grid md:grid-cols-3 gap-3"><Field label="Nom du projet"><input className={input} value={project.title} onChange={e=>change(p=>({...p,title:e.target.value}))}/></Field><Field label="Mes projets locaux"><select className={input} value="" onChange={e=>{const id=e.target.value;if(id)attempt(async()=>{if(current.current.jobs.some(j=>!terminal.includes(j.status)))throw new Error('Attendez les tâches en cours avant de changer de projet.');const p=await loadProject(scope,id);installProject(p.project,p.blobs);});}}><option value="">Ouvrir un projet enregistré…</option>{library.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></Field><div className="text-xs text-muted-foreground self-end pb-2">{saved}<br/>Le ZIP est la sauvegarde portable avec tous les médias.</div></div>
      <div className="flex flex-wrap gap-2"><Pick label="Chanson complète" accept="audio/*,.m4a,.flac" disabled={busy} onFiles={f=>attempt(()=>ingest(f,'audio'))}/><Pick label="Importer un pack ZIP" accept=".zip" disabled={busy} onFiles={f=>attempt(async()=>setPendingImport(await verifyImportedMedia(await importProjectZip(f[0]))))}/><Pick label="Storyboard JSON" accept="application/json,.json" disabled={busy} onFiles={f=>attempt(async()=>{if(project.scenes.some(s=>s.locked))throw new Error('Des scènes sont verrouillées.');if(project.scenes.length&&!window.confirm('Remplacer les scènes et les plans par ce storyboard ?'))return;const r=await importStoryboardJson(f[0],current.current);change(p=>({...p,scenes:r.scenes,shots:[],sources:[...p.sources,r.source],review:{...p.review,storyboard:false}}),{history:true});select(r.scenes[0]?.id||'');})}/><Pick label="PDF d’analyse / storyboard" accept=".pdf" disabled={busy} onFiles={f=>attempt(()=>ingest(f,'document'))}/><Pick label="Références de marque" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onFiles={f=>attempt(()=>ingest(f,'reference'))}/><Pick label="Logo réel" accept="image/png,image/webp" disabled={busy} onFiles={f=>attempt(()=>ingest(f,'logo'))}/></div>
      {project.audio&&<button className={button} disabled={busy} onClick={()=>attempt(downloadSourceAudio)}><Download className="w-4 h-4"/>Télécharger la source audio originale</button>}
      {project.sources.length>0&&<details><summary className="text-sm cursor-pointer">Sources importées ({project.sources.length}) — conservées séparément de l’analyse</summary>{project.sources.map(s=><div key={s.asset_id||s.name} className="mt-2 text-xs"><a href={urls.get(s.asset_id)} target="_blank" rel="noreferrer" className="underline">{s.name}</a><p>{s.warning}</p><pre className="whitespace-pre-wrap max-h-36 overflow-auto text-muted-foreground">{s.text}</pre></div>)}</details>}
    </section>
    <section className={panel}>
      <div className="flex justify-between gap-3 flex-wrap"><h2 className="font-semibold flex gap-2"><AudioLines className="w-5 h-5"/>Analyse intégrale de la source</h2><span className={'text-sm '+(ready?'text-emerald-600':'text-amber-600')}>{ready?'Décodage et analyse acoustique complets':'Analyse intégrale non validée'}</span></div>
      <div className="flex flex-wrap gap-3 items-center"><button className={button} disabled={busy||!project.audio||project.jobs.some(j=>j.type==='analyze'&&!terminal.includes(j.status))} onClick={()=>attempt(analyze)}>Analyser toute la chanson</button><label className="text-sm"><input type="checkbox" checked={instrumental} onChange={e=>setInstrumental(e.target.checked)}/> Morceau instrumental — sans transcription</label><span className="text-xs text-muted-foreground">{project.audio?.name||'Aucune source audio'} · {timeLabel(project.audio?.duration_seconds)}</span></div>
      {acoustic&&<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm"><p>Traitement : <strong>{timeLabel(acoustic.coverage?.processed_seconds)}</strong></p><p>Tempo estimé : <strong>{Number.isFinite(acoustic.bpm)?acoustic.bpm.toFixed(1)+' BPM':'indéterminé'}</strong></p><p>Pulsations détectées : <strong>{acoustic.beat_times?.length||0}</strong></p><p>Sections proposées : <strong>{acoustic.sections?.length||0}</strong></p></div>}
      {(project.analysis?.warnings||[]).map((w,i)=><p key={i} className="text-xs text-amber-600">{w}</p>)}
      {project.analysis&&<p className="text-xs text-muted-foreground">100 % traité ne signifie pas 100 % certain. Les sections, tonalités et paroles restent des propositions à vérifier.</p>}
      <Field label="Paroles originales (référence facultative, non alignée automatiquement)"><textarea className={input} rows={3} value={project.direction.lyrics_reference||''} onChange={e=>change(p=>({...p,direction:{...p.direction,lyrics_reference:e.target.value}}))}/></Field>
      <details><summary className="text-sm cursor-pointer">Paroles et timecodes · écouter, corriger, valider</summary><div className="max-h-64 overflow-auto space-y-2 mt-3">{(project.analysis?.transcription?.segments||[]).map((s,i)=><div key={i} className="grid grid-cols-[70px_1fr] gap-2"><button className="text-xs underline" onClick={()=>{if(audioRef.current){audioRef.current.currentTime=s.start;setCursor(s.start);}}}>{timeLabel(s.start)}</button><input aria-label={'Paroles '+(i+1)} className={input} value={s.text} onChange={e=>change(p=>({...p,review:{...p.review,lyrics:false},analysis:{...p.analysis,transcription:{...p.analysis.transcription,segments:p.analysis.transcription.segments.map((v,j)=>j===i?{...v,text:e.target.value,user_edited:true}:v)}}}))}/></div>)}</div><label className="block text-sm mt-3"><input type="checkbox" checked={project.review.lyrics} disabled={!project.analysis?.transcription?.segments?.length} onChange={e=>change(p=>({...p,review:{...p.review,lyrics:e.target.checked}}))}/> J’ai réécouté et validé les paroles pour les sous-titres.</label></details>
    </section>
    <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] gap-5 items-start">
      <div className="space-y-5">
        <section className={panel}><h2 className="font-semibold">Direction et moteurs</h2><Field label="Brief visuel global"><textarea className={input} rows={4} value={project.direction.brief} onChange={e=>change(p=>({...p,direction:{...p.direction,brief:e.target.value}}))}/></Field>
          <div className="grid sm:grid-cols-2 gap-3"><Field label="Direction de réalisation"><select className={input} value={project.direction.mode} onChange={e=>change(p=>({...p,direction:{...p.direction,mode:e.target.value}}))}><option value="cinematic">Cinématographique</option><option value="advertising">Marque / publicité</option><option value="auto">Proposition automatique</option><option value="custom">Personnalisée</option><option value="dance">Dansée</option></select></Field><label className="text-sm self-end pb-3"><input type="checkbox" checked={project.direction.dance_allowed} onChange={e=>change(p=>({...p,direction:{...p.direction,dance_allowed:e.target.checked}}))}/> Autoriser une proposition dansée</label><Field label="Format du montage"><select className={input} value={project.direction.format} onChange={e=>change(p=>({...p,direction:{...p.direction,format:e.target.value}}))}>{['16:9','9:16','1:1'].map(v=><option key={v}>{v}</option>)}</select></Field><Field label="Moteur de génération"><select className={input} value={provider} onChange={e=>setProvider(e.target.value)}><option value="local">Local · ComfyUI</option><option value="xai">API · Grok / xAI (payant)</option></select></Field></div>
          <Field label="Référence d’identité utilisée pour les nouvelles images"><select className={input} value={referenceId} onChange={e=>setReferenceId(e.target.value)}><option value="">Choisir une référence…</option>{project.assets.filter(a=>a.mime.startsWith('image/')&&a.role!=='logo').map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          {referenceId&&urls.get(referenceId)&&<img className="h-24 object-contain rounded" src={urls.get(referenceId)} alt="Référence d’identité sélectionnée"/>}
          <details><summary className="text-sm cursor-pointer">Connexion locale et capacités réelles</summary><div className="mt-3 space-y-3"><Field label="Jeton de l’agent local, si configuré (non sauvegardé)"><input className={input} type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)}/></Field><button className={button} onClick={()=>attempt(checkEngines)} disabled={busy}>Vérifier les moteurs</button><p className="text-xs">Analyse locale : {caps?.analysis?'outils disponibles':'à vérifier'} · Transcription : {caps?.transcription?'bibliothèque présente':'à vérifier'} · Montage : {caps?.render?'FFmpeg présent':'à vérifier'} · Tchat : {caps?.ollama?'Ollama joignable':'à vérifier'}</p><p className="text-xs text-amber-600">{cloud?.warning}</p></div></details>
          {provider==='local'&&<><Field label="Checkpoint image installé"><select className={input} value={checkpoint} onChange={e=>setCheckpoint(e.target.value)}><option value="">Vérifier les moteurs pour charger la liste…</option>{(caps?.checkpoints||[]).map(v=><option key={v}>{v}</option>)}</select></Field><Field label="Workflow vidéo local approuvé sur ce poste"><select className={input} value={workflow} onChange={e=>setWorkflow(e.target.value)}><option value="">Aucun workflow choisi</option>{(caps?.video_workflows||[]).map(v=><option key={v.id} value={v.id} disabled={!v.available}>{v.label}{v.available?'':' · nœuds manquants'}</option>)}</select></Field><p className="text-xs text-muted-foreground">Aucun téléchargement de modèle ni bascule payante automatique. Un workflow absent bloque la vidéo, pas l’import de médias existants.</p></>}
        </section>
        <section className={panel}><h2 className="font-semibold flex gap-2"><Sparkles className="w-5 h-5"/>Tchat de réalisation Elynea</h2><div className="max-h-80 overflow-auto space-y-3" aria-live="polite">{project.messages.length===0&&<p className="text-sm text-muted-foreground">Demandez un storyboard basé sur l’analyse, la modification d’une scène ou la génération d’un plan. Les propositions s’appliquent avec les boutons ci-dessous, sans dépense cachée.</p>}{project.messages.map((m,i)=><div key={i} className="rounded-lg bg-muted p-3"><p className="text-xs font-semibold mb-1">{m.role==='user'?'Vous':'Elynea'}</p><p className="text-sm whitespace-pre-wrap">{m.text}</p><div className="flex flex-wrap gap-2 mt-2">{(m.actions||[]).map((a,j)=><button className={button} key={j} disabled={busy} onClick={()=>attempt(()=>applyAction(a))}>Appliquer : {a.type.replaceAll('_',' ')}</button>)}</div></div>)}</div><textarea className={input} rows={3} value={prompt} placeholder="Propose un storyboard couvrant toute la chanson, sans modifier les scènes verrouillées…" onChange={e=>setPrompt(e.target.value)} /><button className={button} disabled={busy||!prompt.trim()} onClick={()=>attempt(chat)}>Envoyer à Elynea locale</button></section>
      </div>
      <div className="space-y-5">
        <TimelinePreview project={project} urls={urls} audioRef={audioRef} cursor={cursor} setCursor={setCursor}/>
        <section className={panel}><div className="flex flex-wrap gap-2 justify-between"><h2 className="font-semibold">Storyboard · scènes artistiques</h2><button className={button} disabled={busy||!ready} onClick={()=>attempt(()=>applyAction({type:'storyboard'}))}>Créer depuis l’analyse</button></div>
          <div className="flex flex-wrap gap-2">{project.scenes.map((s,i)=><button className={button+(s.id===scene?.id?' bg-primary/10 border-primary':'')} key={s.id} onClick={()=>select(s.id)}>{String(i+1).padStart(2,'0')} · {timeLabel(s.start)}</button>)}</div>
          {scene?<><Field label="Scène"><input className={input} disabled={scene.locked} value={scene.label} onChange={e=>editScene({label:e.target.value})}/></Field><div className="grid grid-cols-2 gap-2"><Field label="Début (secondes)"><input className={input} type="number" step="0.01" min="0" value={scene.start} disabled={scene.locked} onChange={e=>editScene({start:Number(e.target.value)})}/></Field><Field label="Fin (secondes)"><input className={input} type="number" step="0.01" value={scene.end} disabled={scene.locked} onChange={e=>editScene({end:Number(e.target.value)})}/></Field></div>
          <Field label="Prompt de l’image-clé"><textarea className={input} rows={3} disabled={scene.locked} value={scene.image_prompt} onChange={e=>editScene({image_prompt:e.target.value})}/></Field><Field label="Action et caméra · prompt vidéo"><textarea className={input} rows={4} disabled={scene.locked} value={scene.prompt} onChange={e=>editScene({prompt:e.target.value})}/></Field>
          {scene.keyframe_id&&<img className="w-full max-h-64 object-contain rounded-lg bg-black" src={urls.get(scene.keyframe_id)} alt={scene.label}/>}
          <div className="flex flex-wrap gap-2"><button className={button} disabled={busy||scene.locked} onClick={()=>attempt(()=>generate('image',scene))}><ImagePlus className="w-4 h-4"/>Générer cette image</button><Pick label="Importer son image" accept="image/png,image/jpeg,image/webp" disabled={busy||scene.locked} onFiles={f=>attempt(()=>ingest(f,'keyframe',{sceneId:scene.id}))}/><button className={button} onClick={()=>change(p=>({...p,scenes:p.scenes.map(s=>s.id===scene.id?{...s,locked:!s.locked}:s)}))}>{scene.locked?'Déverrouiller':'Verrouiller la scène'}</button><button className={button} onClick={()=>downloadBlob(new Blob([scenePrompt(project,scene,null,'image')+'\n\nANIMATION\n'+scene.prompt],{type:'text/plain;charset=utf-8'}),`scene-${scene.id}.txt`)}>Prompts complets</button></div></>:<p className="text-sm text-muted-foreground">Importez votre pack ou préparez les scènes après l’analyse intégrale. Aucun découpage arbitraire n’est ajouté.</p>}
          <div className="flex gap-2 flex-wrap"><button className={button} disabled={busy||!project.scenes.length} onClick={()=>attempt(()=>applyAction({type:'split'}))}>Découper en plans ≤ 8 s</button><button className={button} disabled={!undo.current.length} onClick={()=>{const previous=undo.current.pop();if(previous)change(p=>({...p,...previous,review:{...p.review,storyboard:false}}));}}><Undo2 className="w-4 h-4"/>Annuler une modification</button></div>
        </section>
      </div>
    </div>
    <section className={panel}><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">Plans modulables · {scene?.label||'sélectionner une scène'}</h2><span className="text-sm">Vraie vidéo disponible : {progress.percent}% · manque {timeLabel(progress.missing)}</span></div><progress className="w-full h-2" max="100" value={progress.percent}/>
      {shots.map((s,i)=><article key={s.id} className="border rounded-lg p-3 space-y-3"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">Plan {i+1} · {timeLabel(s.start)} → {timeLabel(s.end)}</strong><button className="text-xs underline" onClick={()=>change(p=>({...p,shots:p.shots.map(v=>v.id===s.id?{...v,locked:!v.locked}:v)}))}>{s.locked?'Déverrouiller':'Verrouiller'}</button></div>
        <div className="grid sm:grid-cols-4 gap-2"><Field label="Début"><input className={input} type="number" step="0.01" disabled={s.locked} value={s.start} onChange={e=>editShot(s.id,{start:Number(e.target.value)})}/></Field><Field label="Fin"><input className={input} type="number" step="0.01" disabled={s.locked} value={s.end} onChange={e=>editShot(s.id,{end:Number(e.target.value)})}/></Field><Field label="Entrée dans la vidéo"><input className={input} type="number" step="0.01" min="0" disabled={s.locked} value={s.source_in} onChange={e=>editShot(s.id,{source_in:Number(e.target.value)})}/></Field><Field label="Raccord"><select className={input} disabled={s.locked} value={s.transition} onChange={e=>editShot(s.id,{transition:e.target.value})}><option value="cut">Coupe franche</option><option value="fade">Fondu par le noir</option></select></Field></div>
        <Field label="Prompt propre à ce plan"><textarea className={input} rows={2} disabled={s.locked} value={s.prompt} onChange={e=>editShot(s.id,{prompt:e.target.value})}/></Field>
        <div className="grid sm:grid-cols-3 gap-2"><Field label="Image de départ"><select className={input} value={s.image_id||scene?.keyframe_id||''} disabled={s.locked} onChange={e=>editShot(s.id,{image_id:e.target.value})}><option value="">Aucune image</option>{project.assets.filter(a=>a.mime.startsWith('image/')).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field><Field label="Vidéo retenue"><select className={input} value={s.video_id} disabled={s.locked} onChange={e=>editShot(s.id,{video_id:e.target.value})}><option value="">Vidéo à produire</option>{project.assets.filter(a=>a.mime.startsWith('video/')&&a.role!=='render').map(a=><option key={a.id} value={a.id}>{a.name} · {timeLabel(a.duration_seconds)}</option>)}</select></Field><Field label="Cadrage"><select className={input} value={s.fit} disabled={s.locked} onChange={e=>editShot(s.id,{fit:e.target.value})}><option value="contain">Tout conserver</option><option value="cover">Remplir / recadrer</option></select></Field></div>
        <div className="flex gap-2 flex-wrap"><button className={button} disabled={busy||s.locked||scene?.locked} onClick={()=>attempt(()=>generate('video',scene,s))}><Film className="w-4 h-4"/>Animer ce plan</button><Pick label="Importer la vidéo" accept="video/mp4,video/webm,video/quicktime" disabled={busy||s.locked} onFiles={f=>attempt(()=>ingest(f,'video',{shotId:s.id}))}/><button className={button} onClick={()=>{if(audioRef.current){audioRef.current.currentTime=s.start;setCursor(s.start);}}}>Écouter à ce repère</button></div>
      </article>)}
      {shots.length===0&&<p className="text-sm text-muted-foreground">Chaque scène doit être découpée en plusieurs plans avant de couvrir une chanson entière.</p>}
    </section>
    <section className={panel}><h2 className="font-semibold">Validation et export du clip</h2>
      <label className="block text-sm"><input type="checkbox" checked={project.review.storyboard} onChange={e=>attempt(async()=>{if(e.target.checked){const errors=[...intervalIssues(project.scenes,finite(project.audio?.duration_seconds),{label:'Scène'}),...intervalIssues(project.shots,finite(project.audio?.duration_seconds))];if(errors.length)throw new Error(errors.slice(0,4).join(' '));}change(p=>({...p,review:{...p.review,storyboard:e.target.checked}}));})}/> J’ai validé les plans, leurs timecodes et la continuité du personnage.</label>
      <div className="grid sm:grid-cols-4 gap-2"><Field label="Cadence"><select className={input} value={project.render.fps} onChange={e=>change(p=>({...p,render:{...p.render,fps:Number(e.target.value)}}))}>{[24,25,30].map(v=><option key={v} value={v}>{v} images/s</option>)}</select></Field><Field label="Définition de sortie"><select className={input} value={project.render.height} onChange={e=>change(p=>({...p,render:{...p.render,height:Number(e.target.value)}}))}><option value="720">720p</option><option value="1080">1080p</option></select></Field><Field label="Logo ajouté en postproduction"><select className={input} value={project.render.logo_id} onChange={e=>change(p=>({...p,render:{...p.render,logo_id:e.target.value}}))}><option value="">Aucun logo</option>{project.assets.filter(a=>a.role==='logo').map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field><label className="text-sm self-end pb-3"><input type="checkbox" checked={project.render.subtitles} onChange={e=>change(p=>({...p,render:{...p.render,subtitles:e.target.checked}}))}/> Sous-titres validés</label></div>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>attempt(()=>render(true))}>Rendre une animatique (images autorisées)</button><button className={button+' bg-primary/10'} disabled={busy} onClick={()=>attempt(()=>render(false))}>Rendre le clip vidéo final</button></div>
      <p className="text-xs text-muted-foreground">Le rendu utilise FFmpeg sur votre poste. La chanson originale reste la piste maîtresse. Une animatique est explicitement identifiée et ne remplace jamais une génération vidéo.</p>
      {lastRender&&<><video src={urls.get(lastRender)} controls className="w-full max-h-[480px] bg-black rounded-lg"/><button className={button} onClick={()=>downloadBlob(blobs.current.get(lastRender),project.title.replace(/[^\w.-]/g,'_')+'.mp4')}><Download className="w-4 h-4"/>Enregistrer le rendu MP4</button></>}
    </section>
    <details className={panel} open={project.jobs.some(j=>!terminal.includes(j.status))}><summary className="cursor-pointer font-semibold">Historique des traitements ({project.jobs.length})</summary>{project.jobs.slice().reverse().map(j=><div className="border-b py-2 text-sm space-y-1" key={j.id}><p>{labels[j.type]||j.type} · {j.provider} · <strong>{j.status}</strong></p><p className="text-xs text-muted-foreground">{j.stage} {j.error}</p>{j.status==='submission_unknown'&&<button className="text-xs underline mr-3" onClick={()=>change(p=>({...p,jobs:p.jobs.map(v=>v.id===j.id?{...v,status:'paused_tracking',stage:'Suivi en pause. Vérifier le fournisseur avant toute nouvelle génération.'}:v)}))}>Mettre le suivi en pause, sans relancer</button>}{j.status==='paused_tracking'&&<button className="text-xs underline" onClick={()=>change(p=>({...p,jobs:p.jobs.map(v=>v.id===j.id?{...v,status:'submitted'}:v)}))}>Reprendre seulement le suivi</button>}{j.provider==='local'&&!terminal.includes(j.status)&&<button className="text-xs underline" onClick={()=>attempt(async()=>{const result=await local.json('/jobs/'+j.id+'/cancel',{});change(p=>({...p,jobs:p.jobs.map(v=>v.id===j.id?{...v,status:result.status,error:result.error}:v)}));})}>Arrêter le suivi / traitement local</button>}</div>)}</details>
    {pendingImport&&<div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"><section role="dialog" aria-modal="true" aria-labelledby="import-title" className="bg-card rounded-xl p-6 max-w-xl w-full space-y-4"><h2 id="import-title" className="font-semibold">Prévisualisation de l’import</h2><p>{pendingImport.project.scenes.length} scènes · {pendingImport.project.assets.length} médias · {pendingImport.project.shots.length} plans</p>{pendingImport.warnings.map((w,i)=><p className="text-sm text-amber-600" key={i}>{w}</p>)}<p className="text-sm">L’import remplace le projet affiché, pas ses sauvegardes. Le PDF et le storyboard ne valident pas l’analyse audio.</p><div className="flex gap-2"><button className={button} onClick={()=>attempt(async()=>{if(current.current.jobs.some(j=>!terminal.includes(j.status)))throw new Error('Attendez la fin des tâches avant de changer de projet.');if(scope)await saveProject(scope,current.current,blobs.current);installProject(pendingImport.project,pendingImport.blobs);setPendingImport(null);})}>Importer ce projet</button><button className={button} onClick={()=>setPendingImport(null)}>Annuler</button></div></section></div>}
    {paid&&<div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"><section role="dialog" aria-modal="true" aria-labelledby="paid-title" className="bg-card rounded-xl p-6 max-w-lg space-y-4"><h2 id="paid-title" className="font-semibold">Autoriser une génération payante ?</h2><p className="text-sm">Une seule demande {paid.input.type==='video'?'vidéo de '+paid.input.duration_seconds+' secondes':'image'} sera envoyée à xAI avec le prompt et l’image sélectionnée. Aucun audio n’est envoyé. Le prix réel dépend de votre compte fournisseur : aucun montant n’a été vérifié ici.</p><p className="text-sm">Aucune relance payante automatique, même en cas d’erreur ou de timeout. Le plafond serveur porte sur le nombre de demandes, pas sur un budget en euros.</p><div className="flex gap-2"><button className={button} disabled={busy} onClick={()=>attempt(async()=>{const request=paid;setPaid(null);if(current.current.id!==request.projectId)throw new Error('Le projet a changé.');await queue({...request.input,image_data_url:await dataUrl(blobs.current.get(request.sourceId))},request.meta,true);})}>Autoriser cette demande</button><button className={button} onClick={()=>setPaid(null)}>Annuler</button></div></section></div>}
  </div>;
}
