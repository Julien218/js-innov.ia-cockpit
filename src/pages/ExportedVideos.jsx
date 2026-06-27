import { useState, useEffect } from "react";
import { base44Shim as base44 } from "@/lib/supabaseVideoClient";
import { Download, Play, Trash2, Archive, Eye } from "lucide-react";

const FORMAT_LABELS = {
  webm: "WebM standard",
  social_9_16: "WebM 9:16",
  social_16_9: "WebM 16:9",
  social_1_1: "WebM 1:1",
  multitrack: "Multipiste",
};

export default function ExportedVideos() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    base44.entities.ExportedVideo.filter({ status: "ready" }, "-created_date", 50)
      .then(v => {
        setVideos(v);
        setLoading(false);
      });
  }, []);

  const handleDelete = async (id) => {
    if (!confirm("Supprimer cet export ?")) return;
    await base44.entities.ExportedVideo.delete(id);
    setVideos(videos.filter(v => v.id !== id));
  };

  const handleDownload = (url, title) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, "_")}.webm`;
    a.click();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-foreground">Exports WebM</h1>
        <p className="text-sm text-muted-foreground mt-1">{videos.length} vidéo{videos.length !== 1 ? "s" : ""} prête{videos.length !== 1 ? "s" : ""} à télécharger</p>
      </div>

      {videos.length === 0 ? (
        <div className="card-premium rounded-2xl p-12 text-center">
          <div className="text-4xl mb-4">🎬</div>
          <p className="text-muted-foreground">Aucun export pour le moment.</p>
          <p className="text-xs text-muted-foreground mt-2">Lancez une exportation depuis le Studio vidéo.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map(v => (
            <div key={v.id} className="card-premium rounded-xl overflow-hidden group">
              {/* Miniature preview */}
              <div className="relative h-40 bg-muted/50 flex items-center justify-center overflow-hidden">
                {preview === v.id ? (
                  <video
                    src={v.video_url}
                    controls
                    className="w-full h-full object-cover"
                    autoPlay
                  />
                ) : (
                  <>
                    <div className="text-4xl">🎬</div>
                    <button
                      onClick={() => setPreview(preview === v.id ? null : v.id)}
                      className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Play size={32} className="text-white" fill="white" />
                    </button>
                  </>
                )}
              </div>

              {/* Infos */}
              <div className="p-4 space-y-3">
                <div>
                  <p className="font-semibold text-sm text-foreground truncate">{v.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">
                      {FORMAT_LABELS[v.format] || v.format}
                    </span>
                    {v.duration_seconds && (
                      <span className="text-xs text-muted-foreground">{Math.ceil(v.duration_seconds)}s</span>
                    )}
                    {v.size_mb && (
                      <span className="text-xs text-muted-foreground">{v.size_mb.toFixed(1)} MB</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownload(v.video_url, v.title)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-all"
                  >
                    <Download size={13} />
                    Télécharger
                  </button>
                  <button
                    onClick={() => setPreview(preview === v.id ? null : v.id)}
                    className="px-3 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground text-xs transition-colors"
                    title="Aperçu"
                  >
                    <Eye size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(v.id)}
                    className="px-3 py-2 rounded-lg border border-border text-destructive hover:bg-destructive/10 text-xs transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {/* Lien direct */}
                <a
                  href={v.video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary/70 hover:text-primary truncate block"
                >
                  Voir en ligne →
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
