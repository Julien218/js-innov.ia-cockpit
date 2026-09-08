import React from "react";
import { BarChart3, Camera, CheckCircle2, CircleAlert, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

async function api(path, options = {}, clientEmail = "") {
  const response = await fetch(`/api/signage${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(clientEmail ? { "X-Client-Email": clientEmail } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Opération impossible (HTTP ${response.status})`);
  return body;
}

const isRecent = (value, windowMs = 120_000) => {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < windowMs;
};

const cameraScore = camera => {
  const name = String(camera?.name || "").toLowerCase();
  let score = 0;
  if (/écran|ecran|screen|led|affichage|display/.test(name)) score += 100;
  if (camera?.status === "online") score += 30;
  if (isRecent(camera?.snapshot_at, 130_000)) score += 20;
  if (isRecent(camera?.last_seen_at, 120_000)) score += 10;
  return score;
};

const pickScreenCamera = cameras => [...(cameras || [])].sort((a, b) => cameraScore(b) - cameraScore(a))[0] || null;

function AnalysisThumb({ analysisId, frameId, managedClient, label }) {
  const [url, setUrl] = React.useState("");
  React.useEffect(() => {
    if (!analysisId || !frameId) return undefined;
    let active = true;
    let objectUrl = "";
    fetch(`/api/signage/manage/screen-analysis/${analysisId}/frames/${frameId}`, {
      credentials: "same-origin",
      headers: managedClient ? { "X-Client-Email": managedClient } : {},
      cache: "no-store",
    }).then(async response => {
      if (!response.ok) throw new Error("Capture indisponible");
      return response.blob();
    }).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [analysisId, frameId, managedClient]);

  return <div className="aspect-video overflow-hidden rounded-xl border bg-black">
    {url ? <img src={url} alt={label} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-white/35"><Camera className="h-6 w-6" /></div>}
  </div>;
}

export default function ScreenAdAnalysis({ managedClient = "", enabled = true }) {
  const cameraQuery = useQuery({
    queryKey: ["signelya-ad-analysis-cameras", managedClient || "self"],
    queryFn: () => api("/manage/camera-dashboard", {}, managedClient),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
  const camera = pickScreenCamera(cameraQuery.data?.cameras || []);
  const [analysis, setAnalysis] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!analysis?.id || !["queued", "running"].includes(analysis.status)) return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const next = await api(`/manage/screen-analysis/${analysis.id}`, {}, managedClient);
        if (active) setAnalysis(next);
      } catch (refreshError) {
        if (active) setError(refreshError.message);
      }
    };
    const timer = window.setInterval(refresh, 3000);
    refresh();
    return () => { active = false; window.clearInterval(timer); };
  }, [analysis?.id, analysis?.status, managedClient]);

  const start = async () => {
    if (!camera?.id) return;
    setBusy(true);
    setError("");
    try {
      const result = await api("/manage/screen-analysis", {
        method: "POST",
        body: JSON.stringify({ cameraId: camera.id, intervalSeconds: 4 }),
      }, managedClient);
      setAnalysis(result);
    } catch (startError) {
      setError(startError.message);
    } finally {
      setBusy(false);
    }
  };

  const running = analysis && ["queued", "running"].includes(analysis.status);
  const completed = analysis?.status === "completed";
  const cameraOnline = Boolean(camera && camera.status === "online" && isRecent(camera.last_seen_at));

  return <section className="rounded-2xl border border-violet-500/20 bg-card p-4 shadow-sm md:p-5">
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-600">
          <BarChart3 className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-bold">Contrôle des annonces diffusées</p>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Compare le programme publié avec les captures réelles de la dalle. Le mode normal reste à 60 s ; l’analyse rapide ne s’active que pendant une boucle après un clic.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={start}
        disabled={busy || running || !cameraOnline}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(110deg,#0066ff,#8a2be2_70%,#ff2bd6)] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy || running ? <Loader2 className="h-4 w-4 animate-spin" /> : completed ? <RefreshCw className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
        {running ? "Analyse en cours…" : completed ? "Relancer l’analyse" : "Analyser la diffusion"}
      </button>
    </div>

    {!camera && <div className="mt-4 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">Associez d’abord la caméra placée face à l’écran dans Vidéosurveillance.</div>}
    {camera && !cameraOnline && <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-sm text-amber-700">La caméra de contrôle est enregistrée mais n’est pas encore en ligne avec sa passerelle locale.</div>}
    {error && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700">{error}</div>}

    {analysis && <div className="mt-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-background/60 p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Programme</p><p className="mt-1 text-sm font-semibold">{analysis.expectedCount} annonce(s)</p></div>
        <div className="rounded-xl border bg-background/60 p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Boucle estimée</p><p className="mt-1 text-sm font-semibold">{Math.round(analysis.loopSeconds || 0)} s</p></div>
        <div className="rounded-xl border bg-background/60 p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Confirmées visuellement</p><p className={`mt-1 text-sm font-semibold ${analysis.allSeen ? "text-emerald-600" : ""}`}>{analysis.observedCount}/{analysis.expectedCount}</p></div>
        <div className="rounded-xl border bg-background/60 p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Référencement</p><p className="mt-1 text-sm font-semibold">{analysis.alignment === "player_timeline" ? "Player + caméra" : "À confirmer"}</p></div>
      </div>

      {running && <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] p-3 text-sm text-muted-foreground">
        L’analyse parcourt environ {analysis.durationSeconds} secondes. Les captures sont réduites et ne sont envoyées que pendant ce contrôle ponctuel.
      </div>}

      {analysis.frozenSuspected && <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] p-3 text-sm text-amber-800"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>Peu de changements visuels ont été détectés alors que plusieurs annonces étaient attendues : image figée ou cadrage caméra à vérifier.</span></div>}

      {completed && analysis.allSeen && <div className="flex items-start gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>Toutes les annonces programmées ont reçu au moins une capture caméra dans leur fenêtre de diffusion.</span></div>}

      <div className="space-y-3">
        {(analysis.items || []).map(item => <div key={`${item.order}-${item.mediaId}`} className="grid gap-3 rounded-2xl border p-3 md:grid-cols-[150px_minmax(0,1fr)_auto] md:items-center">
          <AnalysisThumb analysisId={analysis.id} frameId={item.representativeFrameId} managedClient={managedClient} label={`Capture ${item.mediaName}`} />
          <div className="min-w-0">
            <p className="text-sm font-bold">{item.order}. {item.mediaName}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Durée {item.durationEstimated ? "estimée" : "programmée"} : {item.durationEstimated ? "≈" : ""}{Number(item.durationSeconds || 0).toFixed(1).replace(".0", "")} s
              {item.representativeAt ? ` · capture ${new Date(item.representativeAt).toLocaleTimeString("fr-BE")}` : ""}
            </p>
            {item.screenshotCount > 1 && <p className="mt-1 text-xs text-muted-foreground">{item.screenshotCount} captures reçues dans cette fenêtre.</p>}
          </div>
          <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${item.visualStatus === "confirmed" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : "border-amber-500/30 bg-amber-500/10 text-amber-700"}`}>
            <span className={`h-2 w-2 rounded-full ${item.visualStatus === "confirmed" ? "bg-emerald-500" : "bg-amber-500"}`} />
            {item.visualStatus === "confirmed" ? "OK · capture écran" : running ? "À observer" : "Non confirmé"}
          </span>
        </div>)}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        « OK · capture écran » signifie qu’une image caméra a été reçue pendant la fenêtre où le Player devait diffuser cette annonce. Le screenshot reste visible pour contrôle humain. Les durées marquées ≈8 s sont estimées tant que le fichier ne fournit pas sa durée exacte dans les métadonnées.
      </p>
    </div>}
  </section>;
}
