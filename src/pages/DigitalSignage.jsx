import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import { MonitorPlay, Upload, ListVideo, CalendarClock, Wifi, HardDrive, RotateCcw } from "lucide-react";

const api = async (path, options = {}) => {
  const response = await fetch(`/api/signage${path}`, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  let body = {};
  if (text && contentType.includes("application/json")) {
    try { body = JSON.parse(text); } catch { throw new Error("Réponse du cockpit illisible. Réessayez dans quelques secondes."); }
  } else if (text) {
    throw new Error(response.status === 401 ? "Votre session a expiré. Reconnectez-vous." : "Le service du cockpit est momentanément indisponible.");
  }
  if (!response.ok) throw new Error(body.error || "Opération impossible");
  return body;
};

const formatBytes = bytes => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 octet";
  const units = ["octets", "Ko", "Mo", "Go"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
};

const uploadMedia = (file, onProgress) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", `/api/signage/manage/media/upload?name=${encodeURIComponent(file.name)}`);
  xhr.withCredentials = true;
  xhr.timeout = 300000;
  xhr.setRequestHeader("Content-Type", "application/octet-stream");
  xhr.setRequestHeader("X-Media-Content-Type", file.type || "application/octet-stream");
  xhr.upload.onprogress = event => {
    if (!event.lengthComputable) return;
    const percent = Math.min(80, Math.round((event.loaded / event.total) * 80));
    onProgress({ percent, state: "uploading", label: "Envoi sécurisé vers le cockpit…" });
  };
  xhr.upload.onload = () => onProgress({ percent: 85, state: "processing", label: "Conversion vidéo compatible MXQ, transfert Dropbox et indexation…" });
  xhr.onload = () => {
    const contentType = xhr.getResponseHeader("content-type") || "";
    let body = {};
    if (xhr.responseText && contentType.includes("application/json")) {
      try { body = JSON.parse(xhr.responseText); } catch { return reject(new Error("Réponse du cockpit illisible.")); }
    }
    if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(body.error || `Envoi impossible (HTTP ${xhr.status}).`));
    onProgress({ percent: 100, state: "done", label: "Conversion terminée. Le média est prêt pour le Player." });
    resolve(body);
  };
  xhr.onerror = () => reject(new Error("Connexion interrompue pendant l’envoi."));
  xhr.ontimeout = () => reject(new Error("L’envoi a pris trop de temps. Réessayez avec une connexion stable."));
  xhr.send(file);
});

const StatusCard = ({ icon: Icon, label, value, detail }) => <div className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Icon className="w-5 h-5" /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-sm font-semibold">{value}</p>{detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}</div></div></div>;

export default function DigitalSignage() {
  const queryClient = useQueryClient();
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [enrollmentToken, setEnrollmentToken] = React.useState("");
  const [transfer, setTransfer] = React.useState(null);
  const fileInput = React.useRef(null);
  const { data = {}, isLoading, error } = useQuery({ queryKey: ["signage-dashboard"], queryFn: () => api("/manage/dashboard"), refetchInterval: 30000 });
  const players = data.players || [], media = data.media || [], playlists = data.playlists || [], publications = data.publications || [];
  const player = players[0];
  const latestPublication = publications[0];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["signage-dashboard"] });
  const run = async (task, success) => { setBusy(true); setMessage(""); try { await task(); setMessage(success); await refresh(); } catch (e) { setMessage(e.message); } finally { setBusy(false); } };

  const createPlayer = () => run(async () => {
    const result = await api("/manage/players", { method: "POST", body: JSON.stringify({ name: "Player Pixelium Olivier", resolution: "1920x1080" }) });
    setEnrollmentToken(result.enrollmentToken);
  }, "Player créé. Le jeton d’installation est conservé dans cette session uniquement.");

  const rotatePlayerToken = () => run(async () => {
    if (!player) throw new Error("Créez d’abord le Player");
    const result = await api(`/manage/players/${player.id}/rotate-token`, { method: "POST", body: "{}" });
    setEnrollmentToken(result.enrollmentToken);
  }, "Nouveau jeton généré. L’ancien jeton est maintenant désactivé.");

  const upload = file => run(async () => {
    setTransfer({ name: file.name, size: file.size, percent: 0, state: "uploading", label: "Préparation du fichier…" });
    try {
      await uploadMedia(file, progress => setTransfer(current => ({ ...current, ...progress })));
    } catch (error) {
      setTransfer(current => ({ ...current, state: "error", label: error.message }));
      throw error;
    }
  }, "Média converti, envoyé et prêt pour la diffusion.");

  const createPlaylist = () => run(async () => {
    if (!media[0]) throw new Error("Ajoutez d’abord un média");
    await api("/manage/playlists", { method: "POST", body: JSON.stringify({ name: `Playlist ${new Date().toLocaleDateString("fr-BE")}`, items: [{ mediaId: media[0].id, durationSeconds: 15 }] }) });
  }, "Playlist créée avec le média le plus récent.");

  const publish = () => run(async () => {
    if (!player) throw new Error("Créez d’abord le Player");
    if (!playlists[0]) throw new Error("Créez d’abord une playlist");
    await api("/manage/publications", { method: "POST", body: JSON.stringify({ playerId: player.id, playlistId: playlists[0].id }) });
  }, "Diffusion programmée. Elle sera récupérée au prochain heartbeat du Player.");

  return <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
    <PageHeader title="Écran géant" subtitle="Pilotage du Player HDMI relié au contrôleur Colorlight X2M." />
    {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700">{error.message}</div>}
    {message && <div className="rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm">{message}</div>}
    {transfer && <div className={`rounded-2xl border p-4 space-y-3 ${transfer.state === "error" ? "border-red-500/30 bg-red-500/5" : transfer.state === "done" ? "border-emerald-500/30 bg-emerald-500/5" : "border-primary/20 bg-primary/5"}`}>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold truncate">{transfer.name}</p><p className="text-xs text-muted-foreground">{formatBytes(transfer.size)}</p></div><span className="text-sm font-semibold tabular-nums">{transfer.percent}%</span></div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={transfer.percent} aria-label={`Progression de ${transfer.name}`}><div className={`h-full rounded-full transition-all duration-300 ${transfer.state === "error" ? "bg-red-500" : transfer.state === "done" ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${transfer.percent}%` }} /></div>
      <p className={`text-xs ${transfer.state === "error" ? "text-red-700" : transfer.state === "done" ? "text-emerald-700" : "text-muted-foreground"}`}>{transfer.label}</p>
    </div>}
    {enrollmentToken && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2"><p className="font-semibold">Jeton d’association — affiché une seule fois</p><p className="text-xs text-muted-foreground">Saisissez exactement ce jeton sur la MXQ, puis effacez-le de toute note temporaire.</p><div className="flex gap-2"><input readOnly value={enrollmentToken} className="flex-1 rounded-lg border bg-background px-3 py-2 font-mono text-sm"/><button onClick={() => navigator.clipboard.writeText(enrollmentToken)} className="rounded-lg border px-4 py-2 text-sm">Copier</button></div></div>}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <StatusCard icon={Wifi} label="Player" value={player ? (player.status === "online" ? "Connecté" : "Hors ligne") : "À créer"} detail={player?.last_seen_at ? `Dernier signal : ${new Date(player.last_seen_at).toLocaleString("fr-BE")}` : "Heartbeat sécurisé requis"} />
      <StatusCard icon={MonitorPlay} label="Contrôleur LED" value="Colorlight X2M" detail="Sortie Player en HDMI" />
      <StatusCard icon={HardDrive} label="Médiathèque" value={`${media.length} média(s)`} detail={media[0]?.status === "ready" ? "Dernier média prêt pour le Player" : "Conversion du dernier média requise"} />
      <StatusCard icon={RotateCcw} label="Publications" value={`${publications.length}`} detail={latestPublication?.status || "Aucune"} />
    </div>
    {latestPublication?.status === "failed" && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700"><p className="font-semibold">La dernière diffusion a échoué sur le Player.</p><p className="mt-1">{latestPublication.error || "Le Player n’a pas pu lire le média."}</p></div>}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">État réel</h2>
        <div className="mt-4 grid grid-cols-3 gap-3 text-center"><div className="rounded-xl bg-muted/30 p-4"><b>{media.length}</b><p className="text-xs text-muted-foreground">Médias</p></div><div className="rounded-xl bg-muted/30 p-4"><b>{playlists.length}</b><p className="text-xs text-muted-foreground">Playlists</p></div><div className="rounded-xl bg-muted/30 p-4"><b>{publications.length}</b><p className="text-xs text-muted-foreground">Diffusions</p></div></div>
        {!player && <button disabled={busy} onClick={createPlayer} className="mt-4 rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm">Créer le Player Olivier</button>}
        {player && player.status !== "online" && <button disabled={busy} onClick={rotatePlayerToken} className="mt-4 rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-50">Générer un nouveau jeton</button>}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3"><h2 className="text-sm font-semibold">Actions</h2>
        <input ref={fileInput} type="file" accept="video/*,image/*" className="hidden" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) upload(file); }} />
        <button disabled={busy || isLoading} onClick={() => fileInput.current?.click()} className="w-full rounded-xl bg-primary text-primary-foreground px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"><Upload className="w-4 h-4" /> Ajouter un média</button>
        <button disabled={busy || !media.length} onClick={createPlaylist} className="w-full rounded-xl border border-border px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"><ListVideo className="w-4 h-4" /> Créer une playlist</button>
        <button disabled={busy || !player || !playlists.length} onClick={publish} className="w-full rounded-xl border border-border px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"><CalendarClock className="w-4 h-4" /> Programmer la diffusion</button>
      </div>
    </div>
  </div>;
}

