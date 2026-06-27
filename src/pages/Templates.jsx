import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { VIDEO_TEMPLATES } from "@/data/videoTemplates";
import { base44 } from "@/api/base44Client";
import { Play, Clock, Layers, Music, ChevronRight, Check } from "lucide-react";

const CATEGORIES = [
  { id: "all", label: "Tous" },
  { id: "social", label: "📱 Social" },
  { id: "publicite", label: "🔥 Pub" },
  { id: "creative", label: "🎨 Créatif" },
  { id: "corporate", label: "🏢 Corporate" },
];

export default function Templates() {
  const navigate = useNavigate();
  const [category, setCategory] = useState("all");
  const [creating, setCreating] = useState(null);
  const [preview, setPreview] = useState(null);

  const filtered = category === "all" ? VIDEO_TEMPLATES : VIDEO_TEMPLATES.filter(t => t.category === category);

  const handleUse = async (template) => {
    setCreating(template.id);
    // Créer un VideoProject depuis le template
    const now = Date.now();
    const tracks = template.tracks.map(track => ({
      ...track,
      clips: track.clips.map(clip => ({ ...clip, id: `${clip.id}_${now}` })),
    }));
    const vp = await base44.entities.VideoProject.create({
      title: `${template.label} — ${new Date().toLocaleDateString("fr-FR")}`,
      clips: tracks.flatMap(t => t.clips),
      transition: template.transitions,
      status: "draft",
      ai_prompt: "",
      audio_name: "",
      audio_url: "",
      texts: tracks.filter(t => t.type === "text").flatMap(t =>
        t.clips.map(c => ({
          content: c.content,
          position: c.style?.position || "center",
          color: c.style?.color || "#ffffff",
          size: `${c.style?.fontSize || 36}px`,
          bold: c.style?.bold || false,
          animation: c.style?.animation || "fadeIn",
          startTime: c.startTime,
          duration: c.duration,
        }))
      ),
      // Stocker les données de template enrichies
      template_id: template.id,
      template_tracks: tracks,
      template_duration: template.duration,
      template_format: template.format,
      template_colors: template.colors,
    });
    setCreating(null);
    navigate(`/studio/${vp.id}`);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-6 py-8 border-b border-border">
        <h1 className="font-display text-2xl font-semibold text-foreground">Templates vidéo</h1>
        <p className="text-sm text-muted-foreground mt-1">13 modèles préconfigurés — TikTok, Reels, LinkedIn, Twitter, Pinterest et plus</p>
      </div>

      <div className="px-6 py-6 max-w-6xl mx-auto">
        {/* Filtres */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {CATEGORIES.map(c => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                category === c.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Grille */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(template => (
            <div
              key={template.id}
              className={`card-premium rounded-2xl overflow-hidden flex flex-col cursor-pointer transition-all hover:border-primary/40 ${
                preview === template.id ? "border-primary/60 shadow-lg shadow-primary/10" : ""
              }`}
              onClick={() => setPreview(preview === template.id ? null : template.id)}
            >
              {/* Visuel du template */}
              <div
                className="h-40 flex items-center justify-center relative overflow-hidden"
                style={{ background: `linear-gradient(135deg, ${template.colors.bg}, ${template.colors.primary}22)` }}
              >
                {/* Format badge */}
                <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-lg text-xs text-white font-medium">
                  {template.format}
                </div>
                {/* Durée badge */}
                <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-lg text-xs text-white flex items-center gap-1">
                  <Clock size={10} />
                  {template.duration}s
                </div>
                {/* Emoji central */}
                <div className="text-6xl">{template.emoji}</div>
                {/* Preview des scènes */}
                <div className="absolute bottom-3 left-3 right-3 flex gap-1">
                  {template.scenes.map((scene, i) => (
                    <div
                      key={i}
                      className="h-1.5 rounded-full flex-1 opacity-70"
                      style={{
                        backgroundColor: template.colors.primary,
                        flexGrow: scene.duration,
                      }}
                      title={scene.label}
                    />
                  ))}
                </div>
              </div>

              {/* Infos */}
              <div className="p-4 flex-1 flex flex-col gap-3">
                <div>
                  <h3 className="font-semibold text-sm text-foreground">{template.label}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {template.tracks.length} pistes · {template.scenes.length} scènes
                  </p>
                </div>

                {/* Pistes */}
                <div className="flex flex-wrap gap-1">
                  {template.tracks.map(track => (
                    <span key={track.id} className="text-xs px-2 py-0.5 bg-secondary rounded-full text-muted-foreground">
                      {track.type === "video" ? "🎬" : track.type === "text" ? "T" : track.type === "image" ? "🖼️" : track.type === "audio" ? "🎵" : "✨"} {track.label}
                    </span>
                  ))}
                </div>

                {/* Musique */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Music size={11} />
                  {template.music_style}
                </div>

                {/* Scènes détail si preview */}
                {preview === template.id && (
                  <div className="border-t border-border pt-3 space-y-1.5">
                    <p className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mb-2">Structure des scènes</p>
                    {template.scenes.map((scene, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <div className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold"
                          style={{ backgroundColor: template.colors.primary + "33", color: template.colors.primary }}>
                          {i + 1}
                        </div>
                        <span className="text-foreground/80">{scene.label}</span>
                        <span className="ml-auto text-muted-foreground">{scene.duration}s</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 mt-auto pt-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleUse(template); }}
                    disabled={creating === template.id}
                    className="btn-gold flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium disabled:opacity-60"
                  >
                    {creating === template.id ? (
                      <span className="w-3 h-3 border border-current/30 border-t-current rounded-full animate-spin" />
                    ) : (
                      <ChevronRight size={13} />
                    )}
                    {creating === template.id ? "Création…" : "Utiliser ce template"}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setPreview(preview === template.id ? null : template.id); }}
                    className="px-3 py-2.5 rounded-xl border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all"
                    title="Voir le détail"
                  >
                    <Layers size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
