/** Portable, provider-independent project model. No media URL or credential is persisted. */
export const SCHEMA = 'elynea.music-motion/2';
export const uid = (prefix = 'id') => `${prefix}-${globalThis.crypto.randomUUID()}`;
export const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const round = (n) => Math.round(n * 1000) / 1000;
const text = (v, max = 16000) => String(v ?? '').slice(0, max);
const safeId = (v) => /^[a-zA-Z0-9_-]{1,100}$/.test(String(v || '')) ? String(v) : '';
export const DEFAULT_BRIEF = 'Univers JS-Innov.IA cinématographique, bleu nuit, or, cyan et violet. La référence de la mascotte prime sur le texte : conserver son visage, son casque, son micro, ses ailes et ses proportions. Aucun texte ni faux logo généré. La technologie accompagne l’humain.';
export function newProject() {
  const now = new Date().toISOString();
  return { schema_version: SCHEMA, id: uid('project'), title: 'Nouveau clip', created_at: now, updated_at: now,
    audio: null, direction: { brief: DEFAULT_BRIEF, lyrics_reference: '', mode: 'cinematic', dance_allowed: false, format: '16:9' },
    analysis: null, scenes: [], shots: [], assets: [], sources: [], messages: [], jobs: [],
    review: { lyrics: false, storyboard: false }, render: { fps: 25, height: 720, logo_id: '', subtitles: false }, revisions: [] };
}
export function timeLabel(value) {
  const s = Math.max(0, finite(value));
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
}
export function parseTime(value) {
  const source = String(value || '').trim().replace(',', '.');
  if (!source) return NaN;
  if (/^\d+(?:\.\d+)?$/.test(source)) return Number(source);
  if (!/^\d{1,3}:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(source)) return NaN;
  const parts = source.split(':').map(Number);
  if (parts.slice(1).some(v => v >= 60)) return NaN;
  return parts.reduce((n, v) => n * 60 + v, 0);
}
export function intervalIssues(items, duration, { tolerance = 0.045, label = 'Plan' } = {}) {
  const issues = [];
  if (!(duration > 0)) return ['La durée réelle de la chanson est inconnue.'];
  let cursor = 0;
  const seen = new Set();
  for (const [i, item] of [...items].sort((a, b) => finite(a.start) - finite(b.start)).entries()) {
    const name = `${label} ${item.label || i + 1}`;
    if (seen.has(item.id)) issues.push(`${name} : identifiant dupliqué.`);
    seen.add(item.id);
    if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end <= item.start || item.end > duration + tolerance) {
      issues.push(`${name} : intervalle invalide.`); continue;
    }
    if (item.start > cursor + tolerance) issues.push(`Trou entre ${timeLabel(cursor)} et ${timeLabel(item.start)}.`);
    if (item.start < cursor - tolerance) issues.push(`${name} chevauche le plan précédent.`);
    cursor = Math.max(cursor, item.end);
  }
  if (cursor < duration - tolerance) issues.push(`La fin manque : ${timeLabel(cursor)} → ${timeLabel(duration)}.`);
  return issues;
}
export function analysisReady(project) {
  const a = project.analysis;
  const c = a?.transcription?.acoustic?.coverage || a?.acoustic?.coverage;
  const hash = a?.audio?.sha256 || a?.source_sha256;
  const duration = finite(project.audio?.duration_seconds);
  return Boolean(project.audio?.asset_id && project.audio?.sha256 && hash === project.audio.sha256 && c?.complete === true &&
    c.decoded_seconds >= duration - Math.max(0.12, duration * 0.001) && c.processed_seconds >= c.decoded_seconds - 0.05);
}
export function createScenesFromAnalysis(project) {
  if (!analysisReady(project)) throw new Error('Analyse acoustique intégrale de cette source requise. Aucun découpage fictif ne sera créé.');
  const a = project.analysis;
  const duration = project.audio.duration_seconds;
  let sections = a.creative_plan?.sections;
  if (!Array.isArray(sections) || !sections.length || intervalIssues(sections, duration).length) {
    sections = (a.transcription?.acoustic || a.acoustic)?.sections;
  }
  if (!Array.isArray(sections) || !sections.length || intervalIssues(sections, duration).length) {
    throw new Error('Les sections ne couvrent pas le morceau. Validez ou corrigez les repères avant de construire le storyboard.');
  }
  return sections.map((s, i) => ({ id: uid('scene'), type: text(s.type || 'section', 60), label: text(s.label || `Section ${i + 1} · à qualifier`, 160),
    start: round(s.start), end: round(s.end), motion: text(s.motion), prompt: text(s.prompt), image_prompt: text(s.image_prompt || s.prompt),
    negative_prompt: 'Aucun texte ni faux logo, pas de morphing du personnage, pas de membres supplémentaires.',
    keyframe_id: '', locked: false, dance: project.direction.dance_allowed && Boolean(s.dance), provenance: 'analysis-proposal' }));
}
export function splitScenes(project, maximum = 8) {
  const duration = finite(project.audio?.duration_seconds);
  const problems = intervalIssues(project.scenes, duration, { label: 'Scène' });
  if (problems.length) throw new Error(problems.join(' '));
  const max = Math.max(1, Math.min(15, finite(maximum, 8)));
  return [...project.scenes].sort((a, b) => a.start - b.start).flatMap(scene => {
    const count = Math.ceil((scene.end - scene.start) / max);
    return Array.from({ length: count }, (_, i) => ({ id: uid('shot'), scene_id: scene.id,
      label: `${scene.label} · ${i + 1}/${count}`, start: round(scene.start + (scene.end - scene.start) * i / count),
      end: round(scene.start + (scene.end - scene.start) * (i + 1) / count), image_id: scene.keyframe_id || '', video_id: '',
      prompt: scene.prompt || scene.motion, source_in: 0, transition: 'cut', fit: 'contain', locked: false }));
  });
}
export function renderIssues(project, { animatic = false } = {}) {
  const issues = intervalIssues(project.shots, finite(project.audio?.duration_seconds));
  if (!analysisReady(project)) issues.push('L’analyse intégrale de la source actuelle est absente ou incomplète.');
  if (!project.review?.storyboard) issues.push('Le storyboard doit être validé.');
  if (project.render?.subtitles && !project.review?.lyrics) issues.push('Les paroles doivent être vérifiées avant les sous-titres.');
  const assets = new Map(project.assets.map(a => [a.id, a]));
  for (const shot of project.shots) {
    const asset = assets.get(shot.video_id || (animatic ? shot.image_id : ''));
    if (!asset) { issues.push(`${shot.label} : ${animatic ? 'média' : 'vidéo'} manquant.`); continue; }
    if (asset.mime.startsWith('video/')) {
      if (!(asset.duration_seconds > 0)) issues.push(`${shot.label} : durée vidéo non vérifiée.`);
      else if (finite(shot.source_in) < 0 || finite(shot.source_in) + shot.end - shot.start > asset.duration_seconds + 0.045) issues.push(`${shot.label} : vidéo trop courte ; créer un autre plan ou ajuster le découpage.`);
    } else if (!animatic || !asset.mime.startsWith('image/')) issues.push(`${shot.label} : ce média n’est pas une vidéo.`);
  }
  return [...new Set(issues)];
}
export function coverage(project) {
  const duration = finite(project.audio?.duration_seconds);
  const assets = new Map(project.assets.map(a => [a.id, a]));
  const ranges = project.shots.flatMap(s => {
    const a = assets.get(s.video_id);
    const available = Math.max(0, finite(a?.duration_seconds) - finite(s.source_in));
    return a?.mime?.startsWith('video/') && available > 0 ? [[Math.max(0, s.start), Math.min(duration, s.end, s.start + available)]] : [];
  }).sort((a, b) => a[0] - b[0]);
  let end = 0; let seconds = 0;
  for (const [start, stop] of ranges) { seconds += Math.max(0, stop - Math.max(start, end)); end = Math.max(end, stop); }
  return { seconds: round(seconds), percent: duration > 0 ? Math.min(100, round(seconds / duration * 100)) : 0, missing: round(Math.max(0, duration - seconds)) };
}
export function scenePrompt(project, scene, shot, kind = 'video') {
  const prompt = kind === 'image' ? scene.image_prompt || scene.prompt : shot?.prompt || scene.prompt || scene.motion;
  if (!String(prompt || '').trim()) throw new Error('Renseignez une action et un mouvement de caméra dans le prompt.');
  return [project.direction.brief, `SCÈNE : ${scene.label}.`, prompt,
    `Continuité : la référence jointe reste prioritaire ; conserver visage, casque, micro, ailes et proportions. ${scene.dance ? 'Mouvement dansé autorisé.' : 'Ne pas imposer de danse.'}`,
    `Contraintes : ${scene.negative_prompt || 'aucun texte, aucun faux logo, aucune déformation'}.`,
    kind === 'video' ? 'Un seul plan continu. La musique originale sera ajoutée au montage ; aucune parole générée nécessaire.' : 'Une seule scène plein cadre, sans grille de storyboard ni légende.',
  ].filter(Boolean).join('\n\n').slice(0, 24000);
}
export function validateAction(action, project) {
  const types = ['storyboard', 'split', 'update_scene', 'generate_image', 'generate_video', 'preview'];
  if (!action || !types.includes(action.type)) throw new Error('Action non autorisée.');
  if (['update_scene', 'generate_image', 'generate_video'].includes(action.type) && !project.scenes.some(s => s.id === action.scene_id)) throw new Error('Scène introuvable.');
  if (action.type === 'update_scene' && project.scenes.find(s => s.id === action.scene_id)?.locked) throw new Error('Scène verrouillée.');
  const patch = {};
  for (const key of ['label', 'prompt', 'image_prompt', 'motion', 'negative_prompt']) if (typeof action.patch?.[key] === 'string') patch[key] = text(action.patch[key]);
  if (action.type === 'generate_video' && action.shot_id && !project.shots.some(s => s.id === action.shot_id && s.scene_id === action.scene_id)) throw new Error('Plan inconnu pour cette scène.');
  const sections = Array.isArray(action.sections) ? action.sections.slice(0, 200).map((v,i) => ({ id: `proposal-${i}`, label:text(v.label,160), type:text(v.type,60), start:Number(v.start), end:Number(v.end), prompt:text(v.prompt), image_prompt:text(v.image_prompt), motion:text(v.motion) })) : null;
  if (action.type === 'storyboard' && sections && intervalIssues(sections, finite(project.audio?.duration_seconds)).length) throw new Error('La proposition ne couvre pas correctement toute la chanson.');
  return { type: action.type, scene_id: safeId(action.scene_id), shot_id: safeId(action.shot_id), patch, sections, reason: text(action.reason, 1000) };
}
export function normalizeProject(input) {
  if (!input || input.schema_version !== SCHEMA) throw new Error('Format de projet Elynea non reconnu.');
  if (!Array.isArray(input.scenes) || input.scenes.length > 200 || !Array.isArray(input.shots) || input.shots.length > 2000 || !Array.isArray(input.assets) || input.assets.length > 2000) throw new Error('Projet trop volumineux ou incomplet.');
  const p = newProject();
  p.id = safeId(input.id) || p.id; p.title = text(input.title, 240); p.created_at = text(input.created_at, 40) || p.created_at;
  p.audio = input.audio ? { asset_id: safeId(input.audio.asset_id), name: text(input.audio.name, 240), sha256: /^[a-f0-9]{64}$/.test(input.audio.sha256 || '') ? input.audio.sha256 : '', duration_seconds: finite(input.audio.duration_seconds) } : null;
  p.direction = { brief: text(input.direction?.brief), lyrics_reference: text(input.direction?.lyrics_reference,30000), mode: ['auto','dance','cinematic','advertising','custom'].includes(input.direction?.mode) ? input.direction.mode : 'cinematic', dance_allowed: input.direction?.dance_allowed === true, format: ['16:9','9:16','1:1'].includes(input.direction?.format) ? input.direction.format : '16:9' };
  p.scenes = input.scenes.map(s => ({ id: safeId(s.id) || uid('scene'), label: text(s.label, 160), type: text(s.type, 60), start: finite(s.start, -1), end: finite(s.end, -1), motion: text(s.motion), prompt: text(s.prompt), image_prompt: text(s.image_prompt), negative_prompt: text(s.negative_prompt), keyframe_id: safeId(s.keyframe_id), locked: s.locked === true, dance: s.dance === true, provenance: text(s.provenance, 100) }));
  p.shots = input.shots.map(s => ({ id: safeId(s.id) || uid('shot'), scene_id: safeId(s.scene_id), label: text(s.label, 180), start: finite(s.start, -1), end: finite(s.end, -1), image_id: safeId(s.image_id), video_id: safeId(s.video_id), prompt: text(s.prompt), source_in: finite(s.source_in), transition: s.transition === 'fade' ? 'fade' : 'cut', fit: s.fit === 'cover' ? 'cover' : 'contain', locked: s.locked === true }));
  p.assets = input.assets.map(a => ({ id: safeId(a.id) || uid('asset'), name: text(a.name, 240), mime: text(a.mime, 80), role: ['audio','reference','keyframe','video','document','logo','render'].includes(a.role) ? a.role : 'reference', size: finite(a.size), sha256: /^[a-f0-9]{64}$/.test(a.sha256 || '') ? a.sha256 : '', duration_seconds: finite(a.duration_seconds), width: finite(a.width), height: finite(a.height), path: text(a.path, 300) }));
  const allowedMimes = new Set(['image/png','image/jpeg','image/webp','video/mp4','video/webm','video/quicktime','audio/mpeg','audio/wav','audio/x-wav','audio/flac','audio/ogg','audio/mp4','application/pdf']);
  if(p.assets.some(a=>!allowedMimes.has(a.mime))) throw new Error('Type de média non autorisé dans le manifeste.');
  for (const list of [p.scenes, p.shots, p.assets]) if (new Set(list.map(a => a.id)).size !== list.length) throw new Error('Identifiants dupliqués dans le projet.');
  // Secrets and executable-looking configuration never travel with an imported analysis.
  const scrub = (v, depth=0) => { if(depth>20) return null; if(Array.isArray(v)) return v.slice(0,100000).map(x=>scrub(x,depth+1)); if(v && typeof v==='object') return Object.fromEntries(Object.entries(v).filter(([k])=>!/(api.?key|token|secret|authorization|password|__proto__|constructor|prototype)/i.test(k)).map(([k,x])=>[k,scrub(x,depth+1)])); return typeof v==='string' ? v.slice(0,200000) : v; };
  p.analysis = input.analysis && typeof input.analysis === 'object' && !Array.isArray(input.analysis) ? scrub(input.analysis) : null;
  p.sources = (Array.isArray(input.sources) ? input.sources : []).slice(0, 30).map(s => ({ asset_id: safeId(s.asset_id), name: text(s.name,240), text: text(s.text,200000), warning: text(s.warning,1000) }));
  p.messages = (Array.isArray(input.messages) ? input.messages : []).slice(-100).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', text: text(m.text,8000) }));
  p.jobs = (Array.isArray(input.jobs) ? input.jobs : []).slice(-200).map(j => ({ id: safeId(j.id), provider: ['local','xai'].includes(j.provider) ? j.provider : 'local', type: text(j.type,30), scene_id: safeId(j.scene_id), shot_id: safeId(j.shot_id), status: text(j.status,50), source_sha256: text(j.source_sha256,64), applied:j.applied===true, stage:text(j.stage,1000), error:text(j.error,2000), progress:finite(j.progress) }));
  p.review = { lyrics: input.review?.lyrics === true, storyboard: input.review?.storyboard === true };
  p.render = { fps: [24,25,30].includes(input.render?.fps) ? input.render.fps : 25, height: [720,1080].includes(input.render?.height) ? input.render.height : 720, logo_id: safeId(input.render?.logo_id), subtitles: input.render?.subtitles === true };
  return p;
}
