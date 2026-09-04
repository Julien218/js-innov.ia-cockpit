import React from "react";
import {
  CheckCircle2,
  CircleAlert,
  Maximize2,
  MonitorPlay,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";

const mediaIdOf = item => item?.mediaId || item?.media_id || item?.media?.id || "";

const parseJson = value => {
  if (!value || typeof value === "object") return value || {};
  try { return JSON.parse(value); } catch { return {}; }
};

const playlistIdOf = publication =>
  publication?.playlist_id || publication?.playlistId || parseJson(publication?.manifest).playlistId || "";

const itemsOf = (publication, playlist) => {
  const manifest = parseJson(publication?.manifest);
  if (Array.isArray(manifest.items) && manifest.items.length) return manifest.items;
  return Array.isArray(playlist?.items) ? playlist.items : [];
};

async function signageApi(path, clientEmail = "") {
  const response = await fetch(`/api/signage${path}`, {
    credentials: "same-origin",
    headers: clientEmail ? { "X-Client-Email": clientEmail } : {},
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Service SIGNELYA indisponible");
  return data;
}

export default function SignelyaPriorityPlayer({
  clientEmail = "",
  isAdmin = false,
  dashboardData,
}) {
  const usesExternalDashboard = dashboardData !== undefined;
  const [internalDashboard, setInternalDashboard] = React.useState(null);
  const [error, setError] = React.useState("");
  const [activated, setActivated] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [muted, setMuted] = React.useState(true);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [cycle, setCycle] = React.useState(0);
  const [urls, setUrls] = React.useState({});
  const [mediaError, setMediaError] = React.useState("");
  const screenRef = React.useRef(null);
  const videoRef = React.useRef(null);
  const urlsRef = React.useRef({});
  const loadingIdsRef = React.useRef(new Set());
  const previewSessionRef = React.useRef(0);

  const dashboard = usesExternalDashboard ? dashboardData : internalDashboard;

  React.useEffect(() => {
    if (usesExternalDashboard || (isAdmin && !clientEmail)) return undefined;

    let cancelled = false;
    const load = async () => {
      try {
        const data = await signageApi("/manage/dashboard", clientEmail);
        if (!cancelled) {
          setInternalDashboard(data);
          setError("");
        }
      } catch (fetchError) {
        if (!cancelled) setError(fetchError.message);
      }
    };

    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [clientEmail, isAdmin, usesExternalDashboard]);

  const players = dashboard?.players || [];
  const media = dashboard?.media || [];
  const playlists = dashboard?.playlists || [];
  const publications = dashboard?.publications || [];
  const player = [...players].sort(
    (a, b) => new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime(),
  )[0] || null;
  const playerOnline = player?.status === "online";
  const publication = publications.find(item => ["active", "pending"].includes(item.status)) || publications[0] || null;
  const playlist = playlists.find(item => item.id === playlistIdOf(publication)) || playlists[0] || null;
  const items = itemsOf(publication, playlist).map(item => {
    const id = mediaIdOf(item);
    return {
      ...item,
      media: media.find(mediaItem => mediaItem.id === id) || item.media || { id, name: "Média indisponible" },
    };
  });
  const current = items[activeIndex] || null;
  const currentId = mediaIdOf(current);
  const currentMedia = current?.media || {};
  const currentUrl = urls[currentId];
  const isImage = String(currentMedia.mime_type || "").startsWith("image/");
  const programKey = `${clientEmail}:${publication?.id || "none"}:${playlist?.id || "none"}`;

  React.useEffect(() => {
    previewSessionRef.current += 1;
    loadingIdsRef.current.clear();
    urlsRef.current = {};
    setUrls({});
    setMediaError("");
    setActivated(false);
    setPlaying(false);
    setActiveIndex(0);
    setCycle(0);
  }, [programKey]);

  React.useEffect(() => {
    if (!items.length) {
      setActiveIndex(0);
      setActivated(false);
      setPlaying(false);
      return;
    }
    if (activeIndex >= items.length) setActiveIndex(0);
  }, [activeIndex, items.length]);

  const loadCurrent = React.useCallback(async id => {
    if (!id || urlsRef.current[id] || loadingIdsRef.current.has(id)) return;

    const session = previewSessionRef.current;
    loadingIdsRef.current.add(id);
    setMediaError("");

    try {
      const result = await signageApi(`/manage/media/${id}/download`, clientEmail);
      if (session !== previewSessionRef.current) return;
      setUrls(previous => {
        const nextUrls = { ...previous, [id]: result.url };
        urlsRef.current = nextUrls;
        return nextUrls;
      });
    } catch (loadError) {
      if (session === previewSessionRef.current) setMediaError(loadError.message);
    } finally {
      loadingIdsRef.current.delete(id);
    }
  }, [clientEmail]);

  const activate = async () => {
    if (!items.length || !currentId) return;
    setActivated(true);
    setPlaying(true);
    await loadCurrent(currentId);
  };

  const goTo = async index => {
    if (!items.length) return;
    const nextIndex = (index + items.length) % items.length;
    setActiveIndex(nextIndex);
    setCycle(value => value + 1);
    setActivated(true);
    setPlaying(true);
    await loadCurrent(mediaIdOf(items[nextIndex]));
  };

  const next = () => goTo(activeIndex + 1);

  React.useEffect(() => {
    if (activated && currentId && !currentUrl) loadCurrent(currentId);
  }, [activated, currentId, currentUrl, loadCurrent]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || isImage || !currentUrl) return;
    video.muted = muted;
    if (playing) video.play().catch(() => {});
    else video.pause();
  }, [activeIndex, cycle, currentUrl, isImage, muted, playing]);

  React.useEffect(() => {
    if (!activated || !playing || !isImage || !currentUrl) return undefined;
    const seconds = Math.max(3, Number(current?.durationSeconds || current?.duration_seconds || 15));
    const timer = window.setTimeout(() => goTo(activeIndex + 1), seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [activated, activeIndex, cycle, current?.durationSeconds, current?.duration_seconds, currentUrl, isImage, playing]);

  const noClientSelected = isAdmin && !clientEmail;
  const statusTitle = noClientSelected
    ? "Sélectionnez le client à piloter"
    : playerOnline
      ? "Votre écran est bien connecté"
      : "Connexion de l’écran à vérifier";
  const statusDetail = noClientSelected
    ? "Choisissez un client dans la gestion afin d’afficher son état et sa boucle."
    : playerOnline
      ? "Vous pouvez préparer ou programmer une nouvelle diffusion."
      : "Vos médias restent enregistrés. Vérifiez la connexion de l’écran.";

  return (
    <div className="signelya-priority-zone mx-auto max-w-[1600px] space-y-4 px-4 pt-4 md:px-6 md:pt-6">
      <section className={`rounded-2xl border p-4 md:p-5 ${playerOnline ? "border-cyan-400/40 bg-[linear-gradient(135deg,rgba(0,212,255,.10),rgba(37,99,235,.05))]" : "border-fuchsia-400/35 bg-fuchsia-500/5"}`}>
        <div className="flex items-start gap-3">
          <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${playerOnline ? "bg-cyan-500 text-white shadow-[0_0_20px_rgba(0,212,255,.35)]" : "bg-fuchsia-600 text-white"}`}>
            {playerOnline ? <CheckCircle2 className="h-6 w-6" /> : <CircleAlert className="h-6 w-6" />}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold md:text-lg">{statusTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{statusDetail}</p>
            {player?.last_seen_at && (
              <p className="mt-1 text-xs text-muted-foreground">
                Dernier contact : {new Date(player.last_seen_at).toLocaleString("fr-BE")}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-cyan-400/35 bg-card shadow-[0_0_28px_rgba(0,212,255,.08)]">
        <div className="flex items-start gap-3 border-b border-cyan-400/20 bg-[linear-gradient(135deg,rgba(0,212,255,.08),rgba(138,43,226,.08))] p-4 md:p-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#07152D] text-cyan-300">
            <MonitorPlay className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-bold">Boucle programmée · aperçu fidèle à l’écran</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Le Player reste au repos jusqu’à ce que vous lanciez l’aperçu.
            </p>
          </div>
        </div>

        <div className="p-3 md:p-5">
          <div
            ref={screenRef}
            className="relative aspect-video overflow-hidden rounded-2xl border border-cyan-400/20 bg-black shadow-[0_18px_42px_rgba(2,6,23,.34)]"
          >
            {!activated && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_center,rgba(0,212,255,.11),transparent_42%),#000] p-4 text-center sm:gap-4 sm:p-8">
                <div className="flex max-h-[47%] w-full flex-col items-center justify-center gap-1.5">
                  <img
                    src="/signelya-lockup-horizontal.svg"
                    onError={event => {
                      if (event.currentTarget.dataset.fallbackApplied) return;
                      event.currentTarget.dataset.fallbackApplied = "true";
                      event.currentTarget.src = "/signelya-lockup-approved.png";
                    }}
                    alt="SIGNELYA — Vos écrans prennent vie"
                    className="max-h-full max-w-[82%] object-contain drop-shadow-[0_0_26px_rgba(0,212,255,.30)]"
                  />
                  <p className="signelya-byline text-sm text-white/90 sm:text-base">By Js-Innov.IA</p>
                </div>
                <button
                  type="button"
                  onClick={activate}
                  disabled={!items.length || noClientSelected}
                  className="inline-flex min-h-12 items-center gap-3 rounded-full bg-[linear-gradient(110deg,#00d4ff,#087dff_38%,#8a2be2_72%,#ff2bd6)] px-6 py-3 font-bold text-white shadow-[0_0_28px_rgba(0,212,255,.32)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play className="h-5 w-5 fill-current" />
                  {items.length ? "Lire l’aperçu" : "Aucun programme enregistré"}
                </button>
                <p className="text-[11px] text-white/45 sm:text-xs">Aucun média vidéo n’est chargé avant votre clic.</p>
              </div>
            )}

            {activated && !currentUrl && !mediaError && (
              <div className="absolute inset-0 grid place-items-center text-sm text-white/55">
                Chargement du média…
              </div>
            )}
            {activated && mediaError && (
              <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-red-300">
                {mediaError}
              </div>
            )}
            {activated && currentUrl && (
              isImage ? (
                <img key={`${currentId}-${cycle}`} src={currentUrl} alt={currentMedia.name || "Média"} className="h-full w-full object-contain" />
              ) : (
                <video
                  key={`${currentId}-${currentUrl}-${cycle}`}
                  ref={videoRef}
                  src={currentUrl}
                  muted={muted}
                  playsInline
                  preload="metadata"
                  onEnded={next}
                  onError={() => setMediaError("Cette vidéo ne peut pas être lue dans ce navigateur.")}
                  className="h-full w-full object-contain"
                />
              )
            )}
          </div>

          {activated && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => goTo(activeIndex - 1)} className="grid h-10 w-10 place-items-center rounded-xl border bg-background" aria-label="Média précédent">
                <SkipBack className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setPlaying(value => !value)} className="grid h-10 w-10 place-items-center rounded-xl bg-[linear-gradient(135deg,#0066ff,#8a2be2)] text-white" aria-label={playing ? "Mettre en pause" : "Lire"}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button type="button" onClick={next} className="grid h-10 w-10 place-items-center rounded-xl border bg-background" aria-label="Média suivant">
                <SkipForward className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setMuted(value => !value)} className="grid h-10 w-10 place-items-center rounded-xl border bg-background" aria-label={muted ? "Activer le son" : "Couper le son"}>
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <button type="button" onClick={() => screenRef.current?.requestFullscreen?.()} className="grid h-10 w-10 place-items-center rounded-xl border bg-background" aria-label="Plein écran">
                <Maximize2 className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1 pl-1">
                <p className="truncate text-sm font-semibold">{currentMedia.name || "Média programmé"}</p>
                <p className="text-xs text-muted-foreground">
                  {items.length ? `${activeIndex + 1}/${items.length} · ${playlist?.name || "Programme SIGNELYA"}` : "Aucun programme"}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {error && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
