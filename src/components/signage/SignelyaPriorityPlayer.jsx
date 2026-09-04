import React from "react";
import { CheckCircle2, CircleAlert, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize2, MonitorPlay } from "lucide-react";

const mediaIdOf = item => item?.mediaId || item?.media_id || item?.media?.id || "";
const parseJson = value => { if (!value || typeof value === "object") return value || {}; try { return JSON.parse(value); } catch { return {}; } };
const playlistIdOf = publication => publication?.playlist_id || publication?.playlistId || parseJson(publication?.manifest).playlistId || "";
const itemsOf = (publication, playlist) => { const manifest = parseJson(publication?.manifest); return Array.isArray(manifest.items) && manifest.items.length ? manifest.items : (Array.isArray(playlist?.items) ? playlist.items : []); };

async function signageApi(path, clientEmail = "") {
  const response = await fetch(`/api/signage${path}`, { credentials: "same-origin", headers: clientEmail ? { "X-Client-Email": clientEmail } : {} });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Service SIGNELYA indisponible");
  return data;
}

export default function SignelyaPriorityPlayer({ clientEmail = "", isAdmin = false }) {
  const [dashboard, setDashboard] = React.useState(null);
  const [error, setError] = React.useState("");
  const [activated, setActivated] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [muted, setMuted] = React.useState(true);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [urls, setUrls] = React.useState({});
  const [mediaError, setMediaError] = React.useState("");
  const screenRef = React.useRef(null);
  const videoRef = React.useRef(null);

  React.useEffect(() => {
    if (isAdmin && !clientEmail) return;
    let cancelled = false;
    const load = async () => {
      try { const data = await signageApi("/manage/dashboard", clientEmail); if (!cancelled) { setDashboard(data); setError(""); } }
      catch (e) { if (!cancelled) setError(e.message); }
    };
    load();
    const timer = window.setInterval(load, 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [clientEmail, isAdmin]);

  const players = dashboard?.players || [];
  const media = dashboard?.media || [];
  const playlists = dashboard?.playlists || [];
  const publications = dashboard?.publications || [];
  const player = [...players].sort((a,b) => new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0))[0] || null;
  const playerOnline = player?.status === "online";
  const publication = publications.find(p => ["active","pending"].includes(p.status)) || publications[0] || null;
  const playlist = playlists.find(p => p.id === playlistIdOf(publication)) || playlists[0] || null;
  const items = itemsOf(publication, playlist).map(item => { const id = mediaIdOf(item); return { ...item, media: media.find(m => m.id === id) || item.media || { id, name: "Média indisponible" } }; });
  const current = items[activeIndex] || null;
  const currentId = mediaIdOf(current);
  const currentMedia = current?.media || {};
  const currentUrl = urls[currentId];
  const isImage = String(currentMedia.mime_type || "").startsWith("image/");

  const loadCurrent = React.useCallback(async id => {
    if (!id || urls[id]) return;
    setMediaError("");
    try { const result = await signageApi(`/manage/media/${id}/download`, clientEmail); setUrls(old => ({ ...old, [id]: result.url })); }
    catch (e) { setMediaError(e.message); }
  }, [clientEmail, urls]);

  const activate = async () => { setActivated(true); setPlaying(true); await loadCurrent(currentId); };
  const goTo = async index => {
    if (!items.length) return;
    const next = (index + items.length) % items.length;
    setActiveIndex(next); setPlaying(true); setActivated(true);
    await loadCurrent(mediaIdOf(items[next]));
  };
  const next = () => goTo(activeIndex + 1);

  React.useEffect(() => { if (activated && currentId && !currentUrl) loadCurrent(currentId); }, [activated, currentId, currentUrl, loadCurrent]);
  React.useEffect(() => { const video = videoRef.current; if (!video || isImage || !currentUrl) return; video.muted = muted; if (playing) video.play().catch(() => {}); else video.pause(); }, [playing, muted, isImage, currentUrl, activeIndex]);
  React.useEffect(() => { if (!activated || !playing || !isImage || !currentUrl) return; const seconds = Math.max(3, Number(current?.durationSeconds || current?.duration_seconds || 15)); const timer = window.setTimeout(next, seconds * 1000); return () => window.clearTimeout(timer); }, [activated, playing, isImage, currentUrl, activeIndex]);

  return <div className="signelya-priority-zone space-y-4 px-4 pt-4 md:px-6 md:pt-6 max-w-7xl mx-auto">
    <section className={`rounded-2xl border p-4 md:p-5 ${playerOnline ? "border-cyan-400/40 bg-[linear-gradient(135deg,rgba(0,212,255,.10),rgba(37,99,235,.05))]" : "border-fuchsia-400/35 bg-fuchsia-500/5"}`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${playerOnline ? "bg-cyan-500 text-white shadow-[0_0_20px_rgba(0,212,255,.35)]" : "bg-fuchsia-600 text-white"}`}>{playerOnline ? <CheckCircle2 className="h-6 w-6"/> : <CircleAlert className="h-6 w-6"/>}</div>
        <div className="min-w-0"><h2 className="text-base md:text-lg font-bold">{playerOnline ? "Votre écran est bien connecté" : "Connexion de l’écran à vérifier"}</h2><p className="mt-1 text-sm text-muted-foreground">{playerOnline ? "Vous pouvez préparer ou programmer une nouvelle diffusion." : "Vos médias restent enregistrés. Vérifiez la connexion de l’écran."}</p>{player?.last_seen_at && <p className="mt-1 text-xs text-muted-foreground">Dernier contact : {new Date(player.last_seen_at).toLocaleString("fr-BE")}</p>}</div>
      </div>
    </section>

    <section className="overflow-hidden rounded-2xl border border-cyan-400/35 bg-card shadow-[0_0_28px_rgba(0,212,255,.08)]">
      <div className="flex items-start gap-3 border-b border-cyan-400/20 bg-[linear-gradient(135deg,rgba(0,212,255,.08),rgba(138,43,226,.08))] p-4 md:p-5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#07152D] text-cyan-300"><MonitorPlay className="h-5 w-5"/></span><div><h2 className="font-bold">Boucle programmée · aperçu fidèle à l’écran</h2><p className="mt-1 text-sm text-muted-foreground">Le Player reste au repos jusqu’à ce que vous lanciez l’aperçu.</p></div></div>
      <div className="p-3 md:p-5">
        <div ref={screenRef} className="relative aspect-video overflow-hidden rounded-2xl border border-cyan-400/20 bg-black shadow-[0_18px_42px_rgba(2,6,23,.34)]">
          {!activated && <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-[radial-gradient(circle_at_center,rgba(0,212,255,.10),transparent_38%),#000] p-6 text-center"><img src="/signelya-officiel-jsinnovia.png" onError={e => { e.currentTarget.src = "/signelya-symbol-approved-512.png"; }} alt="SIGNELYA By Js-Innov.IA" className="max-h-[38%] max-w-[72%] object-contain drop-shadow-[0_0_24px_rgba(0,212,255,.28)]"/><button type="button" onClick={activate} disabled={!items.length} className="inline-flex min-h-12 items-center gap-3 rounded-full bg-[linear-gradient(110deg,#00d4ff,#087dff_38%,#8a2be2_72%,#ff2bd6)] px-6 py-3 font-bold text-white shadow-[0_0_28px_rgba(0,212,255,.32)] disabled:opacity-40"><Play className="h-5 w-5 fill-current"/> Lire l’aperçu</button><p className="text-xs text-white/45">Aucun média vidéo n’est chargé avant votre clic.</p></div>}
          {activated && !currentUrl && !mediaError && <div className="absolute inset-0 grid place-items-center text-sm text-white/55">Chargement du média…</div>}
          {activated && mediaError && <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-red-300">{mediaError}</div>}
          {activated && currentUrl && (isImage ? <img src={currentUrl} alt={currentMedia.name || "Média"} className="h-full w-full object-contain"/> : <video ref={videoRef} src={currentUrl} muted={muted} playsInline preload="metadata" onEnded={next} className="h-full w-full object-contain"/>)}
        </div>
        {activated && <div className="mt-3 flex flex-wrap items-center gap-2"><button onClick={() => goTo(activeIndex-1)} className="grid h-10 w-10 place-items-center rounded-xl border bg-background" aria-label="Précédent"><SkipBack className="h-4 w-4"/></button><button onClick={() => setPlaying(v=>!v)} className="grid h-10 w-10 place-items-center rounded-xl bg-[linear-gradient(135deg,#0066ff,#8a2be2)] text-white" aria-label={playing?"Pause":"Lire"}>{playing?<Pause className="h-4 w-4"/>:<Play className="h-4 w-4"/>}</button><button onClick={next} className="grid h-10 w-10 place-items-center rounded-xl border bg-background" aria-label="Suivant"><SkipForward className="h-4 w-4"/></button><button onClick={()=>setMuted(v=>!v)} className="grid h-10 w-10 place-items-center rounded-xl border bg-background" aria-label="Son">{muted?<VolumeX className="h-4 w-4"/>:<Volume2 className="h-4 w-4"/>}</button><button onClick={()=>screenRef.current?.requestFullscreen?.()} className="grid h-10 w-10 place-items-center rounded-xl border bg-background" aria-label="Plein écran"><Maximize2 className="h-4 w-4"/></button><div className="min-w-0 flex-1 pl-1"><p className="truncate text-sm font-semibold">{currentMedia.name || "Média programmé"}</p><p className="text-xs text-muted-foreground">{items.length ? `${activeIndex+1}/${items.length} · ${playlist?.name || "Programme SIGNELYA"}` : "Aucun programme"}</p></div></div>}
      </div>
    </section>
    {error && <p className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
  </div>;
}
