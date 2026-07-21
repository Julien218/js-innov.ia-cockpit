import { useState, useEffect, useRef } from "react";
import { Play, Pause, ChevronLeft, ChevronRight } from "lucide-react";

const TRANSITION_CSS = {
  fade: "animate-[fadeIn_0.5s_ease]",
  slide: "animate-[slideIn_0.4s_ease]",
  zoom: "animate-[zoomIn_0.4s_ease]",
  flash: "animate-[flash_0.3s_ease]",
  blur: "animate-[blurIn_0.5s_ease]",
  wipe: "animate-[wipeIn_0.4s_ease]",
  glitch: "animate-[glitchIn_0.3s_ease]",
};

export default function VideoPreview({ clips, texts, transition, currentClipIdx, onClipChange }) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showTransition, setShowTransition] = useState(false);
  const intervalRef = useRef(null);
  const clip = clips[currentClipIdx];
  const totalDuration = clips.reduce((s, c) => s + (c.duration || 4), 0);

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setElapsed((e) => {
          const next = e + 0.1;
          if (next >= totalDuration) { setPlaying(false); return 0; }
          // Auto advance clips
          let acc = 0;
          for (let i = 0; i < clips.length; i++) {
            acc += clips[i].duration || 4;
            if (next < acc) { if (i !== currentClipIdx) { setShowTransition(true); setTimeout(() => setShowTransition(false), 400); onClipChange(i); } break; }
          }
          return next;
        });
      }, 100);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [playing, clips, totalDuration, currentClipIdx]);

  const seek = (i) => {
    const bounded = Math.max(0, Math.min(clips.length - 1, i));
    setShowTransition(true);
    setTimeout(() => setShowTransition(false), 400);
    onClipChange(bounded);
    const acc = clips.slice(0, bounded).reduce((s, c) => s + (c.duration || 4), 0);
    setElapsed(acc);
  };

  const progressPct = totalDuration > 0 ? (elapsed / totalDuration) * 100 : 0;

  return (
    <div className="bg-black flex-1 flex flex-col" style={{ maxHeight: "340px", minHeight: "200px" }}>
      {/* Screen */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-black">
        {clip ? (
          <div className={`w-full h-full relative ${showTransition ? TRANSITION_CSS[transition] || TRANSITION_CSS.fade : ""}`}
            style={{ aspectRatio: "2/1", maxHeight: "100%", margin: "auto" }}>
            {clip.type === "video" ? (
              <video src={clip.url} className="w-full h-full object-contain transition-transform duration-300" muted autoPlay={playing} loop={false}
                style={{ transform: `rotate(${clip.rotation || 0}deg)` }} />
            ) : (
              <img src={clip.url} alt={clip.name} className="w-full h-full object-contain transition-transform duration-300"
                style={{ transform: `rotate(${clip.rotation || 0}deg)` }} />
            )}
            {/* Text overlays */}
            {(texts || []).filter(t => !t.clipId || t.clipId === clip.id).map((t, i) => (
              <div key={i} className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className={`text-center px-8 ${t.position === "top" ? "!items-start pt-8" : t.position === "bottom" ? "!items-end pb-8" : ""}`}
                  style={{ fontFamily: t.font || "Playfair Display, serif", color: t.color || "#ffffff", fontSize: t.size || "2rem", textShadow: "0 2px 8px rgba(0,0,0,0.8)", fontWeight: t.bold ? 700 : 400 }}>
                  {t.content}
                </div>
              </div>
            ))}
            {/* Clip counter */}
            <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
              {currentClipIdx + 1} / {clips.length}
            </div>
          </div>
        ) : (
          <div className="text-center text-muted-foreground">
            <div className="text-5xl mb-3">🎬</div>
            <p className="text-sm">Ajoutez des clips dans la timeline</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="border-t border-border/50 px-4 py-2 flex items-center gap-3 bg-black">
        <button onClick={() => seek(currentClipIdx - 1)} className="text-muted-foreground hover:text-white">
          <ChevronLeft size={16} />
        </button>
        <button onClick={() => setPlaying(!playing)} className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button onClick={() => seek(currentClipIdx + 1)} className="text-muted-foreground hover:text-white">
          <ChevronRight size={16} />
        </button>
        {/* Progress bar */}
        <div className="flex-1 h-1 bg-border rounded-full overflow-hidden cursor-pointer" onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          setElapsed(pct * totalDuration);
        }}>
          <div className="h-full bg-primary transition-all duration-100" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{Math.floor(elapsed)}s / {totalDuration}s</span>
      </div>
    </div>
  );
}
