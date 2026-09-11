/** Local media operations: opaque asset IDs, bounded files, no shell or ZIP scripts. */
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, writeFile, rename, readdir, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';

export const MAX_ASSET_BYTES = 256 * 1024 * 1024;
export const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
export function checkedId(id) { if (!idPattern.test(String(id || ''))) throw Object.assign(new Error('Identifiant invalide.'), { status: 400 }); return String(id); }
export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export async function atomicJson(file, value) { await mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.${crypto.randomUUID()}.tmp`; await writeFile(tmp, JSON.stringify(value)); await rename(tmp, file); }
export function detectMedia(bytes, name = '') {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return ['image/png','png'];
  if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return ['image/jpeg','jpg'];
  if (bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') return ['image/webp','webp'];
  if (bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WAVE') return ['audio/wav','wav'];
  if (bytes.toString('ascii',4,8)==='ftyp') return ext==='m4a' ? ['audio/mp4','m4a'] : ['video/mp4','mp4'];
  if (bytes.toString('ascii',0,4)==='fLaC') return ['audio/flac','flac'];
  if (bytes.toString('ascii',0,4)==='OggS') return ['audio/ogg','ogg'];
  if (bytes.toString('ascii',0,3)==='ID3' || (bytes[0]===255 && (bytes[1]&0xe0)===0xe0)) return ['audio/mpeg','mp3'];
  if (bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) return ['video/webm','webm'];
  if (bytes.toString('ascii',0,5)==='%PDF-') return ['application/pdf','pdf'];
  throw fail('Format média non reconnu. Aucun fichier exécutable n’est accepté.');
}
export class Workspace {
  constructor(root) { this.root = path.resolve(root); }
  async init() { await Promise.all(['assets','jobs','work'].map(d=>mkdir(path.join(this.root,d),{recursive:true}))); return this; }
  async putAsset(bytes, name) {
    if (!bytes.length || bytes.length>MAX_ASSET_BYTES) throw fail('Média vide ou supérieur à 256 Mo.',413);
    const [mime,ext] = detectMedia(bytes,name), id=crypto.randomUUID();
    const metadata={id,name:path.basename(String(name || `media.${ext}`)).slice(0,240),mime,bytes:bytes.length,sha256:digest(bytes),file:`${id}.${ext}`};
    await writeFile(path.join(this.root,'assets',metadata.file),bytes,{flag:'wx'}); await atomicJson(path.join(this.root,'assets',`${id}.json`),metadata); return metadata;
  }
  async asset(id) { checkedId(id); let item; try { item=JSON.parse(await readFile(path.join(this.root,'assets',`${id}.json`),'utf8')); } catch(e) { if(e.code==='ENOENT') throw fail('Média local introuvable.',404); throw e; } if(!new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\.[a-z0-9]+$`).test(item.file)) throw fail('Métadonnées média invalides.'); return {...item,path:path.join(this.root,'assets',item.file)}; }
  async job(id) { checkedId(id); try{return JSON.parse(await readFile(path.join(this.root,'jobs',`${id}.json`),'utf8'));}catch(e){if(e.code==='ENOENT')throw fail('Tâche introuvable.',404);throw e;} }
  async saveJob(job) { job.updated_at=new Date().toISOString(); await atomicJson(path.join(this.root,'jobs',`${checkedId(job.id)}.json`),job); return job; }
  async createJob(input) {
    const id=checkedId(input.request_id || crypto.randomUUID());
    const signature=digest(Buffer.from(JSON.stringify(input)));
    try { const old=await this.job(id); if(old.signature!==signature) throw fail('Identifiant déjà utilisé pour une autre demande.',409); return {job:old,created:false}; } catch(e) {if(e.status!==404)throw e;}
    const job={id,signature,type:input.type,status:'queued',input,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
    // Exclusive creation protects double-clicks even before the in-process queue lock.
    try { await writeFile(path.join(this.root,'jobs',`${id}.json`),JSON.stringify(job),{flag:'wx'}); return {job,created:true}; }
    catch(e) { if(e.code!=='EEXIST')throw e; const old=await this.job(id); if(old.signature!==signature)throw fail('Conflit de demande.',409); return {job:old,created:false}; }
  }
  async recover() {
    for(const file of await readdir(path.join(this.root,'jobs'))) {
      if(!file.endsWith('.json'))continue; const job=await this.job(file.slice(0,-5));
      if(['queued','running','submitted'].includes(job.status) && !job.provider_request_id) await this.saveJob({...job,status:'failed',error:'Agent redémarré pendant le traitement. Aucune génération payante n’a été relancée automatiquement.'});
    }
  }
}
export function run(command, args, {cwd, timeout=120000, signal, maxBytes=20*1024*1024}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});
    const stdout=[],stderr=[];let size=0,errSize=0,finished=false;
    const timer=setTimeout(()=>{child.kill();finish(fail('Délai du traitement dépassé.',504));},timeout);
    const abort=()=>{child.kill();finish(fail('Traitement annulé.',409));};
    function finish(error){if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve({stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr).toString()});}
    if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){child.kill();finish(fail('Sortie du traitement trop volumineuse.',413));}else stdout.push(chunk);});
    child.stderr.on('data',chunk=>{if(errSize<20000){stderr.push(chunk.subarray(0,20000-errSize));errSize+=chunk.length;}});
    child.on('error',finish); child.on('close',code=>finish(code===0?null:fail(Buffer.concat(stderr).toString().slice(-2000)||`Échec du processus (${code}).`,422)));
  });
}
export async function probe(file) {
  const {stdout}=await run(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]);
  const value=JSON.parse(stdout); const video=value.streams?.find(s=>s.codec_type==='video'),audio=value.streams?.find(s=>s.codec_type==='audio');
  const duration=Number(value.format?.duration || video?.duration || audio?.duration || 0);
  return {duration_seconds:duration,width:Number(video?.width||0),height:Number(video?.height||0),has_video:Boolean(video),has_audio:Boolean(audio),sample_rate:Number(audio?.sample_rate||0),channels:Number(audio?.channels||0)};
}
export function validateRender(spec, assetMeta) {
  const duration=Number(spec.duration_seconds),fps=Number(spec.fps||25);
  if(!Number.isFinite(duration)||duration<=0||duration>1800||![24,25,30].includes(fps))throw fail('Durée ou cadence de rendu invalide.');
  if(!Array.isArray(spec.shots)||!spec.shots.length||spec.shots.length>2000)throw fail('Plans absents ou trop nombreux.');
  let frame=0;
  const shots=[...spec.shots].sort((a,b)=>a.start-b.start).map(s=>{
    const begin=Math.round(Number(s.start)*fps),end=Math.round(Number(s.end)*fps),media=assetMeta.get(s.asset_id);
    if(!Number.isFinite(begin)||!Number.isFinite(end)||begin!==frame||end<=begin||end>Math.round(duration*fps))throw fail('La timeline contient un trou, un chevauchement ou une durée invalide.');
    if(!media)throw fail('Un média du montage est introuvable.');
    if(media.mime.startsWith('image/') && spec.animatic!==true)throw fail('Une image fixe ne remplace pas une vidéo. Choisir explicitement une animatique.');
    if(!media.mime.startsWith('image/')&&!media.mime.startsWith('video/'))throw fail('Type de média interdit dans le montage.');
    const source=Number(s.source_in||0);if(!Number.isFinite(source)||source<0)throw fail('Point d’entrée vidéo invalide.');
    if(media.mime.startsWith('video/') && (!media.has_video || source+(end-begin)/fps>media.duration_seconds+1/fps))throw fail('Une vidéo est plus courte que le plan demandé.');
    frame=end;return {...s,frames:end-begin,seconds:(end-begin)/fps,source_in:source};
  });
  if(frame!==Math.round(duration*fps))throw fail('Les plans ne couvrent pas toute la chanson.');
  return {duration,fps,shots};
}
function srtTime(t){const ms=Math.max(0,Math.round(Number(t)*1000));return `${Math.floor(ms/3600000).toString().padStart(2,'0')}:${Math.floor(ms/60000)%60}`.replace(/:(\d)$/,'\:0$1')+`:${(Math.floor(ms/1000)%60).toString().padStart(2,'0')},${(ms%1000).toString().padStart(3,'0')}`;}
export function makeSrt(segments,duration) { return (Array.isArray(segments)?segments:[]).filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&s.end>s.start&&s.end<=duration+0.05&&s.text).map((s,i)=>`${i+1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${String(s.text).replace(/[<>]/g,'').replace(/\r?\n/g,' ').slice(0,1500)}\n`).join('\n'); }
export async function renderMovie(workspace, spec, {signal,onStage=async()=>{}}={}) {
  const source=await workspace.asset(spec.audio_id),audio=await probe(source.path);
  if(!audio.has_audio)throw fail('La source ne contient pas de piste audio.');
  if(Math.abs(audio.duration_seconds-Number(spec.duration_seconds))>0.25)throw fail('Durée de la source différente du montage. Réanalyser la chanson.');
  const meta=new Map();for(const s of spec.shots||[])if(!meta.has(s.asset_id)){const a=await workspace.asset(s.asset_id);meta.set(s.asset_id,{...a,...(a.mime.startsWith('video/')?await probe(a.path):{})});}
  const {duration,fps,shots}=validateRender(spec,meta);
  const h=spec.height===1080?1080:720;const sizes={'16:9':[h*16/9,h],'9:16':[h,h*16/9],'1:1':[h,h]};const [w,height]=(sizes[spec.format]||sizes['16:9']).map(n=>Math.round(n/2)*2);
  const work=path.join(workspace.root,'work',crypto.randomUUID());await mkdir(work,{recursive:true});
  const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg'; const preset=process.env.MUSIC_MOTION_FFMPEG_PRESET||'fast';
  try{
    for(const [i,s] of shots.entries()){
      await onStage(`Encodage du plan ${i+1}/${shots.length}`,i/shots.length*0.8);
      const media=meta.get(s.asset_id);const output=path.join(work,`part-${String(i).padStart(5,'0')}.mp4`);
      const fit=s.fit==='cover'?`scale=${w}:${height}:force_original_aspect_ratio=increase,crop=${w}:${height}`:`scale=${w}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${w}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
      const fade=Math.min(.2,s.seconds/4);const transitions=s.transition==='fade'?`,fade=t=in:st=0:d=${fade},fade=t=out:st=${s.seconds-fade}:d=${fade}`:'';
      const input=media.mime.startsWith('image/')?['-loop','1','-framerate',String(fps),'-i',media.path]:['-ss',String(s.source_in),'-i',media.path];
      await run(ffmpeg,['-hide_banner','-loglevel','error','-y',...input,'-an','-vf',`${fit},setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=${1/fps}${transitions}`,'-frames:v',String(s.frames),'-c:v','libx264','-preset',preset,'-crf','19','-pix_fmt','yuv420p','-threads','2',output],{cwd:work,timeout:600000,signal});
    }
    await onStage('Assemblage et ajout de la chanson originale',.85);
    await writeFile(path.join(work,'parts.txt'),shots.map((_,i)=>`file 'part-${String(i).padStart(5,'0')}.mp4'`).join('\n'));
    const args=['-hide_banner','-loglevel','error','-y','-f','concat','-safe','1','-i',path.join(work,'parts.txt'),'-i',source.path];
    const filters=[];let video='0:v';let filterCount=0;
    if(spec.subtitles){if(!spec.lyrics_validated)throw fail('Paroles non validées pour les sous-titres.');const content=makeSrt(spec.segments,duration);if(!content)throw fail('Aucun sous-titre horodaté valide.');await writeFile(path.join(work,'captions.srt'),content);filters.push(`[${video}]subtitles=filename=captions.srt[v${++filterCount}]`);video=`v${filterCount}`;}
    if(spec.logo_id){const logo=await workspace.asset(spec.logo_id);if(!logo.mime.startsWith('image/'))throw fail('Logo image requis.');args.push('-i',logo.path);filters.push(`[2:v]scale=${Math.round(w*.16/2)*2}:-2[brand]`);filters.push(`[${video}][brand]overlay=${Math.round(w*.04)}:${Math.round(height*.06)}:enable='gte(t,${Math.max(0,duration-4)})'[v${++filterCount}]`);video=`v${filterCount}`;}
    if(filters.length)args.push('-filter_complex',filters.join(';'),'-map',`[${video}]`,'-c:v','libx264','-preset',preset,'-crf','19');else args.push('-map','0:v:0','-c:v','copy');
    args.push('-map','1:a:0','-c:a','aac','-b:a','256k','-t',String(duration),'-movflags','+faststart',path.join(work,'result.mp4'));
    await run(ffmpeg,args,{cwd:work,timeout:600000,signal});
    const final=await probe(path.join(work,'result.mp4'));
    if(!final.has_video||!final.has_audio||Math.abs(final.duration_seconds-duration)>Math.max(.12,2/fps))throw fail('Contrôle du rendu final échoué : durée, image ou audio incorrect.',422);
    if((await stat(path.join(work,'result.mp4'))).size>MAX_ASSET_BYTES)throw fail('Rendu supérieur à 256 Mo ; réduire la résolution ou segmenter le projet.',413);
    const result=await workspace.putAsset(await readFile(path.join(work,'result.mp4')),spec.animatic?'animatique.mp4':'clip-final.mp4');
    return {...result,...final,kind:spec.animatic?'animatic':'assembled-video',audio_sha256:source.sha256};
  }finally{await rm(work,{recursive:true,force:true});}
}
