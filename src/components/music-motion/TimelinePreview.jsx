import { useEffect, useRef } from 'react';
import { timeLabel } from '@/lib/music-motion/model';

/** The source song is the only clock. Generated videos are always muted. */
export default function TimelinePreview({ project, urls, audioRef, cursor, setCursor }) {
  const video = useRef(null);
  const shot = project.shots.find(s => s.start <= cursor && s.end > cursor);
  const asset = project.assets.find(a => a.id === (shot?.video_id || shot?.image_id));
  const duration = project.audio?.duration_seconds || 0;
  const acoustic = project.analysis?.transcription?.acoustic || {};
  const waveform = acoustic.waveform || [];
  useEffect(() => {
    if (!video.current || !shot) return;
    const desired = Math.max(0, cursor - shot.start + (shot.source_in || 0));
    if (Math.abs(video.current.currentTime - desired) > 0.18) video.current.currentTime = desired;
    if (!audioRef.current?.paused) video.current.play().catch(() => {}); else video.current.pause();
  }, [cursor, shot, asset, audioRef]);
  function seek(event) {
    if (!audioRef.current || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    audioRef.current.currentTime = Math.max(0, Math.min(duration, (event.clientX-rect.left)/rect.width*duration));
    setCursor(audioRef.current.currentTime);
  }
  return <section className="rounded-xl border border-border bg-card p-4 space-y-3">
    <div className="flex justify-between text-sm font-medium"><span>Prévisualisation du montage</span><span>{timeLabel(cursor)} / {timeLabel(duration)}</span></div>
    <div className="aspect-video rounded-lg bg-black flex items-center justify-center overflow-hidden">
      {asset?.mime?.startsWith('video/') ? <video ref={video} key={asset.id} src={urls.get(asset.id)} muted playsInline className={'w-full h-full '+(shot?.fit==='cover'?'object-cover':'object-contain')} />
        : asset?.mime?.startsWith('image/') ? <img src={urls.get(asset.id)} alt={shot?.label || 'Image de travail'} className="w-full h-full object-contain" />
          : <p className="text-slate-400 text-sm p-6 text-center">Importez ou générez des médias pour les plans. Aucun média fictif ne comble les trous.</p>}
    </div>
    {asset?.mime?.startsWith('image/') && <p className="text-xs text-amber-600">Image de travail : ce plan ne contient pas encore de vidéo.</p>}
    {project.audio && <audio ref={audioRef} controls src={urls.get(project.audio.asset_id)} className="w-full" onTimeUpdate={e=>setCursor(e.currentTarget.currentTime)} onPause={()=>video.current?.pause()} onPlay={()=>video.current?.play().catch(()=>{})} />}
    <button type="button" className="block w-full h-16 relative rounded bg-muted overflow-hidden" onClick={seek} aria-label="Se déplacer dans la chanson">
      <svg viewBox="0 0 1000 64" preserveAspectRatio="none" className="w-full h-full" aria-hidden="true">
        {waveform.map((w,i)=><line key={i} x1={i/Math.max(1,waveform.length-1)*1000} x2={i/Math.max(1,waveform.length-1)*1000} y1={32-(Array.isArray(w)?Math.abs(w[1]):Math.max(Math.abs(w.min||0),Math.abs(w.max||0)))*30} y2={32+(Array.isArray(w)?Math.abs(w[1]):Math.max(Math.abs(w.min||0),Math.abs(w.max||0)))*30} stroke="currentColor" opacity="0.6" />)}
        {(acoustic.beat_times||[]).map((t,i)=><line key={'b'+i} x1={t/duration*1000} x2={t/duration*1000} y1="56" y2="64" stroke="currentColor" opacity="0.4" />)}
        <line x1={cursor/Math.max(1,duration)*1000} x2={cursor/Math.max(1,duration)*1000} y1="0" y2="64" stroke="currentColor" strokeWidth="3" />
      </svg>
    </button>
    <p className="text-xs text-muted-foreground">Écoute et coupes synchronisées à la source. Les fondus, le logo et les sous-titres sont appliqués au rendu FFmpeg.</p>
  </section>;
}
