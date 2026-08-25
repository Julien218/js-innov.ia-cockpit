import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Download, ListVideo, CalendarClock, Wifi, HardDrive, Eye, ArrowUp, ArrowDown, CheckCircle2, CircleAlert, Play, Clock3 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

const api = async (path, options = {}, clientEmail = "") => {
  const response = await fetch(`/api/signage${path}`, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(clientEmail ? { "X-Client-Email": clientEmail } : {}), ...(options.headers || {}) } });
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

const uploadMedia = (file, onProgress, clientEmail = "") => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", `/api/signage/manage/media/upload?name=${encodeURIComponent(file.name)}`);
  xhr.withCredentials = true;
  xhr.timeout = 300000;
  xhr.setRequestHeader("Content-Type", "application/octet-stream");
  xhr.setRequestHeader("X-Media-Content-Type", file.type || "application/octet-stream");
  if (clientEmail) xhr.setRequestHeader("X-Client-Email", clientEmail);
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

const STATUS_TONES = {
  gold: "border-[#D4AF37]/25 bg-[#D4AF37]/5 text-[#A77E10]",
  cyan: "border-cyan-500/20 bg-cyan-500/5 text-cyan-700",
  blue: "border-blue-500/20 bg-blue-500/5 text-blue-700",
  navy: "border-slate-900/15 bg-slate-900/[0.03] text-slate-800",
};

const StatusCard = ({ icon: Icon, label, value, detail, tone = "blue" }) => <div className={`rounded-2xl border bg-card p-4 shadow-sm ${STATUS_TONES[tone]}`}><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-current/10"><Icon className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-sm font-semibold text-foreground">{value}</p>{detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}</div></div></div>;

const MEDIA_STATUS_LABELS = {
  ready: "Prêt à diffuser",
  uploaded: "Préparation en cours",
  processing: "Conversion en cours",
  failed: "À vérifier",
};

const PUBLICATION_STATUS_LABELS = {
  pending: "Programmée",
  active: "En cours",
  completed: "Terminée",
  failed: "Échec",
  rolled_back: "Annulée",
};

const RECURRENCE_LABELS = {
  none: "Une seule fois",
  daily: "Chaque jour",
  weekly: "Chaque semaine",
};

const managedClientKey = "jsinnovia-managed-client";
const preferredManagedClient = clients => {
  const stored = window.localStorage.getItem(managedClientKey);
  if (stored && !stored.endsWith(".invalid") && clients.some(client => client.email === stored)) return stored;
  return clients.find(client => !String(client.email).endsWith(".invalid"))?.email || clients[0]?.email || "";
};

export default function DigitalSignage() {
  const { user } = useAuth();
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);
  const queryClient = useQueryClient();
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [enrollmentToken, setEnrollmentToken] = React.useState("");
  const [transfer, setTransfer] = React.useState(null);
  const [managedClient, setManagedClient] = React.useState("");
  const [selectedMediaIds, setSelectedMediaIds] = React.useState([]);
  const [scheduledAt, setScheduledAt] = React.useState("");
  const [recurrence, setRecurrence] = React.useState("none");
  const [preview, setPreview] = React.useState(null);
  const [previewError, setPreviewError] = React.useState("");
  const fileInput = React.useRef(null);
  const clientsQuery = useQuery({ queryKey: ["signage-managed-clients"], queryFn: () => api("/manage/clients"), enabled: isAdmin, staleTime: 60000 });
  const diagnosticsQuery = useQuery({ queryKey: ["signage-player-diagnostics"], queryFn: () => api("/manage/player-diagnostics"), enabled: isAdmin, refetchInterval: 30000 });
  const managedClients = clientsQuery.data?.clients || [];
  React.useEffect(() => {
    if (isAdmin && !managedClient && managedClients.length) setManagedClient(preferredManagedClient(managedClients));
  }, [isAdmin, managedClient, managedClients]);
  const dashboardEnabled = !isAdmin || Boolean(managedClient);
  const { data = {}, isLoading, error } = useQuery({ queryKey: ["signage-dashboard", managedClient || "self"], queryFn: () => api("/manage/dashboard", {}, managedClient), enabled: dashboardEnabled, refetchInterval: 30000 });
  const players = data.players || [], media = data.media || [], playlists = data.playlists || [], publications = data.publications || [], auditEvents = data.auditEvents || [];
  React.useEffect(() => { if (media.length && !selectedMediaIds.length) setSelectedMediaIds([media[0].id]); }, [media, selectedMediaIds.length]);
  const player = [...players].sort((a, b) => new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime())[0];
  const diagnosticPlayers = diagnosticsQuery.data?.players || [];
  const connectedElsewhere = diagnosticPlayers.find(item => item.owner_email !== managedClient && item.status === "online" && item.last_seen_at && Date.now() - new Date(item.last_seen_at).getTime() < 120000);
  const latestPublication = publications[0];
  const playerOnline = player?.status === "online";
  const readyMediaCount = media.filter(item => item.status === "ready").length;
  const selectedMedia = selectedMediaIds.map(id => media.find(item => item.id === id)).filter(Boolean);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["signage-dashboard", managedClient || "self"] });
  const run = async (task, success) => { setBusy(true); setMessage(""); try { await task(); setMessage(success); await refresh(); } catch (e) { setMessage(e.message); } finally { setBusy(false); } };

  const createPlayer = () => run(async () => {
    const result = await api("/manage/players", { method: "POST", body: JSON.stringify({ name: "Player Pixelium Olivier", resolution: "1920x1080" }) }, managedClient);
    setEnrollmentToken(result.enrollmentToken);
  }, "Player créé. Le jeton d’installation est conservé dans cette session uniquement.");

  const rotatePlayerToken = () => run(async () => {
    if (!player) throw new Error("Créez d’abord le Player");
    const result = await api(`/manage/players/${player.id}/rotate-token`, { method: "POST", body: "{}" }, managedClient);
    setEnrollmentToken(result.enrollmentToken);
  }, "Nouveau jeton généré. L’ancien jeton est maintenant désactivé.");

  const reassignConnectedPlayer = () => run(async () => {
    if (!connectedElsewhere || !player) throw new Error("Player à rattacher introuvable");
    await api("/manage/players/reassign-connected", { method: "POST", body: JSON.stringify({ sourcePlayerId: connectedElsewhere.id, targetPlayerId: player.id }) }, managedClient);
    await diagnosticsQuery.refetch();
  }, "Player connecté rattaché au client. La MXQ conserve son jeton et récupérera les diffusions au prochain heartbeat.");

  const upload = file => run(async () => {
    setTransfer({ name: file.name, size: file.size, percent: 0, state: "uploading", label: "Préparation du fichier…" });
    try {
      await uploadMedia(file, progress => setTransfer(current => ({ ...current, ...progress })), managedClient);
    } catch (error) {
      setTransfer(current => ({ ...current, state: "error", label: error.message }));
      throw error;
    }
  }, "Média converti, envoyé et prêt pour la diffusion.");

  const createPlaylist = () => run(async () => {
    if (!selectedMediaIds.length) throw new Error("Sélectionnez au moins un média");
    await api("/manage/playlists", { method: "POST", body: JSON.stringify({ name: `Playlist ${new Date().toLocaleDateString("fr-BE")}`, items: selectedMediaIds.map(mediaId => ({ mediaId, durationSeconds: 15 })) }) }, managedClient);
  }, "Playlist créée dans l’ordre affiché.");

  const publish = () => run(async () => {
    if (!player) throw new Error("Créez d’abord le Player");
    if (!playlists[0]) throw new Error("Créez d’abord une playlist");
    await api("/manage/publications", { method: "POST", body: JSON.stringify({ playerId: player.id, playlistId: playlists[0].id, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : new Date().toISOString(), recurrence: { type: recurrence } }) }, managedClient);
  }, scheduledAt ? "Diffusion programmée à la date choisie." : "Diffusion immédiate programmée. Elle sera récupérée au prochain heartbeat du Player.");

  const rollback = publication => run(() => api(`/manage/publications/${publication.id}/rollback`, { method: "POST", body: "{}" }, managedClient), "Retour à la dernière diffusion valide effectué.");
  const toggleMedia = id => setSelectedMediaIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const moveMedia = (id, offset) => setSelectedMediaIds(current => { const index = current.indexOf(id); const target = index + offset; if (index < 0 || target < 0 || target >= current.length) return current; const copy = [...current]; [copy[index], copy[target]] = [copy[target], copy[index]]; return copy; });
  const previewMedia = mediaItem => run(async () => {
    setPreviewError("");
    const result = await api(`/manage/media/${mediaItem.id}/download`, {}, managedClient);
    setPreview({ ...mediaItem, url: result.url });
  }, "Prévisualisation chargée.");

  return <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
    <section className="relative overflow-hidden rounded-3xl border border-[#D4AF37]/30 bg-[linear-gradient(135deg,#070B1C_0%,#101B3D_55%,#0B2940_100%)] p-5 text-white shadow-xl shadow-[#101B3D]/15 md:p-7">
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-cyan-400/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-[#D4AF37]/15 blur-3xl" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-[#D4AF37]/40 bg-black/25 p-1 shadow-lg shadow-black/20"><img src="/logo.png" alt="JS-Innov.IA" className="h-full w-full rounded-xl object-cover" /></div>
          <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E7C75F]">JS-Innov.IA · Signage</p><h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">Mon écran géant</h1><p className="mt-1 text-sm text-slate-300">Ajoutez vos médias, choisissez leur ordre puis lancez la diffusion.</p></div>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-medium text-slate-100 backdrop-blur-sm"><span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]" /> Service écran géant</div>
      </div>
    </section>
    {isAdmin && <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1"><p className="text-sm font-semibold">Client géré</p><p className="text-xs text-muted-foreground">Vous pilotez uniquement les écrans du client sélectionné.</p></div>
      <select value={managedClient} onChange={event => { const email = event.target.value; setManagedClient(email); window.localStorage.setItem(managedClientKey, email); setEnrollmentToken(""); setTransfer(null); setMessage(""); setSelectedMediaIds([]); setPreview(null); setPreviewError(""); }} className="rounded-xl border border-border bg-background px-3 py-2 text-sm min-w-[260px]">
        {!managedClients.length && <option value="">Aucun client Signage actif</option>}
        {managedClients.map(client => <option key={client.email} value={client.email}>{client.name} — {client.email}</option>)}
      </select>
    </div>}
    {isAdmin && connectedElsewhere && player && <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3"><div className="flex-1"><p className="text-sm font-semibold">Player connecté dans un autre dossier</p><p className="text-xs text-muted-foreground">La MXQ active peut être rattachée à {managedClient} sans réinstaller l’application.</p></div><button disabled={busy} onClick={reassignConnectedPlayer} className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Rattacher ce Player</button></div>}
    {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700">{error.message}</div>}
    {message && <div className="rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm">{message}</div>}
    {transfer && <div className={`rounded-2xl border p-4 space-y-3 ${transfer.state === "error" ? "border-red-500/30 bg-red-500/5" : transfer.state === "done" ? "border-emerald-500/30 bg-emerald-500/5" : "border-primary/20 bg-primary/5"}`}>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold truncate">{transfer.name}</p><p className="text-xs text-muted-foreground">{formatBytes(transfer.size)}</p></div><span className="text-sm font-semibold tabular-nums">{transfer.percent}%</span></div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={transfer.percent} aria-label={`Progression de ${transfer.name}`}><div className={`h-full rounded-full transition-all duration-300 ${transfer.state === "error" ? "bg-red-500" : transfer.state === "done" ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${transfer.percent}%` }} /></div>
      <p className={`text-xs ${transfer.state === "error" ? "text-red-700" : transfer.state === "done" ? "text-emerald-700" : "text-muted-foreground"}`}>{transfer.label}</p>
    </div>}
    {enrollmentToken && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2"><p className="font-semibold">Jeton d’association — affiché une seule fois</p><p className="text-xs text-muted-foreground">Saisissez exactement ce jeton sur la MXQ, puis effacez-le de toute note temporaire.</p><div className="flex gap-2"><input readOnly value={enrollmentToken} className="flex-1 rounded-lg border bg-background px-3 py-2 font-mono text-sm"/><button onClick={() => navigator.clipboard.writeText(enrollmentToken)} className="rounded-lg border px-4 py-2 text-sm">Copier</button></div></div>}
    <section className={`rounded-3xl border p-5 shadow-sm md:p-6 ${playerOnline ? "border-cyan-500/25 bg-[linear-gradient(135deg,rgba(6,182,212,0.08),rgba(37,99,235,0.04))]" : "border-[#D4AF37]/35 bg-[#D4AF37]/5"}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-lg ${playerOnline ? "bg-cyan-500 text-white shadow-cyan-500/20" : "bg-[#D4AF37] text-[#07111F] shadow-[#D4AF37]/20"}`}>
            {playerOnline ? <CheckCircle2 className="h-6 w-6" /> : <CircleAlert className="h-6 w-6" />}
          </div>
          <div>
            <p className="text-lg font-bold">{playerOnline ? "Votre écran est bien connecté" : "Connexion de l’écran à vérifier"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {playerOnline ? "Vous pouvez préparer ou programmer une nouvelle diffusion." : "Vos médias restent enregistrés. Contactez JS-Innov.IA si l’écran ne revient pas en ligne."}
            </p>
            {player?.last_seen_at && <p className="mt-2 text-xs text-muted-foreground">Dernier contact : {new Date(player.last_seen_at).toLocaleString("fr-BE")}</p>}
          </div>
        </div>
        <button disabled={busy || isLoading} onClick={() => fileInput.current?.click()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-5 py-3 text-sm font-bold text-[#07111F] shadow-lg shadow-[#D4AF37]/20 transition-colors hover:bg-[#E5C55B] disabled:opacity-50">
          <Upload className="h-4 w-4" /> Ajouter une vidéo ou une image
        </button>
      </div>
    </section>

    <input ref={fileInput} type="file" accept="video/*,image/*" className="hidden" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) upload(file); }} />

    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <StatusCard tone="cyan" icon={Wifi} label="Écran" value={playerOnline ? "En ligne" : player ? "Hors ligne" : "Non associé"} detail="État actualisé automatiquement" />
      <StatusCard tone="gold" icon={HardDrive} label="Médias disponibles" value={`${readyMediaCount} prêt${readyMediaCount > 1 ? "s" : ""}`} detail={`${media.length} fichier${media.length > 1 ? "s" : ""} au total`} />
      <StatusCard tone="blue" icon={ListVideo} label="Programmes enregistrés" value={`${playlists.length}`} detail={playlists.length ? "Prêts à être diffusés" : "Créez votre premier programme"} />
      <StatusCard tone="navy" icon={Clock3} label="Dernière diffusion" value={PUBLICATION_STATUS_LABELS[latestPublication?.status] || "Aucune"} detail={latestPublication?.scheduled_at ? new Date(latestPublication.scheduled_at).toLocaleString("fr-BE") : ""} />
    </div>
    {latestPublication?.status === "failed" && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700"><p className="font-semibold">La dernière diffusion a échoué sur le Player.</p><p className="mt-1">{latestPublication.error || "Le Player n’a pas pu lire le média."}</p></div>}

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <section className="rounded-2xl border border-[#D4AF37]/20 bg-card p-4 shadow-sm md:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0B1633] text-sm font-bold text-[#E7C75F] ring-2 ring-[#D4AF37]/25">1</span>
          <div><h2 className="text-base font-semibold">Ajoutez vos médias</h2><p className="mt-1 text-sm text-muted-foreground">Cochez les vidéos et images à diffuser. L’ordre choisi sera conservé.</p></div>
        </div>
        <div className="mt-4 space-y-2">{media.map(item => { const selected = selectedMediaIds.includes(item.id); const position = selectedMediaIds.indexOf(item.id); return <div key={item.id} className={`rounded-xl border p-3 flex items-center gap-2 ${selected ? "border-[#D4AF37]/55 bg-[#D4AF37]/5 shadow-sm" : ""}`}><input type="checkbox" checked={selected} onChange={() => toggleMedia(item.id)} aria-label={`Sélectionner ${item.name}`}/><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{item.name}</p><p className="text-xs text-muted-foreground">{formatBytes(Number(item.size_bytes || 0))} · {MEDIA_STATUS_LABELS[item.status] || "État inconnu"}</p></div><button onClick={() => previewMedia(item)} className="rounded-lg border p-2 hover:border-cyan-500/40 hover:text-cyan-700" aria-label={`Prévisualiser ${item.name}`}><Eye className="w-4 h-4"/></button>{selected && <><button disabled={position <= 0} onClick={() => moveMedia(item.id, -1)} className="rounded-lg border p-2 disabled:opacity-30" aria-label="Monter"><ArrowUp className="w-4 h-4"/></button><button disabled={position === selectedMediaIds.length - 1} onClick={() => moveMedia(item.id, 1)} className="rounded-lg border p-2 disabled:opacity-30" aria-label="Descendre"><ArrowDown className="w-4 h-4"/></button><span className="w-6 text-center text-xs font-semibold text-[#9A7414]">{position + 1}</span></>}</div>})}{!media.length && <div className="rounded-xl border border-dashed p-8 text-center"><p className="text-sm font-medium">Aucun média pour le moment</p><button onClick={() => fileInput.current?.click()} className="mt-3 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-[#07111F]">Ajouter le premier média</button></div>}</div>
      </section>

      <section className="rounded-2xl border bg-card p-4 md:p-5">
        <h2 className="text-base font-semibold">Aperçu</h2>
        <p className="mt-1 text-sm text-muted-foreground">Utilisez l’icône œil d’un média pour le vérifier.</p>
        <div className="relative mt-4 aspect-video rounded-xl bg-black flex items-center justify-center overflow-hidden">
          {preview ? (String(preview.mime_type).startsWith("image/")
            ? <img src={preview.url} alt={preview.name} onLoad={() => setPreviewError("")} onError={() => setPreviewError("L’image ne peut pas être lue depuis Dropbox.")} className="h-full w-full object-contain"/>
            : <video key={preview.url} src={preview.url} controls autoPlay muted playsInline onCanPlay={() => setPreviewError("")} onError={() => setPreviewError("La vidéo ne peut pas être lue dans ce navigateur.")} className="h-full w-full object-contain"/>)
            : <p className="px-4 text-center text-sm text-white/60">Sélectionnez l’icône œil d’un média</p>}
          {previewError && <p className="absolute rounded-lg bg-black/80 px-3 py-2 text-xs text-red-300">{previewError}</p>}
        </div>
        {preview && <p className="mt-2 text-xs text-muted-foreground truncate">{preview.name}</p>}
      </section>
    </div>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border bg-card p-4 md:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0B1633] text-sm font-bold text-[#E7C75F] ring-2 ring-[#D4AF37]/25">2</span>
          <div><h2 className="text-base font-semibold">Préparez votre programme</h2><p className="mt-1 text-sm text-muted-foreground">{selectedMedia.length ? `${selectedMedia.length} média${selectedMedia.length > 1 ? "s" : ""} sélectionné${selectedMedia.length > 1 ? "s" : ""}.` : "Choisissez au moins un média à l’étape 1."}</p></div>
        </div>
        <div className="mt-4 rounded-xl bg-muted/40 p-3 text-sm">
          {selectedMedia.length ? selectedMedia.map((item, index) => <p key={item.id} className="truncate py-1"><span className="mr-2 font-bold text-primary">{index + 1}.</span>{item.name}</p>) : <p className="text-muted-foreground">Votre programme apparaîtra ici.</p>}
        </div>
        <button disabled={busy || !selectedMedia.length} onClick={createPlaylist} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#D4AF37]/60 px-4 py-3 text-sm font-semibold text-[#8A6812] transition-colors hover:bg-[#D4AF37]/10 disabled:opacity-40"><ListVideo className="h-4 w-4" /> Enregistrer ce programme</button>
      </section>

      <section className="rounded-2xl border bg-card p-4 md:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0B1633] text-sm font-bold text-[#E7C75F] ring-2 ring-[#D4AF37]/25">3</span>
          <div><h2 className="text-base font-semibold">Lancez la diffusion</h2><p className="mt-1 text-sm text-muted-foreground">Diffusez maintenant ou choisissez une date.</p></div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">Date et heure <span className="font-normal text-muted-foreground">(facultatif)</span><input type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} className="mt-1.5 w-full rounded-xl border bg-background px-3 py-2.5 text-sm text-foreground"/></label>
          <label className="block text-sm font-medium">Répétition<select value={recurrence} onChange={event => setRecurrence(event.target.value)} className="mt-1.5 w-full rounded-xl border bg-background px-3 py-2.5 text-sm text-foreground"><option value="none">Une seule fois</option><option value="daily">Chaque jour</option><option value="weekly">Chaque semaine</option></select></label>
        </div>
        <button disabled={busy || !player || !playlists.length} onClick={publish} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#2563EB,#0891B2)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition-opacity hover:opacity-90 disabled:opacity-40">{scheduledAt ? <CalendarClock className="h-4 w-4" /> : <Play className="h-4 w-4" />}{scheduledAt ? "Programmer la diffusion" : "Diffuser maintenant"}</button>
        {!playlists.length && <p className="mt-2 text-center text-xs text-muted-foreground">Enregistrez d’abord votre programme à l’étape 2.</p>}
      </section>
    </div>

    <details className="group rounded-2xl border bg-card">
      <summary className="cursor-pointer list-none p-4 text-sm font-semibold md:p-5">Voir l’historique des diffusions ({publications.length})</summary>
      <div className="divide-y border-t px-4 md:px-5">{publications.map(publication => <div key={publication.id} className="py-3 flex items-center gap-3"><div className="flex-1"><p className="text-sm font-medium">{PUBLICATION_STATUS_LABELS[publication.status] || "État inconnu"}</p><p className="text-xs text-muted-foreground">{new Date(publication.scheduled_at || publication.created_at).toLocaleString("fr-BE")}{publication.recurrence?.type && publication.recurrence.type !== "none" ? ` · ${RECURRENCE_LABELS[publication.recurrence.type] || "Répétée"}` : ""}</p>{publication.error && <p className="text-xs text-red-700">{publication.error}</p>}</div>{publication.previous_publication_id && <button disabled={busy} onClick={() => rollback(publication)} className="rounded-lg border px-3 py-2 text-xs">Revenir à cette diffusion</button>}</div>)}{!publications.length && <p className="py-4 text-xs text-muted-foreground">Aucune diffusion.</p>}</div>
    </details>

    {isAdmin && <details className="rounded-2xl border bg-card">
      <summary className="cursor-pointer list-none p-4 text-sm font-semibold md:p-5">Outils techniques et diagnostic</summary>
      <div className="space-y-4 border-t p-4 md:p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{diagnosticPlayers.map(item => <div key={item.id} className="rounded-xl bg-muted/30 p-3 text-xs"><p className="font-medium">{item.name} · {item.owner_email}</p><p className="text-muted-foreground">{item.status} · {item.last_seen_at ? new Date(item.last_seen_at).toLocaleString("fr-BE") : "jamais connecté"} · {item.app_version || "version inconnue"}</p></div>)}</div>
        {!player && <button disabled={busy} onClick={createPlayer} className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm">Créer le Player Olivier</button>}
        {player && <div className="space-y-2"><button disabled={busy} onClick={rotatePlayerToken} className="rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-50">Générer un nouveau jeton d’association</button><p className="text-xs text-muted-foreground">À utiliser uniquement après la réinstallation du Player.</p></div>}
        <a href="/api/player-download/android" download className="inline-flex rounded-xl border border-border px-4 py-3 text-sm font-medium items-center justify-center gap-2"><Download className="w-4 h-4" /> Télécharger le Player Android</a>
        <div className="rounded-xl border bg-muted/20 p-4"><p className="text-sm font-semibold">Journal technique</p><div className="mt-2 divide-y">{auditEvents.slice(0, 12).map(event => <div key={event.id} className="py-2"><p className="text-sm">{event.action}</p><p className="text-xs text-muted-foreground">{event.actor_email || "Player"} · {new Date(event.created_at).toLocaleString("fr-BE")}</p></div>)}{!auditEvents.length && <p className="text-xs text-muted-foreground">Aucune activité technique.</p>}</div></div>
      </div>
    </details>}
  </div>;
}



