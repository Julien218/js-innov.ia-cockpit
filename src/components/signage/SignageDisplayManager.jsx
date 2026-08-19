import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Cpu, Radio, Activity, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

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
  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch { throw new Error("Réponse Display Manager illisible"); }
  }
  if (!response.ok) throw new Error(body.error || "Display Manager indisponible");
  return body;
}

const statusClass = value => value === "OK" ? "text-emerald-600" : value === "ERROR" ? "text-red-600" : value === "WARNING" ? "text-amber-600" : "text-muted-foreground";
const shown = value => value === null || value === undefined || value === "" ? "Unknown" : String(value);
const hz = value => Number.isFinite(Number(value)) ? `${Number(value).toFixed(2).replace(/\.00$/, "")} Hz` : "Unknown";
const dateTime = value => value ? new Date(value).toLocaleString("fr-BE") : "Unknown";

function Metric({ label, value, status }) {
  return <div className="rounded-xl border bg-background/60 p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-1 text-sm font-semibold ${status ? statusClass(status) : ""}`}>{shown(value)}</p></div>;
}

function Section({ icon: Icon, title, children }) {
  return <div className="rounded-2xl border bg-card p-4"><div className="mb-3 flex items-center gap-2"><Icon className="h-4 w-4 text-primary"/><p className="text-sm font-semibold">{title}</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div></div>;
}

export default function SignageDisplayManager({ player, managedClient = "" }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isSuperAdmin = user?.role === "superadmin";
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const query = useQuery({
    queryKey: ["signage-display-manager", player?.id, managedClient || "self"],
    queryFn: () => api(`/manage/display/players/${player.id}`, {}, managedClient),
    enabled: Boolean(player?.id) && ["admin", "superadmin"].includes(user?.role),
    refetchInterval: 30000,
  });
  const data = query.data || {};
  const observedPlayer = data.player || player || {};
  const runtime = data.runtime || {};
  const device = data.device || {};
  const display = data.display || {};
  const playback = data.playback || {};
  const profile = data.profile || {};
  const health = data.health || {};
  const checks = health.checks || {};
  const supportedModes = data.supportedModes || [];

  const [mode, setMode] = React.useState("AUTO");
  const [profileName, setProfileName] = React.useState("Colorlight Dour");
  const [processorType, setProcessorType] = React.useState("colorlight");
  const [selectedMode, setSelectedMode] = React.useState("");
  React.useEffect(() => {
    if (!data.profile) return;
    setMode(data.profile.mode || "AUTO");
    setProfileName(data.profile.profile_name || "Colorlight Dour");
    setProcessorType(data.profile.processor_type || "generic_hdmi");
    if (data.profile.preferred_width && data.profile.preferred_height && data.profile.preferred_refresh_hz) {
      setSelectedMode(`${data.profile.preferred_width}x${data.profile.preferred_height}@${Number(data.profile.preferred_refresh_hz)}`);
    }
  }, [data.profile]);

  if (!["admin", "superadmin"].includes(user?.role)) return null;
  if (query.isLoading) return <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">Analyse Display en cours…</div>;
  if (query.error) return <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700">{query.error.message}</div>;

  const currentMode = display.width && display.height ? `${display.width} × ${display.height} · ${hz(display.refreshRate)}` : "Unknown";
  const displayConnected = display.connected === true ? "Détecté" : display.connected === false ? "Non détecté" : "Unknown";
  const scheduleLabel = data.schedule?.ads_allowed === false ? `Bloqué · ${data.schedule.reason || "planning"}` : data.schedule?.ads_allowed === true ? "Autorisé" : "Unknown";
  const publicationLabel = data.publication ? `${data.publication.status}${data.publication.acknowledged_at ? " · ACK" : " · sans ACK"}` : "Aucune";
  const homeMode = runtime.defaultHome === true ? "Pixelium est l’accueil" : runtime.defaultHome === false ? `À configurer${runtime.homePackage ? ` · ${runtime.homePackage}` : ""}` : "Unknown";

  const saveProfile = async () => {
    setBusy(true); setMessage("");
    try {
      let preferredWidth = null, preferredHeight = null, preferredRefreshHz = null;
      if (selectedMode) {
        const match = selectedMode.match(/^(\d+)x(\d+)@([0-9.]+)$/);
        if (match) { preferredWidth = Number(match[1]); preferredHeight = Number(match[2]); preferredRefreshHz = Number(match[3]); }
      }
      await api(`/manage/display/players/${player.id}/profile`, {
        method: "PUT",
        body: JSON.stringify({
          mode, profileName, processorType,
          preferredWidth, preferredHeight, preferredRefreshHz,
          hdrEnabled: false,
          fallbackModes: supportedModes.filter(item => [1920, 1280].includes(Number(item.width))).slice(0, 5),
        }),
      }, managedClient);
      setMessage("Profil enregistré en mode observation. Aucun changement HDMI n’a été envoyé au Player.");
      await queryClient.invalidateQueries({ queryKey: ["signage-display-manager", player.id, managedClient || "self"] });
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };

  return <div className="space-y-4">
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-sm font-semibold">Display / HDMI Manager</p><p className="text-xs text-muted-foreground">Le TVBOX, l’application de lecture, le réseau et l’affichage sont contrôlés séparément.</p></div>
      <div className="text-right"><p className="text-xs text-muted-foreground">GLOBAL HEALTH</p><p className={`text-sm font-bold ${health.state === "HEALTHY" ? "text-emerald-600" : health.state?.includes("ERROR") || health.state === "PLAYER_OFFLINE" ? "text-red-600" : "text-amber-600"}`}>{health.label || "Unknown"}</p></div>
    </div>

    <Section icon={Activity} title="Diagnostic global">
      <Metric label="TVBOX RUNTIME" value={checks.runtime} status={checks.runtime}/><Metric label="PLAYER APP" value={checks.player} status={checks.player}/><Metric label="NETWORK" value={checks.network} status={checks.network}/><Metric label="SCHEDULE" value={checks.schedule} status={checks.schedule}/><Metric label="PUBLICATION" value={checks.publication} status={checks.publication}/><Metric label="HDMI" value={checks.hdmi} status={checks.hdmi}/><Metric label="CONTENT" value={checks.content} status={checks.content}/>
    </Section>

    <Section icon={Cpu} title="Device">
      <Metric label="Manufacturer" value={device.manufacturer}/><Metric label="Model" value={device.model || observedPlayer?.diagnostics?.model}/><Metric label="Android" value={device.androidVersion || observedPlayer?.diagnostics?.android}/><Metric label="API" value={device.apiLevel}/><Metric label="Hardware" value={device.hardware}/><Metric label="Board" value={device.board}/><Metric label="Device" value={device.device}/><Metric label="Product" value={device.product}/><Metric label="SoC" value={[device.socManufacturer, device.socModel].filter(Boolean).join(" ") || "Unknown"}/><Metric label="Mode accueil / kiosk" value={homeMode}/>
    </Section>

    <Section icon={Monitor} title="Display">
      <Metric label="HDMI / Display" value={displayConnected} status={checks.hdmi}/><Metric label="Mode actif" value={currentMode} status={checks.displayMode}/><Metric label="HDR" value={display.hdr === true ? "ON" : display.hdr === false ? "OFF" : "Unknown"}/><Metric label="EDID" value={display.edidAvailable === true ? "Disponible" : display.edidStatus === "unavailable_public_sdk" ? "Indisponible via API Android" : "Unknown"}/><Metric label="Nom Android" value={display.name}/><Metric label="Modes annoncés" value={supportedModes.length || "Unknown"}/>
    </Section>

    <Section icon={Radio} title="Signage">
      <Metric label="Planning" value={scheduleLabel} status={checks.schedule}/><Metric label="Publication" value={publicationLabel} status={checks.publication}/><Metric label="Contenu" value={playback.contentPlaying === true ? "PLAYING" : playback.scheduleBlocked === true ? "SUSPENDED" : "Unknown"} status={checks.content}/><Metric label="Heartbeat TVBOX" value={dateTime(observedPlayer.runtime_last_seen_at)} status={checks.runtime}/><Metric label="Runtime version" value={observedPlayer.runtime_version}/><Metric label="Heartbeat lecture" value={dateTime(observedPlayer.last_seen_at)} status={checks.player}/><Metric label="Player version" value={observedPlayer.app_version}/><Metric label="Activity visible" value={runtime.activityVisible === true ? "Oui" : runtime.activityVisible === false ? "Non" : "Unknown"}/><Metric label="Mode contrôle HDMI" value={data.capabilities?.controlEnabled ? "Enabled" : "Observe only"}/>
    </Section>

    <div className="rounded-2xl border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary"/><div><p className="text-sm font-semibold">Display Profile</p><p className="text-xs text-muted-foreground">AUTO / PROFILE / MANUAL est mémorisé par Player. Pour l’instant aucune commande de changement n’est exécutée.</p></div></div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs">Mode<select className="mt-1 w-full rounded-xl border bg-background p-2 text-sm" value={mode} onChange={e=>setMode(e.target.value)} disabled={!isSuperAdmin}><option>AUTO</option><option>PROFILE</option><option>MANUAL</option></select></label>
        <label className="text-xs">Profil<input className="mt-1 w-full rounded-xl border bg-background p-2 text-sm" value={profileName} onChange={e=>setProfileName(e.target.value)} disabled={!isSuperAdmin}/></label>
        <label className="text-xs">Processeur<select className="mt-1 w-full rounded-xl border bg-background p-2 text-sm" value={processorType} onChange={e=>setProcessorType(e.target.value)} disabled={!isSuperAdmin}><option value="generic_hdmi">HDMI générique</option><option value="colorlight">Colorlight</option><option value="novastar">NovaStar</option><option value="television">Télévision HDMI</option><option value="projector">Vidéoprojecteur</option><option value="professional_display">Écran professionnel</option></select></label>
        <label className="text-xs">Mode préféré<select className="mt-1 w-full rounded-xl border bg-background p-2 text-sm" value={selectedMode} onChange={e=>setSelectedMode(e.target.value)} disabled={!isSuperAdmin || mode === "AUTO"}><option value="">Automatique / non défini</option>{supportedModes.map(item => <option key={`${item.id}-${item.width}-${item.height}-${item.refreshRate}`} value={`${item.width}x${item.height}@${item.refreshRate}`}>{item.width}×{item.height} @ {hz(item.refreshRate)}</option>)}</select></label>
      </div>
      {isSuperAdmin && <button disabled={busy} onClick={saveProfile} className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? "Enregistrement…" : "Enregistrer le profil"}</button>}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
      <p className="text-[11px] text-muted-foreground">Sécurité : aucun root, shell, firmware, reset, token ou changement HDMI n’est déclenché depuis ce panneau.</p>
    </div>
  </div>;
}
