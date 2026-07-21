import { useState, useRef, useCallback } from "react";
import { TRACK_COLORS, TRACK_ICONS } from "@/data/videoTemplates";
import { Plus, Trash2, Eye, EyeOff, Scissors, ZoomIn, ZoomOut } from "lucide-react";

const TRACK_TYPES = ["video", "text", "image", "audio", "effects"];
const MIN_DURATION = 0.5;
const SECONDS_PER_PX_BASE = 0.05; // 1s = 1/0.05 = 20px at zoom 1

export default function MultiTrackTimeline({ tracks, onTracksChange, currentTime = 0, onSeek, duration = 30 }) {
  const [zoom, setZoom] = useState(1); // 1 = 20px/s
  const [selectedClip, setSelectedClip] = useState(null);
  const [hiddenTracks, setHiddenTracks] = useState({});
  const [dragging, setDragging] = useState(null); // { clipId, trackId, type: 'move'|'resize-left'|'resize-right', startX, startTime, startDuration }
  const timelineRef = useRef(null);

  const pxPerSecond = 20 * zoom;
  const totalWidth = Math.max(duration * pxPerSecond + 200, 600);

  // Flatten all clips with their trackId
  const allClips = tracks.flatMap(t => (t.clips || []).map(c => ({ ...c, trackId: t.id })));

  const getClip = (clipId) => allClips.find(c => c.id === clipId);

  const updateClip = useCallback((trackId, clipId, updates) => {
    onTracksChange(tracks.map(t => {
      if (t.id !== trackId) return t;
      return { ...t, clips: t.clips.map(c => c.id === clipId ? { ...c, ...updates } : c) };
    }));
  }, [tracks, onTracksChange]);

  const deleteClip = (trackId, clipId) => {
    onTracksChange(tracks.map(t => {
      if (t.id !== trackId) return t;
      return { ...t, clips: t.clips.filter(c => c.id !== clipId) };
    }));
    if (selectedClip?.clipId === clipId) setSelectedClip(null);
  };

  const splitClip = (trackId, clipId) => {
    const track = tracks.find(t => t.id === trackId);
    const clip = track?.clips.find(c => c.id === clipId);
    if (!clip || !currentTime) return;
    const splitPoint = currentTime - clip.startTime;
    if (splitPoint <= MIN_DURATION || splitPoint >= clip.duration - MIN_DURATION) return;
    const id2 = `${clipId}_split_${Date.now()}`;
    onTracksChange(tracks.map(t => {
      if (t.id !== trackId) return t;
      const newClips = t.clips.flatMap(c => {
        if (c.id !== clipId) return [c];
        return [
          { ...c, duration: splitPoint },
          { ...c, id: id2, startTime: c.startTime + splitPoint, duration: c.duration - splitPoint },
        ];
      });
      return { ...t, clips: newClips };
    }));
  };

  const addTrack = (type) => {
    const id = `${type}_${Date.now()}`;
    const label = { video: "Vidéo", text: "Texte", image: "Image", audio: "Audio", effects: "Effets" }[type] || type;
    onTracksChange([...tracks, { id, type, label, clips: [] }]);
  };

  const deleteTrack = (trackId) => {
    onTracksChange(tracks.filter(t => t.id !== trackId));
    setHiddenTracks(h => { const n = { ...h }; delete n[trackId]; return n; });
  };

  const toggleHide = (trackId) => {
    setHiddenTracks(h => ({ ...h, [trackId]: !h[trackId] }));
  };

  // Mouse drag handlers
  const handleMouseDown = (e, clip, type) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedClip({ clipId: clip.id, trackId: clip.trackId });
    setDragging({
      clipId: clip.id,
      trackId: clip.trackId,
      type,
      startX: e.clientX,
      origStart: clip.startTime,
      origDuration: clip.duration,
    });
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = useCallback((e) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.startX;
    const ds = dx / pxPerSecond;
    if (dragging.type === "move") {
      const newStart = Math.max(0, dragging.origStart + ds);
      updateClip(dragging.trackId, dragging.clipId, { startTime: Math.round(newStart * 10) / 10 });
    } else if (dragging.type === "resize-right") {
      const newDur = Math.max(MIN_DURATION, dragging.origDuration + ds);
      updateClip(dragging.trackId, dragging.clipId, { duration: Math.round(newDur * 10) / 10 });
    } else if (dragging.type === "resize-left") {
      const newStart = Math.max(0, dragging.origStart + ds);
      const newDur = Math.max(MIN_DURATION, dragging.origDuration - ds);
      updateClip(dragging.trackId, dragging.clipId, { startTime: Math.round(newStart * 10) / 10, duration: Math.round(newDur * 10) / 10 });
    }
  }, [dragging, pxPerSecond, updateClip]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  // Timeline click → seek
  const handleTimelineClick = (e) => {
    if (dragging) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    onSeek && onSeek(x / pxPerSecond);
  };

  const sel = selectedClip ? getClip(selectedClip.clipId) : null;

  return (
    <div className="flex flex-col h-full bg-background select-none">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Timeline</span>
          <span className="text-xs text-primary">{duration}s</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Add track */}
          {TRACK_TYPES.map(type => (
            <button
              key={type}
              onClick={() => addTrack(type)}
              title={`Ajouter piste ${type}`}
              className="text-xs px-2 py-1 rounded-lg bg-secondary text-muted-foreground hover:text-foreground hover:bg-accent transition-all flex items-center gap-1"
            >
              <Plus size={10} />
              {TRACK_ICONS[type]}
            </button>
          ))}
          {/* Zoom */}
          <div className="flex items-center gap-1 ml-2 border border-border rounded-lg overflow-hidden">
            <button onClick={() => setZoom(z => Math.max(0.3, z - 0.2))} className="px-2 py-1 hover:bg-secondary transition-all">
              <ZoomOut size={12} className="text-muted-foreground" />
            </button>
            <span className="text-xs text-muted-foreground px-1">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(5, z + 0.2))} className="px-2 py-1 hover:bg-secondary transition-all">
              <ZoomIn size={12} className="text-muted-foreground" />
            </button>
          </div>
        </div>
      </div>

      {/* Inspector (selected clip) */}
      {sel && (
        <div className="flex items-center gap-4 px-4 py-2 bg-accent/30 border-b border-border shrink-0 text-xs">
          <span className="text-foreground/70 font-medium">Sélectionné :</span>
          <span className="text-foreground">{sel.label || sel.content || sel.id}</span>
          <label className="text-muted-foreground flex items-center gap-1">
            Début :
            <input
              type="number" min={0} step={0.1}
              value={sel.startTime ?? 0}
              onChange={e => updateClip(selectedClip.trackId, sel.id, { startTime: parseFloat(e.target.value) })}
              className="w-14 bg-secondary rounded px-1.5 py-0.5 text-foreground ml-1"
            />s
          </label>
          <label className="text-muted-foreground flex items-center gap-1">
            Durée :
            <input
              type="number" min={0.5} step={0.1}
              value={sel.duration ?? 4}
              onChange={e => updateClip(selectedClip.trackId, sel.id, { duration: parseFloat(e.target.value) })}
              className="w-14 bg-secondary rounded px-1.5 py-0.5 text-foreground ml-1"
            />s
          </label>
          {sel.content !== undefined && (
            <label className="text-muted-foreground flex items-center gap-1">
              Texte :
              <input
                type="text"
                value={sel.content}
                onChange={e => updateClip(selectedClip.trackId, sel.id, { content: e.target.value })}
                className="w-40 bg-secondary rounded px-1.5 py-0.5 text-foreground ml-1"
              />
            </label>
          )}
          <button onClick={() => splitClip(selectedClip.trackId, sel.id)} title="Couper ici"
            className="flex items-center gap-1 px-2 py-1 rounded bg-secondary hover:bg-accent text-muted-foreground hover:text-foreground">
            <Scissors size={11} /> Couper
          </button>
          <button onClick={() => deleteClip(selectedClip.trackId, sel.id)}
            className="ml-auto text-destructive hover:opacity-70">
            <Trash2 size={12} />
          </button>
        </div>
      )}

      {/* Timeline scroll area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Track labels */}
        <div className="w-32 shrink-0 border-r border-border flex flex-col">
          {/* ruler spacer */}
          <div className="h-6 border-b border-border bg-muted/40" />
          {tracks.map(track => (
            <div key={track.id} className="h-12 border-b border-border flex items-center px-2 gap-1 group">
              <span className="text-xs">{TRACK_ICONS[track.type] || "▪"}</span>
              <span className="text-xs text-muted-foreground flex-1 truncate">{track.label}</span>
              <button onClick={() => toggleHide(track.id)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                {hiddenTracks[track.id]
                  ? <EyeOff size={10} className="text-muted-foreground" />
                  : <Eye size={10} className="text-muted-foreground" />
                }
              </button>
              <button onClick={() => deleteTrack(track.id)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 size={10} className="text-destructive/70 hover:text-destructive" />
              </button>
            </div>
          ))}
        </div>

        {/* Scrollable tracks area */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div style={{ width: totalWidth }} className="relative">
            {/* Ruler */}
            <div
              ref={timelineRef}
              onClick={handleTimelineClick}
              className="h-6 border-b border-border bg-muted/40 relative cursor-pointer"
            >
              {Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => (
                <div key={i} style={{ left: i * pxPerSecond }} className="absolute top-0 h-full flex flex-col justify-end pb-0.5">
                  <div className="w-px h-2 bg-border" />
                  {i % Math.max(1, Math.floor(5 / zoom)) === 0 && (
                    <span className="absolute top-0.5 text-[9px] text-muted-foreground left-1">{i}s</span>
                  )}
                </div>
              ))}
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-px bg-primary z-20 pointer-events-none"
                style={{ left: currentTime * pxPerSecond }}
              >
                <div className="w-2 h-2 bg-primary rounded-full -translate-x-0.5 -translate-y-0.5" />
              </div>
            </div>

            {/* Tracks */}
            {tracks.map(track => (
              <div
                key={track.id}
                className="h-12 border-b border-border relative"
                style={{ opacity: hiddenTracks[track.id] ? 0.3 : 1 }}
              >
                {/* Drop zone background */}
                <div className="absolute inset-0 bg-secondary/10" />

                {/* Clips */}
                {(track.clips || []).map(clip => {
                  const left = (clip.startTime ?? 0) * pxPerSecond;
                  const width = Math.max(12, (clip.duration ?? 4) * pxPerSecond);
                  const isSelected = selectedClip?.clipId === clip.id;
                  const colorClass = TRACK_COLORS[track.type] || TRACK_COLORS.video;

                  return (
                    <div
                      key={clip.id}
                      className={`absolute top-1 bottom-1 rounded-md border flex items-center overflow-hidden cursor-grab active:cursor-grabbing group
                        ${colorClass} ${isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
                      style={{ left, width }}
                      onMouseDown={e => handleMouseDown(e, { ...clip, trackId: track.id }, "move")}
                      onClick={e => { e.stopPropagation(); setSelectedClip({ clipId: clip.id, trackId: track.id }); }}
                    >
                      {/* Resize left */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 z-10"
                        onMouseDown={e => { e.stopPropagation(); handleMouseDown(e, { ...clip, trackId: track.id }, "resize-left"); }}
                      />
                      {/* Content */}
                      <div className="px-2 flex-1 min-w-0 pointer-events-none">
                        <p className="text-xs truncate font-medium">
                          {clip.content || clip.label || `Clip`}
                        </p>
                      </div>
                      {/* Resize right */}
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 z-10"
                        onMouseDown={e => { e.stopPropagation(); handleMouseDown(e, { ...clip, trackId: track.id }, "resize-right"); }}
                      />
                    </div>
                  );
                })}

                {/* Playhead line */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-primary/50 z-10 pointer-events-none"
                  style={{ left: currentTime * pxPerSecond }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
