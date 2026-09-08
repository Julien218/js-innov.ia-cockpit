import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, CheckCircle2, CircleAlert, Eye, ShieldCheck } from "lucide-react";

async function fetchCameraDashboard(clientEmail = "") {
  const response = await fetch("/api/signage/manage/camera-dashboard", {
    credentials: "same-origin",
    headers: clientEmail ? { "X-Client-Email": clientEmail } : {},
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "Vidéosurveillance indisponible");
    error.status = response.status;
    throw error;
  }
  return body;
}

const isRecent = (value, windowMs = 90_000) => {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < windowMs;
};

const cameraScore = camera => {
  const name = String(camera?.name || "").toLowerCase();
  let score = 0;
  if (/écran|ecran|screen|led|affichage|display/.test(name)) score += 100;
  if (camera?.status === "online") score += 30;
  if (isRecent(camera?.snapshot_at, 30_000)) score += 20;
  if (isRecent(camera?.last_seen_at, 90_000)) score += 10;
  return score;
};

function pickScreenCamera(cameras = []) {
  return [...cameras].sort((a, b) => cameraScore(b) - cameraScore(a))[0] || null;
}

export default function ScreenCameraProof({ managedClient = "", enabled = true, isAdmin = false }) {
  const query = useQuery({
    queryKey: ["signelya-screen-camera", managedClient || "self"],
    queryFn: () => fetchCameraDashboard(managedClient),
    enabled,
    refetchInterval: 15_000,
    retry: false,
  });

  const cameras = query.data?.cameras || [];
  const camera = pickScreenCamera(cameras);
  const [snapshotUrl, setSnapshotUrl] = React.useState("");
  const [snapshotReceivedAt, setSnapshotReceivedAt] = React.useState(0);
  const [snapshotError, setSnapshotError] = React.useState("");

  React.useEffect(() => {
    if (!camera?.id) {
      setSnapshotUrl(current => {
        if (current) URL.revokeObjectURL(current);
        return "";
      });
      setSnapshotReceivedAt(0);
      setSnapshotError("");
      return undefined;
    }

    let active = true;
    let currentObjectUrl = "";

    const load = async () => {
      try {
        const response = await fetch(`/api/signage/manage/cameras/${camera.id}/snapshot`, {
          credentials: "same-origin",
          headers: managedClient ? { "X-Client-Email": managedClient } : {},
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Snapshot indisponible");
        const blob = await response.blob();
        const nextUrl = URL.createObjectURL(blob);
        if (!active) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = nextUrl;
        setSnapshotUrl(nextUrl);
        setSnapshotReceivedAt(Date.now());
        setSnapshotError("");
      } catch {
        if (active) setSnapshotError("En attente d’un snapshot de la passerelle locale");
      }
    };

    load();
    const timer = window.setInterval(load, 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    };
  }, [camera?.id, managedClient]);

  if (query.error?.status === 403) return null;

  const cameraOnline = Boolean(camera && camera.status === "online" && isRecent(camera.last_seen_at));
  const proofLive = Boolean(cameraOnline && snapshotUrl && Date.now() - snapshotReceivedAt < 20_000);
  const stateLabel = proofLive
    ? "Preuve visuelle reçue"
    : cameraOnline
      ? "Caméra connectée · image en attente"
      : camera
        ? "Caméra hors ligne"
        : "Caméra de contrôle à associer";

  return (
    <section className={`rounded-2xl border p-4 shadow-sm md:p-5 ${proofLive ? "border-emerald-500/25 bg-emerald-500/[0.05]" : "border-amber-500/25 bg-amber-500/[0.05]"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${proofLive ? "bg-emerald-500 text-white" : "bg-amber-500/15 text-amber-700"}`}>
            {proofLive ? <CheckCircle2 className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
          </span>
          <div>
            <p className="text-sm font-bold">Preuve visuelle de l’écran</p>
            <p className="mt-1 text-xs text-muted-foreground">
              La caméra placée face à la dalle complète le retour TVBOX / Display avec une vérification visuelle réelle.
            </p>
          </div>
        </div>
        <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${proofLive ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : "border-amber-500/30 bg-amber-500/10 text-amber-700"}`}>
          <span className={`h-2 w-2 rounded-full ${proofLive ? "bg-emerald-500" : "bg-amber-500"}`} />
          {stateLabel}
        </span>
      </div>

      {camera ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]">
          <div className="relative aspect-video overflow-hidden rounded-2xl border bg-black">
            {snapshotUrl ? (
              <img src={snapshotUrl} alt={`Contrôle visuel de l’écran via ${camera.name}`} className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full items-center justify-center text-white/45"><Camera className="h-10 w-10" /></div>
            )}
            <div className="absolute bottom-2 left-2 rounded-lg bg-black/70 px-2.5 py-1.5 text-[11px] text-white">
              {snapshotError || (proofLive ? "Snapshot sécurisé actualisé automatiquement" : "Connexion caméra en cours")}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border bg-background/70 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Caméra utilisée</p>
              <p className="mt-1 text-sm font-semibold">{camera.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{camera.model || "Modèle non renseigné"}</p>
            </div>
            <div className="rounded-xl border bg-background/70 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Dernier retour</p>
              <p className="mt-1 text-sm font-semibold">{camera.snapshot_at ? new Date(camera.snapshot_at).toLocaleString("fr-BE") : "Aucun snapshot reçu"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Le flux RTSP et ses identifiants restent sur la passerelle locale.</p>
            </div>
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] p-3 text-xs text-muted-foreground">
              <p className="flex items-center gap-2 font-semibold text-foreground"><ShieldCheck className="h-4 w-4" /> Contrôle respectueux de la vie privée</p>
              <p className="mt-1">Aucune reconnaissance faciale n’est nécessaire. Pour l’analyse automatique, nous limiterons la zone analysée à la dalle LED.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          <div className="flex items-start gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><p>La caméra est installée physiquement, mais Signelya ne reçoit encore aucun flux de passerelle. Dès qu’elle est enregistrée dans Vidéosurveillance et associée à sa clé locale, ce panneau affichera automatiquement son snapshot.</p></div>
          {isAdmin && <a href="/videosurveillance" className="mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold"><Eye className="h-4 w-4" /> Ouvrir Vidéosurveillance</a>}
        </div>
      )}
    </section>
  );
}
