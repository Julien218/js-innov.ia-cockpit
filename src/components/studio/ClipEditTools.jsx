import { useState } from "react";
import { Scissors, RotateCw, ChevronDown, ChevronUp, Trash2 } from "lucide-react";

const ROTATIONS = [
  { label: "0°",   value: 0,   icon: "↕" },
  { label: "90°",  value: 90,  icon: "↻" },
  { label: "180°", value: 180, icon: "↕" },
  { label: "270°", value: 270, icon: "↺" },
];

function ClipCard({ clip, index, onUpdate, onRemove, onSplit }) {
  const [expanded, setExpanded] = useState(false);
  const rotation = clip.rotation || 0;

  const rotate = (deg) => onUpdate({ ...clip, rotation: deg });

  const handleSplit = () => {
    const half = (clip.duration || 4) / 2;
    onSplit(index, half);
  };

  return (
    <div className="card-premium rounded-lg border border-border text-xs overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center text-primary font-bold shrink-0">
          {index + 1}
        </div>
        <p className="flex-1 truncate text-foreground font-medium">{clip.name || `Clip ${index + 1}`}</p>
        <button onClick={() => setExpanded(e => !e)} className="text-muted-foreground hover:text-foreground shrink-0">
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-3 border-t border-border pt-2.5">
          {/* Duration */}
          <div>
            <label className="text-muted-foreground uppercase tracking-wide text-[10px]">Durée (s)</label>
            <input
              type="number"
              min={0.5}
              max={60}
              step={0.5}
              value={clip.duration || 4}
              onChange={e => onUpdate({ ...clip, duration: parseFloat(e.target.value) || 4 })}
              className="w-full mt-1 bg-input border border-border rounded px-2 py-1 text-foreground text-xs"
            />
          </div>

          {/* Rotation */}
          <div>
            <label className="text-muted-foreground uppercase tracking-wide text-[10px] flex items-center gap-1">
              <RotateCw size={10} /> Rotation
            </label>
            <div className="grid grid-cols-4 gap-1 mt-1">
              {ROTATIONS.map(r => (
                <button
                  key={r.value}
                  onClick={() => rotate(r.value)}
                  className={`flex flex-col items-center py-1.5 rounded border text-[10px] transition-all ${
                    rotation === r.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  <span className="text-sm leading-none">{r.icon}</span>
                  <span>{r.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Trim start/end */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-muted-foreground uppercase tracking-wide text-[10px]">Début (s)</label>
              <input
                type="number"
                min={0}
                step={0.1}
                value={clip.trimStart || 0}
                onChange={e => onUpdate({ ...clip, trimStart: parseFloat(e.target.value) || 0 })}
                className="w-full mt-1 bg-input border border-border rounded px-2 py-1 text-foreground text-xs"
              />
            </div>
            <div>
              <label className="text-muted-foreground uppercase tracking-wide text-[10px]">Fin (s)</label>
              <input
                type="number"
                min={0}
                step={0.1}
                value={clip.trimEnd || 0}
                onChange={e => onUpdate({ ...clip, trimEnd: parseFloat(e.target.value) || 0 })}
                className="w-full mt-1 bg-input border border-border rounded px-2 py-1 text-foreground text-xs"
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">Découpe : début et fin rognés depuis l'original</p>

          {/* Actions */}
          <div className="flex gap-1.5">
            <button
              onClick={handleSplit}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/50 transition-all text-[11px]"
              title="Couper en 2 au milieu"
            >
              <Scissors size={11} /> Couper en 2
            </button>
            <button
              onClick={onRemove}
              className="p-1.5 rounded border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-all"
              title="Supprimer"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ClipEditTools({ clips, onChange }) {
  const updateClip = (index, updated) => {
    const next = clips.map((c, i) => i === index ? updated : c);
    onChange(next);
  };

  const removeClip = (index) => {
    onChange(clips.filter((_, i) => i !== index));
  };

  // Split clip at `atSec` → becomes 2 clips
  const splitClip = (index, atSec) => {
    const clip = clips[index];
    const totalDur = clip.duration || 4;
    const firstDur = Math.max(0.5, Math.min(atSec, totalDur - 0.5));
    const secondDur = totalDur - firstDur;

    const first  = { ...clip, duration: firstDur,  id: clip.id };
    const second = { ...clip, duration: secondDur, id: `${clip.id}_split_${Date.now()}`, name: `${clip.name || "Clip"} (2)` };

    const next = [...clips];
    next.splice(index, 1, first, second);
    onChange(next);
  };

  if (!clips || clips.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-xs">
        <Scissors size={20} className="mx-auto mb-2 opacity-30" />
        Aucun clip dans la timeline
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
        {clips.length} clip{clips.length > 1 ? "s" : ""} — cliquez pour éditer
      </p>
      {clips.map((clip, i) => (
        <ClipCard
          key={clip.id || i}
          clip={clip}
          index={i}
          onUpdate={(updated) => updateClip(i, updated)}
          onRemove={() => removeClip(i)}
          onSplit={splitClip}
        />
      ))}
    </div>
  );
}
