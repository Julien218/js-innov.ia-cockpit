import { useState } from "react";
import { Trash2, GripVertical, ChevronUp, ChevronDown, Clock } from "lucide-react";

export default function TimelineEditor({ clips, onChange, transition, transitions, onGlobalTransition, currentClipIdx, onSelect }) {
  const move = (idx, dir) => {
    const arr = [...clips];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= arr.length) return;
    [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
    onChange(arr);
  };

  const remove = (idx) => onChange(clips.filter((_, i) => i !== idx));

  const setDuration = (idx, val) => {
    const arr = clips.map((c, i) => i === idx ? { ...c, duration: Number(val) } : c);
    onChange(arr);
  };

  const setClipTransition = (idx, val) => {
    const arr = clips.map((c, i) => i === idx ? { ...c, transition: val } : c);
    onChange(arr);
  };

  const totalDuration = clips.reduce((s, c) => s + (c.duration || 4), 0);

  return (
    <div className="p-3 space-y-2 min-h-full">
      {/* Global controls */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock size={12} />
          <span>Total : <strong className="text-foreground">{totalDuration}s</strong></span>
          <span>·</span>
          <span>{clips.length} clip{clips.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Transition globale :</span>
          <select
            value={transition}
            onChange={e => onGlobalTransition(e.target.value)}
            className="bg-input border border-border rounded px-2 py-1 text-xs text-foreground"
          >
            {transitions.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
          </select>
        </div>
      </div>

      {clips.length === 0 ? (
        <div className="text-center text-muted-foreground text-xs py-8">
          Ajoutez des clips depuis la sidebar pour construire votre timeline.
        </div>
      ) : (
        <div className="space-y-1.5">
          {clips.map((clip, idx) => (
            <div
              key={clip.id || idx}
              onClick={() => onSelect(idx)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2.5 border cursor-pointer transition-all group ${
                currentClipIdx === idx
                  ? "border-primary bg-accent"
                  : "border-border hover:border-primary/40 bg-card"
              }`}
            >
              {/* Thumbnail */}
              <div className="w-12 h-8 rounded overflow-hidden border border-border shrink-0">
                {clip.type === "video" ? (
                  <video src={clip.url} className="w-full h-full object-cover" muted />
                ) : (
                  <img src={clip.url} alt="" className="w-full h-full object-cover" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{clip.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">{clip.type === "video" ? "🎬" : "🖼"}</span>
                  <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                </div>
              </div>

              {/* Duration */}
              <div className="flex items-center gap-1 shrink-0">
                <Clock size={10} className="text-muted-foreground" />
                <input
                  type="number"
                  value={clip.duration || 4}
                  onChange={e => { e.stopPropagation(); setDuration(idx, e.target.value); }}
                  onClick={e => e.stopPropagation()}
                  min={1} max={60}
                  className="w-10 bg-input border border-border rounded px-1 py-0.5 text-xs text-center text-foreground"
                />
                <span className="text-xs text-muted-foreground">s</span>
              </div>

              {/* Transition */}
              <select
                value={clip.transition || transition}
                onChange={e => { e.stopPropagation(); setClipTransition(idx, e.target.value); }}
                onClick={e => e.stopPropagation()}
                className="bg-input border border-border rounded px-1.5 py-0.5 text-xs text-foreground shrink-0"
              >
                {transitions.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
              </select>

              {/* Actions */}
              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={e => { e.stopPropagation(); move(idx, -1); }} className="p-1 text-muted-foreground hover:text-foreground">
                  <ChevronUp size={12} />
                </button>
                <button onClick={e => { e.stopPropagation(); move(idx, 1); }} className="p-1 text-muted-foreground hover:text-foreground">
                  <ChevronDown size={12} />
                </button>
                <button onClick={e => { e.stopPropagation(); remove(idx); }} className="p-1 text-muted-foreground hover:text-destructive">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
