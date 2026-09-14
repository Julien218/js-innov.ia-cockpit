import { useEffect, useMemo, useRef } from 'react';
import { timeLabel } from '@/lib/music-motion/model';

/** The source song is the only clock. Generated videos are always muted. */
export default function TimelinePreview({ project, urls, audioRef, cursor, setCursor }) {
  const video = useRef(null);
  const shot = project.shots.find(s => s.start <= cursor && s.end > cursor);
  const asset = project.assets.find(a => a.id === (shot?.video_id || shot?.image_id));
  const duration = Number(project.audio?.duration_seconds) || 0;
  const safeDuration = Math.max(1, duration);
  const acoustic = project.analysis?.transcription?.acoustic || {};
  const waveform = Array.isArray(acoustic.waveform) ? acoustic.waveform : [];
  const beats = Array.isArray(acoustic.beat_times) ? acoustic.beat_times.filter(Number.isFinite) : [];
  const mediaUrl = asset?.id ? urls.get(asset.id) : '';
  const audioUrl = project.audio?.asset_id ? urls.get(project.audio.asset_id) : '';
  const cursorX = Math.max(0, Math.min(1000, Number(cursor || 0) / safeDuration * 1000));
  const waveformLines = useMemo(() => waveform.map((w, i) => {
    const amplitude = Array.isArray(w)
      ? Math.abs(Number(w[1]) || 0)
      : Math.max(Math.abs(Number(w?.min) || 0), Math.abs(Number(w?.max) || 0));
    const x = i / Math.max(1, waveform.length - 1) * 1000;
    return { x, amplitude: Math.min(1, amplitude) };
  }), [waveform]);

  useEffect(() => {
    if (!video.current || !shot || !mediaUrl) return;
    const desired = Math.max(0, Number(cursor || 0) - Number(shot.start || 0) + Number(shot.source_in || 0));
    try {
      if (Math.abs(video.current.currentTime - desired) > 0.18) video.current.currentTime = desired;
    } catch {}
    if (!audioRef.current?.paused) video.current.play().catch(() => {});
    else video.current.pause();
  }, [cursor, shot, asset, mediaUrl, audioRef]);

  function seek(event) {
    if (!audioRef.current || duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    audioRef.current.currentTime = Math.max(0, Math.min(duration, (event.clientX - rect.left) / rect.width * duration));
    setCursor(audioRef.current.currentTime);
  }

  return <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
      <span>Prévisualisation du montage</span>
      <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{timeLabel(cursor)} / {timeLabel(duration)}</span>
    </div>

    <div className="aspect-video rounded-xl bg-black flex items-center justify-center overflow-hidden border border-white/5">
      {asset?.mime?.startsWith('video/') && mediaUrl ? <video ref={video} key={asset.id} src={mediaUrl} muted playsInline className={'w-full h-full ' + (shot?.fit === 'cover' ? 'object-cover' : 'object-contain')} />
        : asset?.mime?.startsWith('image/') && mediaUrl ? <img src={mediaUrl} alt={shot?.label || 'Image de travail'} className="w-full h-full object-contain" />
          : <div className="max-w-md p-6 text-center">
              <p className="text-sm font-medium text-slate-200">Aucun plan visuel à ce repère</p>
              <p className="mt-2 text-xs leading-5 text-slate-400">Ajoutez une image ou une vidéo au plan sélectionné. Elynea n’invente aucun média pour masquer un trou dans la timeline.</p>
            </div>}
    </div>

    {asset?.mime?.startsWith('image/') && mediaUrl && <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">Image de travail : ce plan n’a pas encore de vidéo finale.</p>}

    {project.audio && audioUrl ? <audio ref={audioRef} controls src={audioUrl} className="w-full" onTimeUpdate={e => setCursor(e.currentTarget.currentTime)} onPause={() => video.current?.pause()} onPlay={() => video.current?.play().catch(() => {})} />
      : project.audio ? <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">La source audio existe dans le projet mais son fichier local n’est plus disponible. Réimportez la chanson ou rechargez le pack ZIP.</p>
        : <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Commencez par importer la chanson complète : elle devient l’horloge de tout le montage.</p>}

    <button type="button" disabled={duration <= 0} className="block w-full h-16 relative rounded-lg bg-muted overflow-hidden disabled:cursor-not-allowed disabled:opacity-50" onClick={seek} aria-label="Se déplacer dans la chanson">
      {waveformLines.length ? <svg viewBox="0 0 1000 64" preserveAspectRatio="none" className="w-full h-full" aria-hidden="true">
        {waveformLines.map((w, i) => <line key={i} x1={w.x} x2={w.x} y1={32 - w.amplitude * 30} y2={32 + w.amplitude * 30} stroke="currentColor" opacity="0.6" />)}
        {duration > 0 && beats.map((t, i) => <line key={'b' + i} x1={Math.max(0, Math.min(1000, t / safeDuration * 1000))} x2={Math.max(0, Math.min(1000, t / safeDuration * 1000))} y1="56" y2="64" stroke="currentColor" opacity="0.4" />)}
        <line x1={cursorX} x2={cursorX} y1="0" y2="64" stroke="currentColor" strokeWidth="3" />
      </svg> : <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">{duration > 0 ? 'L’analyse audio dessinera ici la forme d’onde et les pulsations.' : 'Timeline disponible après import de la chanson.'}</div>}
    </button>
    <p className="text-xs text-muted-foreground">Écoute et coupes synchronisées à la source. Les fondus, le logo et les sous-titres sont appliqués au rendu FFmpeg.</p>
  </section>;
}
