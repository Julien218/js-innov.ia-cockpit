import { useEffect, useState } from 'react';
import { Cloud, Cpu, Loader2 } from 'lucide-react';
import {
  VIDEO_MODES,
  getLocalVideoStatus,
  getVideoMode,
  setVideoMode,
} from '@/lib/videoOrchestrator';

export default function VideoModeToggle({ onChange }) {
  const [mode, setModeState] = useState(getVideoMode);
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);

  const refreshStatus = async (currentMode = mode) => {
    if (currentMode !== VIDEO_MODES.LOCAL) {
      setStatus(null);
      return;
    }
    setChecking(true);
    try {
      setStatus(await getLocalVideoStatus());
    } catch (error) {
      setStatus({ available: false, comfyui: { online: false }, error: error.message });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    refreshStatus(mode);
    if (mode !== VIDEO_MODES.LOCAL) return undefined;
    const timer = window.setInterval(() => refreshStatus(VIDEO_MODES.LOCAL), 15000);
    return () => window.clearInterval(timer);
  }, [mode]);

  const local = mode === VIDEO_MODES.LOCAL;
  const online = Boolean(status?.comfyui?.online);

  const toggle = () => {
    const next = local ? VIDEO_MODES.API : VIDEO_MODES.LOCAL;
    setModeState(setVideoMode(next));
    onChange?.(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={local ? 'LOCAL actif — cliquer pour repasser en API' : 'API active — cliquer pour forcer le traitement local'}
      className={`h-9 px-3 rounded-xl border flex items-center gap-2 text-xs font-semibold transition-all ${
        local
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
          : 'border-sky-500/40 bg-sky-500/10 text-sky-600'
      }`}
    >
      {checking ? <Loader2 size={14} className="animate-spin" /> : local ? <Cpu size={14} /> : <Cloud size={14} />}
      <span>{local ? 'LOCAL' : 'API'}</span>
      {local && <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-500'}`} />}
    </button>
  );
}
