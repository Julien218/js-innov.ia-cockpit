import { useEffect, useRef, useState } from "react";
import { X, Play, Pause, ChevronLeft, ChevronRight, Download } from "lucide-react";

const TRANSITION_CSS = {
  fade:   "animate-[fadeIn_0.5s_ease]",
  slide:  "animate-[slideIn_0.4s_ease]",
  zoom:   "animate-[zoomIn_0.4s_ease]",
  flash:  "animate-[flash_0.3s_ease]",
  blur:   "animate-[blurIn_0.5s_ease]",
  wipe:   "animate-[wipeIn_0.4s_ease]",
  glitch: "animate-[glitchIn_0.3s_ease]",
};

export default function VideoPreviewModal({ vp, onClose }) {
  const clips = vp?.clips || [];
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showTransition, setShowTransition] = useState(false);
  const intervalRef = useRef(null);
  const audioRef = useRef(null);

  const totalDuration = clips.reduce((s, c) => s + (c.duration || 4), 0);
  const clip = clips[currentIdx];

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setElapsed((e) => {
          const next = e + 0.1;
          if (next >= totalDuration) {
            setPlaying(false);
            return 0;
          }
          let acc = 0;
          for (let i = 0; i < clips.length; i++) {
            acc += clips[i].duration || 4;
            if (next < acc) {
              if (i !== currentIdx) {
                setShowTransition(true);
                setTimeout(() => setShowTransition(false), 500);
                setCurrentIdx(i);
              }
              break;
            }
          }
          return next;
        });
      }, 100);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [playing, clips, totalDuration, currentIdx]);

  useEffect(() => {
    if (audioRef.current) {
      if (playing) audioRef.current.play().catch(() => {});
      else audioRef.current.pause();
    }
  }, [playing]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const seek = (i) => {
    const bounded = Math.max(0, Math.min(clips.length - 1, i));
    setShowTransition(true);
    setTimeout(() => setShowTransition(false), 500);
    setCurrentIdx(bounded);
    const acc = clips.slice(0, bounded).reduce((s, c) => s + (c.duration || 4), 0);
    setElapsed(acc);
  };

  const progressPct = totalDuration > 0 ? (elapsed / totalDuration) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={onClose}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0" onClick={e => e.stopPropagation()}>
        <div>
          <p className="font-display text-sm font-semibold text-white">{vp?.title}</p>
          <p className="text-xs text-white/40">{clips.length} clips · {totalDuration}s · {vp?.transition}</p>
        </div>
        <div className="flex items-center gap-3">
          {vp?.drive_url && (
            <a href={vp.drive_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-white/50 hover:text-white flex items-center gap-1 transition-colors">
              <Download size={13} /> Drive
            </a>
          )}
          <button onClick={onClose} className="text-white/50 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Screen */}
      <div className="flex-1 flex items-center justify-center overflow-hidden bg-black" onClick={e => e.stopPropagation()}>
        {clip ? (
          <div
            key={currentIdx}
            className={`relative w-full h-full flex items-center justify-center ${showTransition ? TRANSITION_CSS[vp?.transition] || TRANSITION_CSS.fade : ""}`}
          >
            {clip.type === "video" ? (
              <video src={clip.url} className="max-w-full max-h-full object-contain" autoPlay={playing} muted={!!vp?.audio_url} loop={false} />
            ) : (
              <img src={clip.url} alt={clip.name} className="max-w-full max-h-full object-contain" />
            )}
            {/* Text overlays */}
            {(vp?.texts || []).map((t, i) => (
              <div key={i} className={`absolute inset-0 flex px-12 pointer-events-none
                ${t.position === "haut" ? "items-start pt-10" : t.position === "bas" ? "items-end pb-10" : "items-center"}
                justify-center`}>
                <span style={{
                  fontFamily: t.font || "Playfair Display, serif",
                  color: t.color || "#ffffff",
                  fontSize: t.size || "2rem",
                  textShadow: "0 2px 12px rgba(0,0,0,0.9)",
                  fontWeight: t.bold ? 700 : 400,
                  textAlign: "center",
                }}>
                  {t.content}
                </span>
              </div>
            ))}
            {/* Clip info badge */}
            <div className="absolute top-4 right-4 bg-black/60 text-white/70 text-xs px-3 py-1 rounded-full backdrop-blur-sm">
              {currentIdx + 1} / {clips.length} — {clip.name}
            </div>
          </div>
        ) : (
          <div className="text-center text-white/30">
            <div className="text-5xl mb-3">🎬</div>
            <p className="text-sm">Aucun clip dans ce montage</p>
          </div>
        )}
      </div>

      {/* Audio */}
      {vp?.audio_url && (
        <audio ref={audioRef} src={vp.audio_url} loop={false} />
      )}

      {/* Controls */}
      <div className="shrink-0 border-t border-white/10 px-5 py-3 flex items-center gap-4 bg-black" onClick={e => e.stopPropagation()}>
        <button onClick={() => seek(currentIdx - 1)} disabled={currentIdx === 0}
          className="text-white/50 hover:text-white disabled:opacity-20 transition-colors">
          <ChevronLeft size={20} />
        </button>
        <button onClick={() => setPlaying(!playing)}
          className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground shrink-0">
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button onClick={() => seek(currentIdx + 1)} disabled={currentIdx === clips.length - 1}
          className="text-white/50 hover:text-white disabled:opacity-20 transition-colors">
          <ChevronRight size={20} />
        </button>

        {/* Progress bar */}
        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const t = pct * totalDuration;
            setElapsed(t);
            // find clip at t
            let acc = 0;
            for (let i = 0; i < clips.length; i++) {
              acc += clips[i].duration || 4;
              if (t < acc) { setCurrentIdx(i); break; }
            }
          }}>
          <div className="h-full bg-primary rounded-full transition-all duration-100" style={{ width: `${progressPct}%` }} />
        </div>

        <span className="text-xs text-white/40 tabular-nums shrink-0">{Math.floor(elapsed)}s / {totalDuration}s</span>
      </div>
    </div>
  );
}
