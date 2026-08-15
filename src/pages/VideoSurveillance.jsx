import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import { Camera, Video, Wifi, HardDrive, ShieldCheck, Clock3, Maximize2, Download, Plus, KeyRound, X } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

const managedClientKey = "jsinnovia-managed-client";
const preferredManagedClient = clients => {
  const stored = window.localStorage.getItem(managedClientKey);
  if (stored && clients.some(client => client.email === stored)) return stored;
  return clients.find(client => !String(client.email).endsWith(".invalid"))?.email || clients[0]?.email || "";
};

const api = async (path, options = {}, clientEmail = "") => {
  const response = await fetch(`/api/signage${path}`, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(clientEmail ? { "X-Client-Email": clientEmail } : {}), ...(options.headers || {}) } });
  const type = response.headers.get("content-type") || "";
  const body = type.includes("application/json") ? await response.json().catch(() => ({})) : {};
  if (!response.ok) throw new Error(body.error || `Opération impossible (HTTP ${response.status})`);
  return body;
};

function CameraSnapshot({ camera, clientEmail, large = false }) {
  const [url, setUrl] = React.useState("");
  const [state, setState] = React.useState("Connexion…");
  React.useEffect(() => {
    let active = true;
    let currentUrl = "";
    const load = async () => {
      try {
        const response = await fetch(`/api/signage/manage/cameras/${camera.id}/snapshot`, { credentials: "same-origin", headers: clientEmail ? { "X-Client-Email": clientEmail } : {} });
        if (!response.ok) throw new Error("Image indisponible");
        const next = URL.createObjectURL(await response.blob());
        if (!active) return URL.revokeObjectURL(next);
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = next;
        setUrl(next);
        setState("Direct sécurisé");
      } catch { if (active) setState("En attente de la passerelle"); }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => { active = false; clearInterval(timer); if (currentUrl) URL.revokeObjectURL(currentUrl); };
  }, [camera.id, clientEmail]);
  return <div className={`relative bg-black flex items-center justify-center ${large ? "min-h-[60vh]" : "aspect-video"}`}>
    {url ? <img src={url} alt={`Vue de ${camera.name}`} className="h-full w-full object-contain" /> : <Camera className="w-10 h-10 text-white/40" />}
    <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-1 text-[11px] text-white">{state}</span>
  </div>;
}

export default function VideoSurveillance() {
  const { user } = useAuth();
  const isAdmin = ["admin", "superadmin"].includes(user?.role);
  const queryClient = useQueryClient();
  const [managedClient, setManagedClient] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [gatewayToken, setGatewayToken] = React.useState("");
  const [selectedCamera, setSelectedCamera] = React.useState(null);
  const [cameraForm, setCameraForm] = React.useState({ name: "Caméra Pixelium", model: "CTRONICS", localStreamKey: "camera-1", retentionDays: 14 });
  const clientsQuery = useQuery({ queryKey: ["camera-managed-clients"], queryFn: () => api("/manage/clients?module=videosurveillance"), enabled: isAdmin, staleTime: 60000 });
  const managedClients = clientsQuery.data?.clients || [];
  React.useEffect(() => { if (isAdmin && !managedClient && managedClients.length) setManagedClient(preferredManagedClient(managedClients)); }, [isAdmin, managedClient, managedClients]);
  const enabled = !isAdmin || Boolean(managedClient);
  const { data = { gateways: [], cameras: [], recordings: [] }, error, isLoading } = useQuery({ queryKey: ["camera-dashboard", managedClient || "self"], queryFn: () => api("/manage/camera-dashboard", {}, managedClient), enabled, refetchInterval: 15000 });
  const gateways = data.gateways || [], cameras = data.cameras || [], recordings = data.recordings || [];
  const gateway = gateways[0];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["camera-dashboard", managedClient || "self"] });
  const run = async (task, success) => { setBusy(true); setMessage(""); try { await task(); setMessage(success); await refresh(); } catch (e) { setMessage(e.message); } finally { setBusy(false); } };
  const createGateway = () => run(async () => { const result = await api("/manage/camera-gateways", { method: "POST", body: JSON.stringify({ name: "Passerelle caméras Pixelium" }) }, managedClient); setGatewayToken(result.enrollmentToken); }, "Passerelle créée. Conservez le jeton uniquement le temps de l’installation locale.");
  const rotateGatewayToken = () => {
    if (!gateway || !window.confirm("Générer un nouveau jeton ? L’ancien jeton cessera immédiatement de fonctionner.")) return;
    run(async () => { const result = await api(`/manage/camera-gateways/${gateway.id}/token`, { method: "POST" }, managedClient); setGatewayToken(result.enrollmentToken); }, "Nouveau jeton généré. Configurez-le localement avant de quitter cette page.");
  };
  const createCamera = () => run(async () => { if (!gateway) throw new Error("Créez d’abord la passerelle"); await api("/manage/cameras", { method: "POST", body: JSON.stringify({ ...cameraForm, gatewayId: gateway.id }) }, managedClient); }, "Caméra enregistrée. Utilisez la même clé locale dans la configuration de la passerelle.");
  const downloadRecording = recording => run(async () => { const result = await api(`/manage/recordings/${recording.id}/download`, {}, managedClient); window.open(result.url, "_blank", "noopener,noreferrer"); }, "Lien Dropbox temporaire ouvert.");

  return <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
    <PageHeader title="Vidéosurveillance" subtitle="Vue sécurisée des caméras autorisées. Les identifiants RTSP restent sur la passerelle locale." />
    {isAdmin && <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3"><div className="flex-1"><p className="text-sm font-semibold">Client géré</p><p className="text-xs text-muted-foreground">Les caméras du client sélectionné uniquement.</p></div><select value={managedClient} onChange={event => { const email = event.target.value; setManagedClient(email); window.localStorage.setItem(managedClientKey, email); setGatewayToken(""); setMessage(""); }} className="rounded-xl border bg-background px-3 py-2 text-sm min-w-[260px]">{!managedClients.length && <option value="">Aucun client Vidéosurveillance actif</option>}{managedClients.map(client => <option key={client.email} value={client.email}>{client.name} — {client.email}</option>)}</select></div>}
    {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-700">{error.message}</div>}
    {message && <div className="rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm">{message}</div>}
    {gatewayToken && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2"><p className="font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4"/>Jeton de passerelle — affiché une seule fois</p><div className="flex gap-2"><input readOnly value={gatewayToken} className="flex-1 rounded-lg border bg-background px-3 py-2 font-mono text-sm"/><button onClick={() => navigator.clipboard.writeText(gatewayToken)} className="rounded-lg border px-4 py-2 text-sm">Copier</button></div></div>}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="rounded-2xl border p-4"><Wifi className="w-5 h-5 text-primary mb-2"/><p className="text-xs text-muted-foreground">Passerelle locale</p><p className="text-sm font-semibold">{gateway ? (gateway.status === "online" ? "Connectée" : "Hors ligne") : "À connecter"}</p></div>
      <div className="rounded-2xl border p-4"><Video className="w-5 h-5 text-primary mb-2"/><p className="text-xs text-muted-foreground">Caméras</p><p className="text-sm font-semibold">{cameras.filter(camera => camera.status === "online").length}/{cameras.length} en ligne</p></div>
      <div className="rounded-2xl border p-4"><HardDrive className="w-5 h-5 text-primary mb-2"/><p className="text-xs text-muted-foreground">Enregistrements</p><p className="text-sm font-semibold">{recordings.length} dans Dropbox</p></div>
      <div className="rounded-2xl border p-4"><ShieldCheck className="w-5 h-5 text-primary mb-2"/><p className="text-xs text-muted-foreground">Sécurité</p><p className="text-sm font-semibold">RTSP privé + jeton</p></div>
    </div>
    {isAdmin && <div className="rounded-2xl border p-5 space-y-4"><h2 className="text-sm font-semibold">Installation de la passerelle</h2>{!gateway ? <button disabled={busy || !enabled} onClick={createGateway} className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm">Créer la passerelle du client</button> : <div className="space-y-4"><div className="flex flex-col sm:flex-row sm:items-center gap-3"><button disabled={busy} onClick={rotateGatewayToken} className="rounded-xl border px-4 py-2 text-sm flex items-center justify-center gap-2"><KeyRound className="w-4 h-4"/>Générer un nouveau jeton</button><p className="text-xs text-muted-foreground">À utiliser après une perte ou une réinstallation. L’ancien jeton sera invalidé.</p></div><div className="grid gap-3 md:grid-cols-5"><input value={cameraForm.name} onChange={e => setCameraForm(current => ({ ...current, name: e.target.value }))} className="rounded-xl border bg-background px-3 py-2 text-sm" placeholder="Nom"/><input value={cameraForm.model} onChange={e => setCameraForm(current => ({ ...current, model: e.target.value }))} className="rounded-xl border bg-background px-3 py-2 text-sm" placeholder="Modèle"/><input value={cameraForm.localStreamKey} onChange={e => setCameraForm(current => ({ ...current, localStreamKey: e.target.value }))} className="rounded-xl border bg-background px-3 py-2 text-sm" placeholder="Clé locale"/><input type="number" min="1" max="90" value={cameraForm.retentionDays} onChange={e => setCameraForm(current => ({ ...current, retentionDays: Number(e.target.value) }))} className="rounded-xl border bg-background px-3 py-2 text-sm" aria-label="Conservation en jours"/><button disabled={busy} onClick={createCamera} className="rounded-xl border px-4 py-2 text-sm flex items-center justify-center gap-2"><Plus className="w-4 h-4"/>Ajouter</button></div></div>}</div>}
    <div><h2 className="text-sm font-semibold mb-3">Caméras</h2><div className="grid grid-cols-1 md:grid-cols-2 gap-4">{cameras.map(camera => <div key={camera.id} className="rounded-2xl border overflow-hidden"><CameraSnapshot camera={camera} clientEmail={managedClient}/><div className="p-4 flex items-center gap-3"><div className="flex-1"><p className="font-semibold">{camera.name}</p><p className="text-xs text-muted-foreground">{camera.model || "CTRONICS"} · conservation {camera.retention_days} jours</p></div><button onClick={() => setSelectedCamera(camera)} className="rounded-lg border p-2" aria-label={`Agrandir ${camera.name}`}><Maximize2 className="w-4 h-4"/></button></div></div>)}{!isLoading && !cameras.length && <div className="col-span-2 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Aucune caméra enregistrée. La passerelle locale sera associée lors de l’installation sur site.</div>}</div></div>
    <div className="rounded-2xl border p-5"><div className="flex items-center gap-2"><Clock3 className="w-4 h-4 text-primary"/><h2 className="text-sm font-semibold">Enregistrements Dropbox</h2></div><div className="mt-3 divide-y">{recordings.map(recording => <div key={recording.id} className="py-3 flex items-center gap-3"><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{recording.name}</p><p className="text-xs text-muted-foreground">{new Date(recording.started_at).toLocaleString("fr-BE")} · suppression automatique {new Date(recording.expires_at).toLocaleDateString("fr-BE")}</p></div><button disabled={busy} onClick={() => downloadRecording(recording)} className="rounded-lg border p-2" aria-label="Télécharger"><Download className="w-4 h-4"/></button></div>)}{!recordings.length && <p className="text-xs text-muted-foreground mt-2">Aucun clip archivé.</p>}</div></div>
    {selectedCamera && <div className="fixed inset-0 z-50 bg-black/90 p-4 flex flex-col"><div className="flex items-center justify-between text-white pb-3"><p className="font-semibold">{selectedCamera.name}</p><button onClick={() => setSelectedCamera(null)} className="rounded-lg border border-white/20 p-2"><X className="w-5 h-5"/></button></div><CameraSnapshot camera={selectedCamera} clientEmail={managedClient} large/></div>}
  </div>;
}


