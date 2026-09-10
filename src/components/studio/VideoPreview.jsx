import { useState, useEffect, useRef, useCallback } from "react";
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

function clipDuration(clip) {
  return Math.max(0.1, Number(clip?.duration) || 4);
}

function clipIndexAt(time, clips) {
  if (!clips.length) return 0;
  let cursor = 0;
  for (let index = 0; index < clips.length; index += 1) {
    cursor += clipDuration(clips[index]);
    if (time < cursor || index === clips.length - 1) return index;
  }
  return clips.length - 1;
}

function clipStartAt(index, clips) {
  return clips.slice(0, index).reduce((sum, item) => sum + clipDuration(item), 0);
}

export default function VideoPreview({
  clips,
  texts,
  transition,
  audioUrl,
  audioDuration,
  currentClipIdx,
  onClipChange,
  currentTime = 0,
  onTimeChange,
}) {
  const clipList = Array.isArray(clips) ? clips : [];
  const safeClipIdx = clipList.length
    ? Math.max(0, Math.min(clipList.length - 1, Number(currentClipIdx) || 0))
    : 0;
  const clip = clipList[safeClipIdx];
  const clipsDuration = clipList.reduce((sum, item) => sum + clipDuration(item), 0);
  const hasAudio = Boolean(audioUrl);

  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showTransition, setShowTransition] = useState(false);
  const [mediaDuration, setMediaDuration] = useState(0);
  const audioRef = useRef(null);
  const transitionTimerRef = useRef(null);
  const parsedAudioDuration = Number(audioDuration) || 0;
  const effectiveAudioDuration = parsedAudioDuration > 0 ? parsedAudioDuration : mediaDuration;
  const totalDuration = effectiveAudioDuration > 0 ? effectiveAudioDuration : clipsDuration;

  const showClipTransition = useCallback(() => {
    setShowTransition(true);
    clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = setTimeout(() => setShowTransition(false), 400);
  }, []);

  const changeClip = useCallback((index, withTransition = true) => {
    if (!clipList.length) return;
    const bounded = Math.max(0, Math.min(clipList.length - 1, index));
    if (bounded !== safeClipIdx && withTransition) showClipTransition();
    onClipChange(bounded);
  }, [clipList, onClipChange, safeClipIdx, showClipTransition]);

  useEffect(() => () => {
    clearTimeout(transitionTimerRef.current);
  }, []);

  useEffect(() => {
    setPlaying(false);
    setElapsed(0);
    onTimeChange?.(0);
    setMediaDuration(0);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (clipList.length) onClipChange(0);
  }, [audioUrl, clipList.length, onClipChange, onTimeChange]);

  useEffect(() => {
    const requested = Number(currentTime);
    if (!Number.isFinite(requested) || Math.abs(requested - elapsed) < 0.05) return;
    const bounded = Math.max(0, Math.min(totalDuration, requested));
    setElapsed(bounded);
    const nextClip = clipIndexAt(bounded, clipList);
    if (nextClip !== safeClipIdx) changeClip(nextClip, true);
    const audio = audioRef.current;
    if (hasAudio && audio && Math.abs((Number(audio.currentTime) || 0) - bounded) > 0.1) {
      audio.currentTime = bounded;
    }
  }, [changeClip, clipList, currentTime, elapsed, hasAudio, safeClipIdx, totalDuration]);

  useEffect(() => {
    setMediaDuration(0);
    const audio = audioRef.current;
    if (!hasAudio || !audio) return undefined;
    const handleMetadata = () => setMediaDuration(Number(audio.duration) || 0);
    audio.addEventListener("loadedmetadata", handleMetadata);
    if (audio.readyState >= 1) handleMetadata();
    return () => audio.removeEventListener("loadedmetadata", handleMetadata);
  }, [audioUrl, hasAudio]);

  useEffect(() => {
    if (hasAudio || !playing || totalDuration <= 0) return undefined;
    const interval = setInterval(() => {
      setElapsed((current) => {
        const next = current + 0.1;
        if (next >= totalDuration) {
          setPlaying(false);
          changeClip(0, false);
          onTimeChange?.(0);
          return 0;
        }
        const nextClip = clipIndexAt(next, clipList);
        if (nextClip !== safeClipIdx) changeClip(nextClip);
        onTimeChange?.(next);
        return next;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [changeClip, clipList, hasAudio, onTimeChange, playing, safeClipIdx, totalDuration]);

  useEffect(() => {
    if (!hasAudio || !audioRef.current) return undefined;
    const audio = audioRef.current;
    const handleTimeUpdate = () => {
      const time = Number(audio.currentTime) || 0;
      setElapsed(time);
      onTimeChange?.(time);
      const nextClip = clipIndexAt(time, clipList);
      if (nextClip !== safeClipIdx) changeClip(nextClip);
    };
    const handleEnded = () => {
      setPlaying(false);
      setElapsed(0);
      onTimeChange?.(0);
      audio.currentTime = 0;
      changeClip(0, false);
    };
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [changeClip, clipList, hasAudio, onTimeChange, safeClipIdx]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!hasAudio || !audio) return undefined;
    if (playing) {
      const promise = audio.play();
      promise?.catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
    return undefined;
  }, [audioUrl, hasAudio, playing]);

  const seekTo = (time) => {
    const bounded = Math.max(0, Math.min(totalDuration, Number(time) || 0));
    setElapsed(bounded);
    const nextClip = clipIndexAt(bounded, clipList);
    changeClip(nextClip, true);
    onTimeChange?.(bounded);
    if (hasAudio && audioRef.current) {
      const audio = audioRef.current;
      audio.currentTime = bounded;
    }
  };

  const seek = (index) => {
    if (!clipList.length) return;
    const bounded = Math.max(0, Math.min(clipList.length - 1, index));
    seekTo(clipStartAt(bounded, clipList));
  };

  const togglePlayback = () => {
    if (!clipList.length && !hasAudio) return;
    if (hasAudio && audioRef.current) {
      if (playing) {
        audioRef.current.pause();
        setPlaying(false);
      } else {
        setPlaying(true);
      }
      return;
    }
    setPlaying((current) => !current);
  };

  const progressPct = totalDuration > 0
    ? Math.max(0, Math.min(100, (elapsed / totalDuration) * 100))
    : 0;

  return (
    <div className="bg-black flex-1 flex flex-col" style={{ maxHeight: "340px", minHeight: "200px" }}>
      <audio ref={audioRef} src={audioUrl || undefined} preload="metadata" className="hidden" />
      <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-black">
        {clip ? (
          <div
            className={"w-full h-full relative " + (showTransition ? TRANSITION_CSS[transition] || TRANSITION_CSS.fade : "")}
            style={{ aspectRatio: "2/1", maxHeight: "100%", margin: "auto" }}
          >
            {clip.type === "video" ? (
              <video
                key={clip.id}
                src={clip.url}
                className="w-full h-full object-contain transition-transform duration-300"
                muted
                autoPlay={playing}
                loop={false}
                style={{ transform: "rotate(" + (clip.rotation || 0) + "deg)" }}
              />
            ) : (
              <img
                src={clip.url}
                alt={clip.name}
                className="w-full h-full object-contain transition-transform duration-300"
                style={{ transform: "rotate(" + (clip.rotation || 0) + "deg)" }}
              />
            )}
            {(texts || []).filter((item) => !item.clipId || item.clipId === clip.id).map((item, index) => (
              <div key={index} className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                  className={"text-center px-8 " + (
                    item.position === "haut" || item.position === "top"
                      ? "absolute top-0 pt-8"
                      : item.position === "bas" || item.position === "bottom"
                        ? "absolute bottom-0 pb-8"
                        : ""
                  )}
                  style={{
                    fontFamily: item.font || "Playfair Display, serif",
                    color: item.color || "#ffffff",
                    fontSize: item.size || "2rem",
                    textShadow: "0 2px 8px rgba(0,0,0,0.8)",
                    fontWeight: item.bold ? 700 : 400,
                  }}
                >
                  {item.content}
                </div>
              </div>
            ))}
            <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
              {safeClipIdx + 1} / {clipList.length}
            </div>
          </div>
        ) : (
          <div className="text-center text-muted-foreground">
            <div className="text-5xl mb-3">🎬</div>
            <p className="text-sm">{hasAudio ? "La musique est prête. Ajoutez des clips dans la timeline." : "Ajoutez des clips dans la timeline"}</p>
          </div>
        )}
      </div>

      <div className="border-t border-border/50 px-4 py-2 flex items-center gap-3 bg-black">
        <button
          onClick={() => seek(safeClipIdx - 1)}
          disabled={!clipList.length}
          aria-label="Clip précédent"
          className="text-muted-foreground hover:text-white disabled:opacity-40"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={togglePlayback}
          disabled={!clipList.length && !hasAudio}
          aria-label={playing ? "Mettre en pause" : "Lire le montage"}
          className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground disabled:opacity-40"
        >
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button
          onClick={() => seek(safeClipIdx + 1)}
          disabled={!clipList.length}
          aria-label="Clip suivant"
          className="text-muted-foreground hover:text-white disabled:opacity-40"
        >
          <ChevronRight size={16} />
        </button>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Position du montage"
          aria-valuemin={0}
          aria-valuemax={Math.round(totalDuration)}
          aria-valuenow={Math.round(elapsed)}
          className="flex-1 h-1 bg-border rounded-full overflow-hidden cursor-pointer"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const pct = rect.width ? (event.clientX - rect.left) / rect.width : 0;
            seekTo(pct * totalDuration);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") seekTo(elapsed - 1);
            if (event.key === "ArrowRight") seekTo(elapsed + 1);
          }}
        >
          <div className="h-full bg-primary transition-all duration-100" style={{ width: progressPct + "%" }} />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {Math.floor(elapsed)}s / {Math.ceil(totalDuration)}s
        </span>
      </div>
    </div>
  );
}
