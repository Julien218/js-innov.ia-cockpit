import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Disc3,
  FolderOpen,
  ListMusic,
  Loader2,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Upload,
  Volume2,
  X,
} from 'lucide-react';

const API = '/api/music-motion/audio';
const CURRENT_KEY = 'elynea_audio_current_path';
const VOLUME_KEY = 'elynea_audio_volume';
const HANDOFF_KEY = 'elynea_audio_motion_handoff';

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatTime(value) {
  const seconds = Math.max(0, Number(value || 0));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function injectTrackIntoMusicMotion(track) {
  const response = await fetch(track.stream_url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Lecture source HTTP ${response.status}`);
  const blob = await response.blob();
  const file = new File([blob], track.name, { type: blob.type || track.mime_type || 'audio/mpeg' });

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const input = [...document.querySelectorAll('input[type="file"]')]
      .find(node => String(node.getAttribute('accept') || '').toLowerCase().includes('audio'));
    if (input) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    await new Promise(resolve => window.setTimeout(resolve, 300));
  }
  throw new Error('Le champ audio de Music Motion n’est pas encore disponible.');
}

export default function ElyneaAudioDock() {
  const audioRef = useRef(null);
  const autoplayRef = useRef(false);
  const [tracks, setTracks] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [activePlaylist, setActivePlaylist] = useState('all');
  const [currentPath, setCurrentPath] = useState(() => localStorage.getItem(CURRENT_KEY) || '');
  const [playing, setPlaying] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const stored = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 0.7;
  });
  const [selected, setSelected] = useState(() => new Set());
  const [playlistName, setPlaylistName] = useState('');

  const current = useMemo(
    () => tracks.find(track => track.path === currentPath) || null,
    [currentPath, tracks],
  );

  const queue = useMemo(() => {
    if (activePlaylist === 'all') return tracks;
    const playlist = playlists.find(item => item.name === activePlaylist);
    if (!playlist) return tracks;
    const byPath = new Map(tracks.map(track => [track.path, track]));
    return playlist.tracks.map(trackPath => byPath.get(trackPath)).filter(Boolean);
  }, [activePlaylist, playlists, tracks]);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setNotice('');
    try {
      const [trackData, playlistData] = await Promise.all([
        jsonRequest(`${API}/tracks`),
        jsonRequest(`${API}/playlists`),
      ]);
      const nextTracks = Array.isArray(trackData.tracks) ? trackData.tracks : [];
      setTracks(nextTracks);
      setPlaylists(Array.isArray(playlistData.playlists) ? playlistData.playlists : []);
      setCurrentPath(previous => {
        if (previous && nextTracks.some(track => track.path === previous)) return previous;
        return nextTracks[0]?.path || '';
      });
    } catch (error) {
      setNotice(error.message || 'Bibliothèque audio indisponible.');
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
    const audio = audioRef.current;
    if (!audio) return;
    if (!current && tracks[0]) {
      autoplayRef.current = true;
      setCurrentPath(tracks[0].path);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
      setNotice('');
    } catch {
      setPlaying(false);
      setNotice('Le navigateur bloque le démarrage automatique. Cliquez une première fois sur ▶ puis Elynea pourra piloter la musique.');
    }
  }, [current, tracks]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const playTrack = useCallback((track) => {
    if (!track) return;
    autoplayRef.current = true;
    setCurrentPath(track.path);
  }, []);

  const step = useCallback((direction) => {
    const source = queue.length ? queue : tracks;
    if (!source.length) return;
    const index = Math.max(0, source.findIndex(track => track.path === currentPath));
    const next = source[(index + direction + source.length) % source.length];
    playTrack(next);
  }, [currentPath, playTrack, queue, tracks]);

  useEffect(() => {
    if (!current || !autoplayRef.current) return;
    autoplayRef.current = false;
    const timer = window.setTimeout(() => { void play(); }, 40);
    return () => window.clearTimeout(timer);
  }, [current, play]);

  useEffect(() => {
    const onCommand = event => {
      const detail = event?.detail || {};
      const action = String(detail.action || '').toLowerCase();
      if (action === 'play' || action === 'resume') void play();
      else if (action === 'pause' || action === 'stop') pause();
      else if (action === 'next') step(1);
      else if (action === 'previous') step(-1);
      else if (action === 'playlist') {
        const requested = String(detail.name || '').trim().toLowerCase();
        const playlist = playlists.find(item => item.name.toLowerCase().includes(requested));
        if (playlist) {
          setActivePlaylist(playlist.name);
          const first = tracks.find(track => track.path === playlist.tracks[0]);
          if (first) playTrack(first);
        } else setNotice(`Playlist « ${detail.name || ''} » introuvable.`);
      }
    };
    window.addEventListener('elynea:audio-command', onCommand);
    return () => window.removeEventListener('elynea:audio-command', onCommand);
  }, [pause, play, playTrack, playlists, step, tracks]);

  useEffect(() => {
    if (!window.location.pathname.startsWith('/music-motion')) return;
    const raw = window.sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return;
    window.sessionStorage.removeItem(HANDOFF_KEY);
    let track;
    try { track = JSON.parse(raw); } catch { return; }
    const timer = window.setTimeout(() => {
      setNotice(`Import de « ${track.name} » dans Music Motion…`);
      void injectTrackIntoMusicMotion(track)
        .then(() => setNotice(`« ${track.name} » est chargé comme source audio dans Music Motion.`))
        .catch(error => setNotice(error.message));
    }, 500);
    return () => window.clearTimeout(timer);
  }, []);

  const upload = useCallback(async (files) => {
    const list = [...(files || [])];
    if (!list.length) return;
    setUploading(true);
    setNotice('');
    try {
      for (const file of list) {
        const response = await fetch(`${API}/upload?filename=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-File-Name': file.name,
          },
          body: file,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Upload HTTP ${response.status}`);
      }
      await loadLibrary();
      setNotice(`${list.length} fichier${list.length > 1 ? 's' : ''} ajouté${list.length > 1 ? 's' : ''} à Dropbox.`);
    } catch (error) {
      setNotice(error.message || 'Import audio impossible.');
    } finally {
      setUploading(false);
    }
  }, [loadLibrary]);

  const savePlaylist = useCallback(async () => {
    if (!playlistName.trim() || selected.size === 0) return;
    setLoading(true);
    try {
      await jsonRequest(`${API}/playlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: playlistName.trim(), tracks: [...selected] }),
      });
      setPlaylistName('');
      setSelected(new Set());
      await loadLibrary();
      setNotice('Playlist enregistrée dans Dropbox.');
    } catch (error) {
      setNotice(error.message || 'Enregistrement de la playlist impossible.');
    } finally {
      setLoading(false);
    }
  }, [loadLibrary, playlistName, selected]);

  const sendToMotion = useCallback(async (track) => {
    if (!track) return;
    window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(track));
    if (!window.location.pathname.startsWith('/music-motion')) {
      window.location.assign('/music-motion?source=elynea-audio');
      return;
    }
    window.sessionStorage.removeItem(HANDOFF_KEY);
    try {
      setNotice(`Import de « ${track.name} » dans Music Motion…`);
      await injectTrackIntoMusicMotion(track);
      setNotice(`« ${track.name} » est chargé comme source audio dans Music Motion.`);
    } catch (error) {
      setNotice(error.message);
    }
  }, []);

  const toggleSelected = pathValue => {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(pathValue)) next.delete(pathValue);
      else next.add(pathValue);
      return next;
    });
  };

  const progress = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <>
      <audio
        ref={audioRef}
        src={current?.stream_url || undefined}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => step(1)}
        onLoadedMetadata={event => {
          event.currentTarget.volume = volume;
          setDuration(Number(event.currentTarget.duration || 0));
        }}
        onTimeUpdate={event => setTime(Number(event.currentTarget.currentTime || 0))}
      />

      <div className="cockpit-audio-dock cockpit-electric-frame fixed bottom-4 left-1/2 z-[99990] w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-amber-400/25 bg-[#0b0b10]/90 text-white shadow-2xl backdrop-blur-xl" aria-label="Lecteur audio persistant du Cockpit">
        <div className="h-1 bg-white/10">
          <div className="h-full bg-amber-300 transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex items-center gap-2 p-2.5">
          <button type="button" onClick={() => setDrawerOpen(true)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-300/15 text-amber-200 hover:bg-amber-300/25" title="Bibliothèque Elynea Audio">
            <Disc3 className={`h-5 w-5 ${playing ? 'animate-spin [animation-duration:4s]' : ''}`} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{current?.name || 'Elynea Audio'}</p>
            <p className="truncate text-[10px] text-white/50">{current ? `${formatTime(time)} / ${formatTime(duration)}` : 'Bibliothèque Dropbox'}</p>
          </div>
          <button type="button" onClick={() => step(-1)} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white" title="Précédent"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => playing ? pause() : void play()} className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-300 text-black hover:bg-amber-200" title={playing ? 'Pause' : 'Lecture'}>
            {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
          </button>
          <button type="button" onClick={() => step(1)} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white" title="Suivant"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-[100010] flex justify-end bg-black/55 backdrop-blur-sm" onMouseDown={event => { if (event.currentTarget === event.target) setDrawerOpen(false); }}>
          <aside className="flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-[#0b0b10] text-white shadow-2xl">
            <header className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-300/15 text-amber-200"><Music2 className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">Elynea Audio Studio</h2>
                <p className="text-xs text-white/50">Lecteur, playlists et source Dropbox pour tes créations.</p>
              </div>
              <button type="button" onClick={() => void loadLibrary()} className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white" title="Actualiser"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white" title="Fermer"><X className="h-5 w-5" /></button>
            </header>

            <div className="border-b border-white/10 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-amber-300 px-3 py-2 text-xs font-semibold text-black hover:bg-amber-200">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Ajouter musique
                  <input className="sr-only" type="file" multiple accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus" disabled={uploading} onChange={event => { const files = event.target.files; event.target.value = ''; void upload(files); }} />
                </label>
                <button type="button" onClick={() => current && void sendToMotion(current)} disabled={!current} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40" title="Charge ce morceau comme source audio dans Elynea Motion Studio">
                  <Send className="h-4 w-4" />Créer visuel / clip
                </button>
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-[11px] text-white/50"><FolderOpen className="h-3.5 w-3.5" />Dropbox connecté</span>
              </div>
              {notice && <p className="mt-2 rounded-lg bg-white/5 px-3 py-2 text-[11px] leading-4 text-white/70">{notice}</p>}
            </div>

            <div className="flex gap-2 overflow-x-auto border-b border-white/10 px-4 py-3">
              <button type="button" onClick={() => setActivePlaylist('all')} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${activePlaylist === 'all' ? 'bg-amber-300 text-black' : 'bg-white/5 text-white/70'}`}>Toute la musique</button>
              {playlists.map(playlist => (
                <button key={playlist.name} type="button" onClick={() => setActivePlaylist(playlist.name)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${activePlaylist === playlist.name ? 'bg-amber-300 text-black' : 'bg-white/5 text-white/70'}`}>
                  {playlist.name}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {loading && !tracks.length ? (
                <div className="flex h-32 items-center justify-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" />Chargement Dropbox…</div>
              ) : queue.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-white/45">Ajoute tes MP3, WAV ou M4A : ils apparaîtront ici et resteront stockés dans Dropbox.</div>
              ) : (
                <div className="space-y-1.5">
                  {queue.map(track => {
                    const active = track.path === currentPath;
                    return (
                      <div key={track.path} className={`group flex items-center gap-2 rounded-xl border px-2.5 py-2 ${active ? 'border-amber-300/40 bg-amber-300/10' : 'border-white/5 bg-white/[0.025] hover:bg-white/5'}`}>
                        <input type="checkbox" checked={selected.has(track.path)} onChange={() => toggleSelected(track.path)} className="h-4 w-4 accent-amber-300" aria-label={`Sélectionner ${track.name}`} />
                        <button type="button" onClick={() => playTrack(track)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/70 hover:bg-amber-300 hover:text-black" title={`Lire ${track.name}`}><Play className="h-3.5 w-3.5 fill-current" /></button>
                        <button type="button" onClick={() => playTrack(track)} className="min-w-0 flex-1 text-left">
                          <p className="truncate text-xs font-medium">{track.name}</p>
                          <p className="mt-0.5 text-[10px] text-white/40">{formatBytes(track.size)} · Dropbox</p>
                        </button>
                        <button type="button" onClick={() => void sendToMotion(track)} className="rounded-lg p-2 text-cyan-200/70 opacity-70 hover:bg-cyan-400/10 hover:text-cyan-100 group-hover:opacity-100" title="Utiliser dans Elynea Motion Studio"><Send className="h-4 w-4" /></button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <footer className="border-t border-white/10 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-white/50" />
                <input className="w-full accent-amber-300" type="range" min="0" max="1" step="0.01" value={volume} onChange={event => setVolume(Number(event.target.value))} aria-label="Volume musique" />
              </div>
              <div className="flex items-center gap-2">
                <ListMusic className="h-4 w-4 shrink-0 text-white/50" />
                <input value={playlistName} onChange={event => setPlaylistName(event.target.value)} placeholder="Nom de la nouvelle playlist" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs outline-none focus:border-amber-300/50" />
                <button type="button" onClick={() => void savePlaylist()} disabled={!playlistName.trim() || selected.size === 0 || loading} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15 disabled:opacity-35"><Plus className="h-3.5 w-3.5" />Playlist ({selected.size})</button>
              </div>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
