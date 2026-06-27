import { useState, useRef } from "react";
import { base44Shim as base44 } from "@/lib/supabaseVideoClient";
import { Upload, Music, Type, Plus, Image, Loader2, ChevronDown, ChevronUp, Scissors } from "lucide-react";
import ClipEditTools from "./ClipEditTools";

// Inline editable text overlay item
function TextItem({ text, onUpdate, onRemove }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="card-premium rounded-lg p-2.5 text-xs space-y-1.5 border border-border">
      <div className="flex items-center justify-between gap-1">
        <p className="font-medium text-foreground truncate flex-1">"{text.content || "…"}"</p>
        <button onClick={() => setExpanded(e => !e)} className="text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>
      {!expanded && (
        <p className="text-muted-foreground">{text.position} · {text.size}</p>
      )}
      {expanded && (
        <div className="space-y-1.5 pt-1 border-t border-border">
          <input value={text.content} onChange={e => onUpdate({...text, content: e.target.value})}
            placeholder="Texte…" className="w-full bg-input border border-border rounded px-2 py-1 text-foreground text-xs" />
          <select value={text.position} onChange={e => onUpdate({...text, position: e.target.value})}
            className="w-full bg-input border border-border rounded px-2 py-1 text-foreground text-xs">
            <option value="haut">Haut</option>
            <option value="centre">Centre</option>
            <option value="bas">Bas</option>
          </select>
          <div className="flex gap-1.5">
            <input type="color" value={text.color || "#ffffff"} onChange={e => onUpdate({...text, color: e.target.value})} className="w-7 h-6 rounded cursor-pointer border-0 shrink-0" />
            <select value={text.size} onChange={e => onUpdate({...text, size: e.target.value})}
              className="flex-1 bg-input border border-border rounded px-2 py-1 text-foreground text-xs">
              <option value="1rem">Petit</option>
              <option value="1.5rem">Moyen</option>
              <option value="2rem">Grand</option>
              <option value="3rem">Très grand</option>
            </select>
          </div>
          <button onClick={onRemove} className="text-destructive text-xs hover:underline">Supprimer</button>
        </div>
      )}
    </div>
  );
}

const TEXT_POSITIONS = ["haut", "centre", "bas"];
const TEXT_FONTS = ["Inter, sans-serif", "Playfair Display, serif", "monospace"];
const TEXT_STYLES = ["normal", "gras", "italique"];

export default function StudioSidebar({ vp, update, transitions, sourceProject }) {
  const [tab, setTab] = useState("media");
  const [addingText, setAddingText] = useState(false);
  const [newText, setNewText] = useState({ content: "", position: "centre", color: "#ffffff", size: "2rem", font: "Inter, sans-serif", bold: false });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();
  const audioRef = useRef();

  const handleMediaUpload = async (files) => {
    setUploading(true);
    const newClips = [];
    for (const file of files) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      newClips.push({
        id: `clip_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        url: file_url,
        name: file.name,
        type: file.type.startsWith("video") ? "video" : "image",
        duration: file.type.startsWith("video") ? 10 : 4,
        transition: vp.transition || "fade",
      });
    }
    update("clips", [...(vp.clips || []), ...newClips]);
    setUploading(false);
  };

  const handleAudioUpload = async (file) => {
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    update("audio_url", file_url);
    update("audio_name", file.name);
    setUploading(false);
  };

  const addText = () => {
    const txt = { ...newText, id: `txt_${Date.now()}` };
    update("texts", [...(vp.texts || []), txt]);
    setAddingText(false);
    setNewText({ content: "", position: "centre", color: "#ffffff", size: "2rem", font: "Inter, sans-serif", bold: false });
  };

  const removeText = (id) => update("texts", (vp.texts || []).filter(t => t.id !== id));

  return (
    <div className="w-56 border-r border-border flex flex-col bg-card shrink-0">
      {/* Tabs */}
      <div className="flex border-b border-border">
        {[{ id: "media", icon: <Image size={13} /> }, { id: "audio", icon: <Music size={13} /> }, { id: "text", icon: <Type size={13} /> }, { id: "edit", icon: <Scissors size={13} /> }, { id: "fx", icon: <span className="text-xs">FX</span> }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 py-2 flex justify-center items-center transition-colors ${tab === t.id ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {t.icon}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* MEDIA */}
        {tab === "media" && (
          <>
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-border hover:border-primary/50 text-muted-foreground hover:text-foreground text-xs transition-all">
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {uploading ? "Upload…" : "Ajouter clips / images"}
            </button>
            <input ref={fileRef} type="file" multiple accept="image/*,video/*" className="hidden"
              onChange={e => handleMediaUpload(Array.from(e.target.files))} />
            {/* Source images */}
            {sourceProject?.artworks_images?.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Images du projet</p>
                <div className="grid grid-cols-3 gap-1">
                  {sourceProject.artworks_images.map((url, i) => {
                    const exists = (vp.clips || []).some(c => c.url === url);
                    return (
                      <button key={i} onClick={() => {
                        if (!exists) {
                          const clip = { id: `clip_src_${i}`, url, name: `Image ${i+1}`, type: "image", duration: 4, transition: vp.transition || "fade" };
                          update("clips", [...(vp.clips || []), clip]);
                        }
                      }}
                        className={`aspect-square rounded overflow-hidden border transition-all ${exists ? "border-primary opacity-60" : "border-border hover:border-primary/60"}`}>
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* AUDIO */}
        {tab === "audio" && (
          <div className="space-y-3">
            <button onClick={() => audioRef.current?.click()} disabled={uploading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-border hover:border-primary/50 text-muted-foreground hover:text-foreground text-xs transition-all">
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Music size={13} />}
              {uploading ? "Upload…" : "Ajouter musique / audio"}
            </button>
            <input ref={audioRef} type="file" accept="audio/*" className="hidden"
              onChange={e => handleAudioUpload(e.target.files[0])} />
            {vp.audio_url && (
              <div className="card-premium rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium text-foreground truncate">{vp.audio_name}</p>
                <audio controls src={vp.audio_url} className="w-full" style={{ height: "32px" }} />
                <button onClick={() => { update("audio_url", ""); update("audio_name", ""); }}
                  className="text-xs text-destructive hover:underline">Supprimer</button>
              </div>
            )}
            <div className="mt-2">
              <p className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wide">BPM projet</p>
              <p className="text-primary font-bold text-sm">{sourceProject?.bpm || "–"} BPM</p>
              <p className="text-xs text-muted-foreground mt-0.5">{sourceProject?.music_style || "–"}</p>
            </div>
          </div>
        )}

        {/* TEXT */}
        {tab === "text" && (
          <div className="space-y-2">
            {(vp.texts || []).map((t) => (
              <TextItem
                key={t.id}
                text={t}
                onUpdate={(updated) => update("texts", (vp.texts || []).map(x => x.id === t.id ? updated : x))}
                onRemove={() => removeText(t.id)}
              />
            ))}
            {addingText ? (
              <div className="card-premium rounded-lg p-3 space-y-2 text-xs">
                <input value={newText.content} onChange={e => setNewText(n => ({...n, content: e.target.value}))}
                  placeholder="Texte…" className="w-full bg-input border border-border rounded px-2 py-1.5 text-foreground text-xs" />
                <select value={newText.position} onChange={e => setNewText(n => ({...n, position: e.target.value}))}
                  className="w-full bg-input border border-border rounded px-2 py-1.5 text-foreground text-xs">
                  <option value="haut">Haut</option>
                  <option value="centre">Centre</option>
                  <option value="bas">Bas</option>
                </select>
                <div className="flex gap-1.5">
                  <input type="color" value={newText.color} onChange={e => setNewText(n => ({...n, color: e.target.value}))} className="w-8 h-7 rounded cursor-pointer border-0" />
                  <select value={newText.size} onChange={e => setNewText(n => ({...n, size: e.target.value}))}
                    className="flex-1 bg-input border border-border rounded px-2 py-1 text-foreground text-xs">
                    <option value="1rem">Petit</option>
                    <option value="1.5rem">Moyen</option>
                    <option value="2rem">Grand</option>
                    <option value="3rem">Très grand</option>
                  </select>
                </div>
                <select value={newText.font} onChange={e => setNewText(n => ({...n, font: e.target.value}))}
                  className="w-full bg-input border border-border rounded px-2 py-1.5 text-foreground text-xs">
                  <option value="Inter, sans-serif">Inter</option>
                  <option value="Playfair Display, serif">Playfair Display</option>
                  <option value="monospace">Monospace</option>
                </select>
                <div className="flex gap-2">
                  <button onClick={addText} className="btn-gold flex-1 py-1.5 rounded text-xs">Ajouter</button>
                  <button onClick={() => setAddingText(false)} className="flex-1 py-1.5 rounded border border-border text-muted-foreground text-xs">Annuler</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAddingText(true)}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border-2 border-dashed border-border hover:border-primary/50 text-muted-foreground hover:text-foreground text-xs transition-all">
                <Plus size={13} />Ajouter un texte
              </button>
            )}
          </div>
        )}

        {/* EDIT / DÉCOUPE + ROTATION */}
        {tab === "edit" && (
          <ClipEditTools
            clips={vp.clips || []}
            onChange={(clips) => update("clips", clips)}
          />
        )}

        {/* FX / TRANSITIONS */}
        {tab === "fx" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Transition globale</p>
            <div className="grid grid-cols-2 gap-2">
              {transitions.map(t => (
                <button key={t.id} onClick={() => update("transition", t.id)}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border text-xs transition-all ${vp.transition === t.id ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:border-primary/50"}`}>
                  <span className="text-base">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
