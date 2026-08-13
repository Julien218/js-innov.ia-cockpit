import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import { MonitorPlay, Upload, ListVideo, CalendarClock, Wifi, HardDrive, RotateCcw } from "lucide-react";

const api = async (path, options = {}) => {
  const response = await fetch(`/api/signage${path}`, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Opération impossible");
  return body;
};

const StatusCard = ({ icon: Icon, label, value, detail }) => <div className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Icon className="w-5 h-5" /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-sm font-semibold">{value}</p>{detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}</div></div></div>;

export default function DigitalSignage() {
  const queryClient = useQueryClient();
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const fileInput = React.useRef(null);
  const { data = {}, isLoading, error } = useQuery({ queryKey: ["signage-dashboard"], queryFn: () => api("/manage/dashboard"), refetchInterval: 30000 });
  const players = data.players || [], media = data.media || [], playlists = data.playlists || [], publications = data.publications || [];
  const player = players[0];
  const activePublication = publications.find(p => p.status === "active") || publications[0];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["signage-dashboard"] });
  const run = async (task, success) => { setBusy(true); setMessage(""); try { await task(); setMessage(success); await refresh(); } catch (e) { setMessage(e.message); } finally { setBusy(false); } };

  const createPlayer = () => run(async () => {
    const result = await api("/manage/players", { method: "POST", body: JSON.stringify({ name: "Player Pixelium Olivier", resolution: "1920x1080" }) });
    sessionStorage.setItem("pixeliumEnrollmentToken", result.enrollmentToken);
  }, "Player créé. Le jeton d’installation est conservé dans cette session uniquement.");

  const upload = file => run(async () => {
    const session = await api("/manage/media/upload-session", { method: "POST", body: JSON.stringify({ name: file.name, sizeBytes: file.size }) });
    const put = await fetch(session.uploadUrl, { method: "POST", headers: { "Content-Type": "application/octet-stream", "Dropbox-API-Arg": JSON.stringify({ path: session.dropboxPath, mode: "add", autorename: true, mute: false, strict_conflict: false }) }, body: file });
    if (!put.ok) throw new Error("Envoi Dropbox refusé");
    await api("/manage/media", { method: "POST", body: JSON.stringify({ name: file.name, mimeType: file.type, dropboxPath: session.dropboxPath, sizeBytes: file.size }) });
  }, "Média envoyé et indexé.");

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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <StatusCard icon={Wifi} label="Player" value={player ? (player.status === "online" ? "Connecté" : "Hors ligne") : "À créer"} detail={player?.last_seen_at ? `Dernier signal : ${new Date(player.last_seen_at).toLocaleString("fr-BE")}` : "Heartbeat sécurisé requis"} />
      <StatusCard icon={MonitorPlay} label="Contrôleur LED" value="Colorlight X2M" detail="Sortie Player en HDMI" />
      <StatusCard icon={HardDrive} label="Médiathèque" value={`${media.length} média(s)`} detail="Dropbox Pixelium" />
      <StatusCard icon={RotateCcw} label="Publications" value={`${publications.length}`} detail={activePublication?.status || "Aucune"} />
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">État réel</h2>
        <div className="mt-4 grid grid-cols-3 gap-3 text-center"><div className="rounded-xl bg-muted/30 p-4"><b>{media.length}</b><p className="text-xs text-muted-foreground">Médias</p></div><div className="rounded-xl bg-muted/30 p-4"><b>{playlists.length}</b><p className="text-xs text-muted-foreground">Playlists</p></div><div className="rounded-xl bg-muted/30 p-4"><b>{publications.length}</b><p className="text-xs text-muted-foreground">Diffusions</p></div></div>
        {!player && <button disabled={busy} onClick={createPlayer} className="mt-4 rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm">Créer le Player Olivier</button>}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3"><h2 className="text-sm font-semibold">Actions</h2>
        <input ref={fileInput} type="file" accept="video/*,image/*" className="hidden" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
        <button disabled={busy || isLoading} onClick={() => fileInput.current?.click()} className="w-full rounded-xl bg-primary text-primary-foreground px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"><Upload className="w-4 h-4" /> Ajouter un média</button>
        <button disabled={busy || !media.length} onClick={createPlaylist} className="w-full rounded-xl border border-border px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"><ListVideo className="w-4 h-4" /> Créer une playlist</button>
        <button disabled={busy || !player || !playlists.length} onClick={publish} className="w-full rounded-xl border border-border px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"><CalendarClock className="w-4 h-4" /> Programmer la diffusion</button>
      </div>
    </div>
  </div>;
}

