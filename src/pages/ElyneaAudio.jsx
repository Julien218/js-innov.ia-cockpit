import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Loader2,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Send,
  Upload,
  Volume2,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";

const API = "/api/music-motion/audio";
const CURRENT_KEY = "elynea_audio_current_path";
const VOLUME_KEY = "elynea_audio_volume";
const HANDOFF_KEY = "elynea_audio_motion_handoff";

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function formatTime(value) {
  const seconds = Math.max(0, Number(value || 0));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export default function ElyneaAudio() {
  const audioRef = useRef(null);
  const [tracks, setTracks] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [activePlaylist, setActivePlaylist] = useState("all");
  const [currentPath, setCurrentPath] = useState(() => localStorage.getItem(CURRENT_KEY) || "");
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const stored = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 0.7;
  });

  const current = useMemo(
    () => tracks.find((track) => track.path === currentPath) || tracks[0] || null,
    [currentPath, tracks],
  );

  const queue = useMemo(() => {
    if (activePlaylist === "all") return tracks;
    const playlist = playlists.find((item) => item.name === activePlaylist);
    if (!playlist) return tracks;
    const byPath = new Map(tracks.map((track) => [track.path, track]));
    return (playlist.tracks || []).map((trackPath) => byPath.get(trackPath)).filter(Boolean);
  }, [activePlaylist, playlists, tracks]);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setNotice("");
    try {
      const [trackData, playlistData] = await Promise.all([
        jsonRequest(`${API}/tracks`),
        jsonRequest(`${API}/playlists`),
      ]);
      const nextTracks = Array.isArray(trackData.tracks) ? trackData.tracks : [];
      setTracks(nextTracks);
      setPlaylists(Array.isArray(playlistData.playlists) ? playlistData.playlists : []);
      setCurrentPath((previous) => (
        previous && nextTracks.some((track) => track.path === previous)
          ? previous
          : nextTracks[0]?.path || ""
      ));
    } catch (error) {
      setNotice(error.message || "Bibliothèque audio indisponible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadLibrary(); }, [loadLibrary]);

  useEffect(() => {
    if (currentPath) localStorage.setItem(CURRENT_KEY, currentPath);
    else localStorage.removeItem(CURRENT_KEY);
  }, [currentPath]);

  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, String(volume));
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const play = useCallback(async () => {
    if (!audioRef.current || !current) return;
    try {
      await audioRef.current.play();
      setNotice("");
    } catch {
      setNotice("Cliquez une première fois sur Lecture pour autoriser la lecture audio.");
    }
  }, [current]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const step = useCallback((direction) => {
    const source = queue.length ? queue : tracks;
    if (!source.length) return;
    const index = Math.max(0, source.findIndex((track) => track.path === current?.path));
    const next = source[(index + direction + source.length) % source.length];
    if (!next) return;
    setCurrentPath(next.path);
    window.setTimeout(() => void audioRef.current?.play(), 60);
  }, [current?.path, queue, tracks]);

  const upload = useCallback(async (files) => {
    const list = [...(files || [])];
    if (!list.length) return;
    setUploading(true);
    setNotice("");
    try {
      for (const file of list) {
        const response = await fetch(`${API}/upload?filename=${encodeURIComponent(file.name)}`, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-File-Name": file.name,
          },
          body: file,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Upload HTTP ${response.status}`);
      }
      await loadLibrary();
      setNotice(`${list.length} fichier${list.length > 1 ? "s" : ""} ajouté${list.length > 1 ? "s" : ""} à Dropbox.`);
    } catch (error) {
      setNotice(error.message || "Import audio impossible.");
    } finally {
      setUploading(false);
    }
  }, [loadLibrary]);

  const sendToMotion = useCallback((track) => {
    if (!track) return;
    window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(track));
    window.location.assign("/music-motion?source=elynea-audio");
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <PageHeader
        title="Elynea Audio"
        subtitle="Lecteur et bibliothèque Dropbox centralisés dans le Cockpit, sans widget flottant sur l’écran."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={loadLibrary} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Actualiser
            </Button>
            <label className="inline-flex cursor-pointer items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Ajouter musique
              <input
                type="file"
                multiple
                accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus"
                className="sr-only"
                disabled={uploading}
                onChange={(event) => {
                  const files = event.target.files;
                  event.target.value = "";
                  void upload(files);
                }}
              />
            </label>
          </div>
        }
      />

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <audio
          ref={audioRef}
          src={current?.stream_url || undefined}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => step(1)}
          onLoadedMetadata={(event) => {
            event.currentTarget.volume = volume;
            setDuration(Number(event.currentTarget.duration || 0));
          }}
          onTimeUpdate={(event) => setTime(Number(event.currentTarget.currentTime || 0))}
        />

        <div className="flex flex-col gap-5 md:flex-row md:items-center">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Music2 className="h-8 w-8" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold">{current?.name || "Aucun morceau sélectionné"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {current ? `${formatTime(time)} / ${formatTime(duration)} · Dropbox` : "Ajoutez une musique pour commencer."}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: duration > 0 ? `${Math.min(100, (time / duration) * 100)}%` : "0%" }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" onClick={() => step(-1)} disabled={!current}><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="icon" onClick={() => playing ? pause() : void play()} disabled={!current}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button size="icon" variant="outline" onClick={() => step(1)} disabled={!current}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-center">
          <label className="flex min-w-0 flex-1 items-center gap-3 text-sm text-muted-foreground">
            <Volume2 className="h-4 w-4 shrink-0" />
            <input
              className="w-full accent-primary"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              aria-label="Volume musique"
            />
          </label>
          <select
            value={activePlaylist}
            onChange={(event) => setActivePlaylist(event.target.value)}
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="all">Toute la bibliothèque</option>
            {playlists.map((playlist) => <option key={playlist.name} value={playlist.name}>{playlist.name}</option>)}
          </select>
          <Button variant="outline" onClick={() => sendToMotion(current)} disabled={!current}>
            <Send className="mr-2 h-4 w-4" />
            Créer visuel / clip
          </Button>
        </div>
      </section>

      {notice && <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">{notice}</div>}

      <section className="rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <FolderOpen className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Bibliothèque Dropbox</h2>
          <span className="text-xs text-muted-foreground">· {queue.length} morceau(x)</span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Chargement…</div>
        ) : queue.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Aucune musique dans cette sélection.</div>
        ) : (
          <div className="divide-y divide-border">
            {queue.map((track) => (
              <button
                type="button"
                key={track.path}
                onClick={() => {
                  setCurrentPath(track.path);
                  window.setTimeout(() => void audioRef.current?.play(), 60);
                }}
                className={`flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/40 ${track.path === current?.path ? "bg-primary/5" : ""}`}
              >
                <Music2 className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{track.name}</span>
                {track.path === current?.path && playing && <span className="text-xs text-primary">Lecture</span>}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
