import { useState, useRef, useEffect } from "react";
import { X, Play, Pause, Volume2, VolumeX, Download } from "lucide-react";

export default function VideoPlayer({ videoExport, onClose }) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const videoRef = useRef(null);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleLoadedMetadata = () => setDuration(video.duration);
    const handleEnded = () => setPlaying(false);

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("ended", handleEnded);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("ended", handleEnded);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = videoExport.file_url;
    a.download = `${videoExport.title}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0" onClick={e => e.stopPropagation()}>
        <div>
          <p className="font-display text-base font-semibold text-white">{videoExport.title}</p>
          <p className="text-xs text-white/40 mt-1">
            {videoExport.format} · {videoExport.duration_seconds}s · {(videoExport.file_size_mb).toFixed(1)} MB
          </p>
        </div>
        <button onClick={onClose} className="text-white/50 hover:text-white transition-colors">
          <X size={24} />
        </button>
      </div>

      {/* Video player */}
      <div className="flex-1 flex items-center justify-center overflow-hidden bg-black" onClick={e => e.stopPropagation()}>
        <video
          ref={videoRef}
          src={videoExport.file_url}
          className="max-w-full max-h-full object-contain"
          controls={false}
        />
      </div>

      {/* Controls */}
      <div className="shrink-0 border-t border-white/10 px-6 py-4 bg-black space-y-3" onClick={e => e.stopPropagation()}>
        {/* Progress bar */}
        <div
          className="h-2 bg-white/10 rounded-full overflow-hidden cursor-pointer hover:h-3 transition-all"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            if (videoRef.current) {
              videoRef.current.currentTime = pct * duration;
            }
          }}
        >
          <div className="h-full bg-primary rounded-full" style={{ width: `${progressPct}%` }} />
        </div>

        {/* Control buttons */}
        <div className="flex items-center gap-4">
          {/* Play/Pause */}
          <button
            onClick={() => setPlaying(!playing)}
            className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>

          {/* Volume control */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="text-white/50 hover:text-white transition-colors"
            >
              {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setVolume(val);
                if (val > 0) setIsMuted(false);
              }}
              className="w-24 h-1 bg-white/20 rounded-full appearance-none cursor-pointer accent-primary"
            />
          </div>

          {/* Time display */}
          <div className="flex-1">
            <span className="text-xs text-white/50 tabular-nums">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* Download button */}
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/20 text-white/70 hover:text-white hover:border-white/40 transition-colors text-sm"
          >
            <Download size={16} />
            Télécharger
          </button>
        </div>
      </div>
    </div>
  );
}
