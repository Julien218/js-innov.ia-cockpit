import React, { useEffect, useState } from "react";
import { Mic, Volume2, MonitorCog } from "lucide-react";
import {
  ELYNEA_VOICE_PREFERENCES_EVENT,
  ELYNEA_VOICE_STATUS_EVENT,
  readElyneaVoicePreferences,
  writeElyneaVoicePreferences,
} from "@/lib/elyneaVoicePreferences";

function Toggle({ checked, onClick, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      className={"relative h-7 w-12 rounded-full transition-colors " + (checked ? "bg-cyan-500" : "bg-slate-700")}
    >
      <span className={"absolute top-1 h-5 w-5 rounded-full bg-white transition-all " + (checked ? "left-6" : "left-1")} />
    </button>
  );
}

export default function ElyneaVoiceSettings() {
  const [prefs, setPrefs] = useState(() => readElyneaVoicePreferences());
  const [voices, setVoices] = useState([]);
  const [voiceStatus, setVoiceStatus] = useState({
    supported: false,
    active: false,
    status: "Prêt",
    error: "",
  });

  useEffect(() => {
    const refreshVoices = () => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const french = window.speechSynthesis.getVoices()
        .filter((voice) => String(voice.lang || "").toLowerCase().startsWith("fr"));
      setVoices(french);
    };
    refreshVoices();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoices);
      window.speechSynthesis.onvoiceschanged = refreshVoices;
    }
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.removeEventListener?.("voiceschanged", refreshVoices);
      }
    };
  }, []);

  useEffect(() => {
    const onStatus = (event) => {
      setVoiceStatus((current) => ({ ...current, ...(event?.detail || {}) }));
    };
    window.addEventListener(ELYNEA_VOICE_STATUS_EVENT, onStatus);
    window.dispatchEvent(new CustomEvent(ELYNEA_VOICE_PREFERENCES_EVENT, { detail: prefs }));
    return () => window.removeEventListener(ELYNEA_VOICE_STATUS_EVENT, onStatus);
  }, []);

  const updatePrefs = (patch) => {
    const next = writeElyneaVoicePreferences(patch);
    setPrefs(next);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Elynea · Companion vocal</h2>
        <p className="mt-1 text-sm text-slate-400">
          Réglages uniques pour la veille vocale, la lecture des réponses et la voix utilisée.
          Ils remplacent les boutons Appel ON/OFF du chat.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-white">
                <Mic className="h-5 w-5 text-cyan-300" />
                <h3 className="font-semibold">Veille vocale « Elynea »</h3>
              </div>
              <p className="mt-2 text-sm text-slate-400">
                Une fois activée, tu peux appeler Elynea par son nom pendant que tu travailles dans le Cockpit.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                État : {voiceStatus.status || "Prêt"}
                {voiceStatus.error ? " · " + voiceStatus.error : ""}
              </p>
            </div>
            <Toggle
              checked={prefs.handsFree}
              label="Activer la veille vocale Elynea"
              onClick={() => updatePrefs({ handsFree: !prefs.handsFree })}
            />
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-white">
                <Volume2 className="h-5 w-5 text-amber-300" />
                <h3 className="font-semibold">Réponses vocales</h3>
              </div>
              <p className="mt-2 text-sm text-slate-400">
                Elynea lit ses réponses à voix haute lorsque le dialogue vocal est actif.
              </p>
            </div>
            <Toggle
              checked={prefs.ttsEnabled}
              label="Activer les réponses vocales Elynea"
              onClick={() => updatePrefs({ ttsEnabled: !prefs.ttsEnabled })}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
        <label className="block text-sm font-medium text-white">Voix française d’Elynea</label>
        <p className="mt-1 text-xs text-slate-400">
          Cette voix sera utilisée pour les réponses vocales du Companion.
        </p>
        <select
          value={prefs.voiceName}
          onChange={(event) => updatePrefs({ voiceName: event.target.value })}
          className="mt-3 h-10 w-full max-w-md rounded-lg border border-slate-600 bg-slate-900 px-3 text-sm text-white"
        >
          <option value="">Automatique</option>
          {voices.map((voice) => (
            <option key={voice.name + "-" + voice.lang} value={voice.name}>
              {voice.name} · {voice.lang}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 text-sm text-slate-300">
        <MonitorCog className="mr-2 inline h-4 w-4 text-violet-300" />
        Sur Windows, Elynea doit fonctionner comme Companion du PC. Le chat du Cockpit conserve uniquement le micro manuel.
      </div>
    </div>
  );
}
