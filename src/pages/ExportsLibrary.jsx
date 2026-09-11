import { useState, useEffect, useRef } from "react";
import { base44Shim as base44 } from "@/lib/supabaseVideoClient";
import { FileVideo, RefreshCw, Loader2 } from "lucide-react";
import { sumExportMetric } from "@/lib/exportMetrics";
import ExportsDashboard from "@/components/studio/ExportsDashboard";

export default function ExportsLibrary() {
  const [exports, setExports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const requestSequence = useRef(0);

  const loadExports = async (isRefresh = false) => {
    const request = ++requestSequence.current;
    setError("");
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    
    try {
      const loaded = await base44.entities.VideoExport.list('-created_date', 100);
      if (request !== requestSequence.current) return;
      setExports(loaded);
      setHasLoaded(true);
    } catch (error) {
      if (request === requestSequence.current) setError(error?.message || "Chargement des exports impossible.");
    } finally {
      if (request === requestSequence.current) { setRefreshing(false); setLoading(false); }
    }
  };

  // Subscription en temps réel aux changements d'exports
  useEffect(() => {
    loadExports();
    
    const unsubscribe = base44.entities.VideoExport.subscribe((event) => {
      setExports((prev) => {
        if (event.type === 'create') {
          return [event.data, ...prev];
        } else if (event.type === 'update') {
          return prev.map((exp) => exp.id === event.id ? event.data : exp);
        } else if (event.type === 'delete') {
          return prev.filter((exp) => exp.id !== event.id);
        }
        return prev;
      });
    });

    return () => { requestSequence.current += 1; unsubscribe(); };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-6 py-8 border-b border-border">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <FileVideo size={20} className="text-primary" />
              </div>
              <div>
                <h1 className="font-display text-2xl font-semibold text-foreground">Médiathèque d'exports</h1>
                <p className="text-sm text-muted-foreground mt-1">Vos exports et leurs fichiers disponibles</p>
              </div>
            </div>
            <button
              onClick={() => loadExports(true)}
              disabled={loading || refreshing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all disabled:opacity-50"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Actualisation…" : "Actualiser"}
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="card-premium rounded-lg p-3">
              <div className="text-2xl font-bold text-primary">{hasLoaded ? exports.length : "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">Exports sauvegardés</div>
            </div>
            <div className="card-premium rounded-lg p-3">
              <div className="text-2xl font-bold text-primary">
                {hasLoaded ? sumExportMetric(exports, "file_size_mb").toFixed(1) : "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">MB au total</div>
            </div>
            <div className="card-premium rounded-lg p-3">
              <div className="text-2xl font-bold text-primary">
                {hasLoaded ? Math.round(sumExportMetric(exports, "duration_seconds") / 60) : "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Minutes de vidéo</div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-8 max-w-6xl mx-auto">
        {error && <div role="alert" className="mb-4 rounded-xl border border-destructive/40 p-4 text-sm">
          <p>{error}</p>
          <p>{hasLoaded ? "Les exports affichés proviennent du dernier chargement réussi." : "Impossible de vérifier les exports. Utilisez Actualiser pour réessayer."}</p>
        </div>}
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-3">
            <Loader2 size={20} className="animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Chargement des exports…</span>
          </div>
        ) : hasLoaded ? (
          <ExportsDashboard exports={exports} />
        ) : null}
      </div>
    </div>
  );
}
