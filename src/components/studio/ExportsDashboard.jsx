import { useState, useRef } from "react";
import { Download, Eye, FileVideo, Calendar, HardDrive, Search, ChevronDown, Loader2 } from "lucide-react";
import VideoPlayer from "@/components/ExportsLibrary/VideoPlayer";

export default function ExportsDashboard({ exports = [] }) {
  const [selectedExport, setSelectedExport] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("recent"); // recent | oldest | name
  const [showSortMenu, setShowSortMenu] = useState(false);
  const videoRef = useRef(null);

  const handleDownload = (videoExport) => {
    const a = document.createElement("a");
    a.href = videoExport.file_url;
    a.download = `${videoExport.title.replace(/\s+/g, "_")}_${videoExport.format || "export"}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "–";
    return new Date(dateStr).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatSize = (mb) => {
    if (!mb) return "–";
    return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
  };

  // Filtrer et trier les exports
  const filteredExports = exports.filter(exp => 
    exp.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    exp.export_type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const sortedExports = [...filteredExports].sort((a, b) => {
    if (sortBy === "name") {
      return a.title.localeCompare(b.title);
    } else if (sortBy === "oldest") {
      return new Date(a.created_date) - new Date(b.created_date);
    } else {
      // recent (défaut)
      return new Date(b.created_date) - new Date(a.created_date);
    }
  });

  if (exports.length === 0) {
    return (
      <div className="card-premium rounded-2xl p-12 text-center space-y-4">
        <FileVideo size={40} className="text-muted-foreground/40 mx-auto" />
        <p className="text-sm text-muted-foreground">Aucun export enregistré pour le moment.</p>
        <p className="text-xs text-muted-foreground/60">Lancez un export WebM pour voir les fichiers ici.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Video player modal */}
      {selectedExport && (
        <VideoPlayer videoExport={selectedExport} onClose={() => setSelectedExport(null)} />
      )}

      {/* Search and sort */}
      <div className="flex items-center gap-3 mb-6">
        {/* Search */}
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Rechercher par titre ou type…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-input border border-border rounded-xl text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Sort dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all"
          >
            Trier par
            <ChevronDown size={16} className={`transition-transform ${showSortMenu ? "rotate-180" : ""}`} />
          </button>
          {showSortMenu && (
            <div className="absolute top-full right-0 mt-2 w-48 bg-card border border-border rounded-xl shadow-lg z-10">
              {[
                { id: "recent", label: "Plus récents" },
                { id: "oldest", label: "Plus anciens" },
                { id: "name", label: "Nom (A-Z)" },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => {
                    setSortBy(opt.id);
                    setShowSortMenu(false);
                  }}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                    sortBy === opt.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  } ${opt.id === "recent" ? "rounded-t-xl" : ""} ${opt.id === "name" ? "rounded-b-xl" : ""}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Results count */}
      {searchTerm && (
        <p className="text-xs text-muted-foreground mb-4">{sortedExports.length} résultat{sortedExports.length !== 1 ? "s" : ""} trouvé{sortedExports.length !== 1 ? "s" : ""}</p>
      )}

      {/* Exports grid */}
      {sortedExports.length === 0 ? (
        <div className="card-premium rounded-2xl p-12 text-center space-y-4">
          <Search size={40} className="text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">Aucun export ne correspond à votre recherche.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedExports.map((exp) => (
            <div key={exp.id} className="card-premium rounded-xl overflow-hidden flex flex-col hover:border-primary/40 transition-all">
            {/* Thumbnail / Preview */}
            <div className="relative h-32 bg-black/50 flex items-center justify-center group overflow-hidden">
              {exp.file_url ? (
                <>
                  <video
                    src={exp.file_url}
                    className="w-full h-full object-cover"
                    preload="metadata"
                    onMouseEnter={(e) => {
                      e.target.currentTime = 0;
                      e.target.play().catch(() => {});
                    }}
                    onMouseLeave={(e) => e.target.pause()}
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent hidden group-hover:flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={() => setSelectedExport(exp)}
                      className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-all"
                    >
                      <Eye size={18} />
                    </button>
                  </div>
                </>
              ) : (
                <FileVideo size={32} className="text-muted-foreground/40" />
              )}
              {/* Format badge */}
              {exp.format && (
                <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded text-xs font-medium text-white">
                  {exp.format}
                </div>
              )}
              {/* Duration badge */}
              {exp.duration_seconds && (
                <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded text-xs text-white">
                  {exp.duration_seconds}s
                </div>
              )}
            </div>

            {/* Info */}
            <div className="p-4 flex-1 flex flex-col gap-3">
              <div>
                <h3 className="font-semibold text-sm text-foreground truncate">{exp.title}</h3>
                <div className="flex items-center gap-2 mt-1">
                  {exp.status === 'completed' ? (
                    <span className="text-xs text-green-400">✓ Prêt</span>
                  ) : exp.status === 'error' ? (
                    <span className="text-xs text-destructive">✕ Erreur</span>
                  ) : (
                    <>
                      <Loader2 size={12} className="animate-spin text-primary" />
                      <span className="text-xs text-primary">Génération…</span>
                    </>
                  )}
                  <span className="text-xs text-muted-foreground">· {exp.export_type}</span>
                </div>
              </div>

              {/* Metadata */}
              <div className="space-y-1.5">
                {exp.status === 'completed' && exp.file_size_mb && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <HardDrive size={12} />
                    <span>{formatSize(exp.file_size_mb)}</span>
                  </div>
                )}
                {exp.created_date && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar size={12} />
                    <span>{formatDate(exp.created_date)}</span>
                  </div>
                )}
                {exp.status !== 'completed' && (
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mt-2">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        exp.status === 'error' ? 'bg-destructive' : 'bg-primary'
                      }`}
                      style={{
                        width: exp.status === 'error' ? '100%' : '60%',
                        animation: exp.status === 'error' ? 'none' : 'pulse 1.5s ease-in-out infinite',
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-auto pt-2">
                <button
                  onClick={() => setSelectedExport(exp)}
                  disabled={exp.status !== 'completed'}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Eye size={13} /> {exp.status === 'completed' ? 'Visionner' : 'En attente'}
                </button>
                <button
                  onClick={() => handleDownload(exp)}
                  disabled={exp.status !== 'completed'}
                  className="btn-gold flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download size={13} />
                </button>
              </div>
            </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
