/**
 * Elynea — assistante clientèle de JS-Innov.IA intégrée à Signelya.
 *
 * Le widget reste compact sur mobile, connaît le contexte Signelya et conserve
 * les fonctions de conversation, dictée et lecture vocale du cockpit.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, RefreshCw, Send, Square, Volume2, VolumeX, X } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
const elyneaAvatar = "https://www.jsinnovia.com/brand/companion/companion-avatar-256.webp";

const MESSAGE_STORAGE_KEY = "elynea_signelya_messages_v2";
const CONVERSATION_STORAGE_KEY = "elynea_signelya_conversation_id_v2";
const TTS_STORAGE_KEY = "elynea_signelya_tts_enabled";
const MANAGED_CLIENT_KEY = "jsinnovia-managed-client";

const compactSignelyaContext = async user => {
  const isAdmin = ["admin", "superadmin"].includes(user?.role);
  const managedClient = isAdmin ? (localStorage.getItem(MANAGED_CLIENT_KEY) || "") : "";
  const headers = managedClient ? { "X-Client-Email": managedClient } : {};
  const response = await fetch("/api/signage/manage/dashboard", { credentials: "same-origin", headers });
  if (!response.ok) throw new Error("Données Signelya indisponibles");
  const data = await response.json();
  const players = Array.isArray(data.players) ? data.players : [];
  const player = [...players].sort((a, b) => new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0))[0] || null;
  let schedule = null;

  if (player?.id) {
    const scheduleResponse = await fetch(`/api/signage/manage/players/${encodeURIComponent(player.id)}/schedule`, {
      credentials: "same-origin",
      headers,
    });
    if (scheduleResponse.ok) schedule = await scheduleResponse.json();
  }

  return {
    capturedAt: new Date().toISOString(),
    timezone: "Europe/Brussels",
    managedClient: managedClient || user?.email || "client connecté",
    player: player ? { name: player.name, status: player.status, lastSeenAt: player.last_seen_at, resolution: player.resolution } : null,
    schedule: schedule ? {
      configured: Boolean(schedule.settings?.configured),
      blockBelgianHolidays: schedule.settings?.block_belgian_holidays !== false,
      ranges: (schedule.ranges || []).slice(0, 30).map(item => ({
        dayOfWeek: Number(item.day_of_week),
        start: String(item.start_time || "").slice(0, 5),
        end: String(item.end_time || "").slice(0, 5),
      })),
      exceptions: (schedule.exceptions || []).slice(0, 12).map(item => ({
        date: item.exception_date,
        mode: item.mode,
        ranges: item.ranges || [],
      })),
    } : null,
    playlists: (data.playlists || []).slice(0, 20).map(item => ({
      id: item.id,
      name: item.name || item.nom || "Programme sans nom",
      mediaCount: Array.isArray(item.items) ? item.items.length : 0,
    })),
    publications: (data.publications || []).slice(0, 20).map(item => ({
      status: item.status,
      scheduledAt: item.scheduled_at || item.created_at,
      playlistId: item.playlist_id || item.playlistId,
      recurrence: item.recurrence?.type || item.recurrence || "none",
    })),
  };
};

const displayFirstName = user => {
  const source = user?.first_name || user?.prenom || user?.full_name || user?.name || user?.email?.split("@")[0] || "";
  const first = String(source).trim().split(/[\s._-]+/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
};

export default function FloatingAgent() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem(MESSAGE_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId] = useState(() => {
    const existing = localStorage.getItem(CONVERSATION_STORAGE_KEY);
    if (existing) return existing;
    const created = "elynea-signelya-v2";
    localStorage.setItem(CONVERSATION_STORAGE_KEY, created);
    return created;
  });
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(() => localStorage.getItem(TTS_STORAGE_KEY) === "true");
  const [speaking, setSpeaking] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const sendRef = useRef(null);

  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const sttSupported = typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);
  const firstName = displayFirstName(user);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 120);
    const closeOnEscape = event => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(MESSAGE_STORAGE_KEY, JSON.stringify(messages.slice(-50)));
    } catch {}
  }, [messages]);

  useEffect(() => {
    localStorage.setItem(TTS_STORAGE_KEY, String(ttsEnabled));
  }, [ttsEnabled]);

  useEffect(() => {
    if (ttsSupported) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
    return () => {
      if (ttsSupported) window.speechSynthesis.cancel();
    };
  }, [ttsSupported]);

  const stopSpeaking = useCallback(() => {
    if (!ttsSupported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [ttsSupported]);

  const speak = useCallback(text => {
    if (!ttsSupported || !ttsEnabled || !text) return;
    const cleanText = text
      .replace(/\[Contexte Dropbox[^\]]*\]/gi, "")
      .replace(/[#*_~\x60]/g, "")
      .replace(/⚠️/g, "")
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, " ")
      .slice(0, 500);

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = "fr-FR";
    utterance.rate = 1.05;
    utterance.pitch = 1;
    const frenchVoice = window.speechSynthesis.getVoices().find(voice => voice.lang.startsWith("fr"));
    if (frenchVoice) utterance.voice = frenchVoice;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [ttsEnabled, ttsSupported]);

  const doSend = useCallback(async text => {
    const message = (text || input).trim();
    if (!message || loading) return;

    setInput("");
    stopSpeaking();
    setMessages(current => [...current, { role: "user", content: message, ts: Date.now() }]);
    setLoading(true);

    try {
      let signelyaContext = null;
      try {
        signelyaContext = await compactSignelyaContext(user);
      } catch {}
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message,
          conversation_id: conversationId,
          surface: "signelya",
          signelya_context: signelyaContext,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Elynea est momentanément indisponible.");
      }

      const data = await response.json();
      let content = data.message || data.response || data.reply || "Réponse vide";
      if (data.confirmation) {
        content += "\n\n⚠️ Action proposée : " + (data.confirmation.type || "action") + ". Confirmez pour l’exécuter.";
      }
      setMessages(current => [...current, { role: "assistant", content, ts: Date.now() }]);
      speak(content);
    } catch (error) {
      setMessages(current => [...current, {
        role: "assistant",
        content: "⚠️ " + error.message,
        ts: Date.now(),
        isError: true,
      }]);
    } finally {
      setLoading(false);
    }
  }, [conversationId, input, loading, speak, stopSpeaking, user]);

  useEffect(() => {
    sendRef.current = doSend;
  }, [doSend]);

  const startListening = useCallback(() => {
    if (!sttSupported) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    let finalTranscript = "";
    recognition.onresult = event => {
      let interimTranscript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0].transcript;
        if (event.results[index].isFinal) finalTranscript += transcript;
        else interimTranscript += transcript;
      }
      setInput(finalTranscript + interimTranscript);
    };
    recognition.onend = () => {
      setIsListening(false);
      const completed = finalTranscript.trim();
      if (completed) {
        setInput(completed);
        window.setTimeout(() => sendRef.current?.(completed), 100);
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.start();
    setIsListening(true);
  }, [sttSupported]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const resetConversation = useCallback(async () => {
    stopSpeaking();
    setMessages([]);
    localStorage.removeItem(MESSAGE_STORAGE_KEY);
    try {
      await fetch("/api/assistant/history?conversation_id=" + encodeURIComponent(conversationId), {
        method: "DELETE",
        credentials: "include",
      });
    } catch {}
  }, [conversationId, stopSpeaking]);

  const toggleTts = () => {
    if (ttsEnabled) stopSpeaking();
    setTtsEnabled(current => !current);
  };

  const close = () => {
    stopSpeaking();
    stopListening();
    setIsOpen(false);
  };

  const statusColor = speaking ? "#F6D66B" : isListening ? "#00D4FF" : loading ? "#F59E0B" : "#22C55E";
  const statusText = speaking ? "Elynea vous répond" : isListening ? "Elynea vous écoute" : loading ? "Elynea prépare sa réponse" : "Disponible";

  if (!user) return null;

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          className="elynea-launcher"
          onClick={() => setIsOpen(true)}
          title="Ouvrir Elynea"
          aria-label="Ouvrir Elynea, assistante clientèle JS-Innov.IA"
        >
          <img src={elyneaAvatar} alt="" />
          <span aria-hidden="true" />
        </button>
      )}

      {isOpen && (
        <section className="elynea-panel" role="dialog" aria-label="Conversation avec Elynea">
          <header className="elynea-header">
            <div className="elynea-identity">
              <div className="elynea-avatar">
                <img src={elyneaAvatar} alt="" />
                <span style={{ background: statusColor }} aria-hidden="true" />
              </div>
              <div className="elynea-heading">
                <div className="elynea-title-line">
                  <strong>Elynea</strong>
                  <span className="elynea-service">
                    <img src="/signelya-symbol-approved-512.png" alt="" />
                    Signelya
                  </span>
                </div>
                <p>Assistante clientèle de JS‑Innov.IA</p>
                <small><i style={{ background: statusColor }} />{statusText}</small>
              </div>
            </div>
            <div className="elynea-actions">
              <button type="button" onClick={toggleTts} title={ttsEnabled ? "Désactiver la lecture vocale" : "Activer la lecture vocale"} aria-label={ttsEnabled ? "Désactiver la lecture vocale" : "Activer la lecture vocale"}>
                {ttsEnabled ? <Volume2 /> : <VolumeX />}
              </button>
              <button type="button" onClick={resetConversation} title="Nouvelle conversation" aria-label="Nouvelle conversation"><RefreshCw /></button>
              <button type="button" onClick={close} title="Fermer" aria-label="Fermer Elynea"><X /></button>
            </div>
          </header>

          <div className="elynea-messages" aria-live="polite">
            {messages.length === 0 && !loading && (
              <div className="elynea-welcome">
                <img src={elyneaAvatar} alt="" />
                <p className="elynea-welcome-title">Bonjour{firstName ? " " + firstName : ""}, je suis Elynea.</p>
                <p>
                  L’assistante de JS‑Innov.IA intégrée à Signelya. Je vous accompagne pour préparer,
                  programmer et suivre vos diffusions sur écran géant.
                </p>
                <div className="elynea-capabilities" aria-label="Questions rapides">
                  <button type="button" onClick={() => doSend("Montrez-moi mes programmes enregistrés.")}>Programmes</button>
                  <button type="button" onClick={() => doSend("Quelles sont les prochaines diffusions programmées ?")}>Diffusions</button>
                  <button type="button" onClick={() => doSend("Quels sont les horaires actuels de mon écran ?")}>Horaires écran</button>
                </div>
              </div>
            )}

            {messages.map((message, index) => (
              <div
                key={(message.ts || index) + "-" + index}
                className={"elynea-message " + (message.role === "user" ? "is-user" : "is-assistant") + (message.isError ? " is-error" : "")}
              >
                {message.role === "assistant" && <span className="elynea-message-author">Elynea</span>}
                {message.content}
              </div>
            ))}

            {loading && <div className="elynea-thinking"><span /> Elynea prépare votre réponse…</div>}
            <div ref={messagesEndRef} />
          </div>

          <footer className="elynea-composer">
            {sttSupported && (
              <button
                type="button"
                className={"elynea-mic" + (isListening ? " is-listening" : "")}
                onClick={isListening ? stopListening : startListening}
                title={isListening ? "Arrêter l’écoute" : "Parler à Elynea"}
                aria-label={isListening ? "Arrêter l’écoute" : "Parler à Elynea"}
                disabled={loading}
              >
                {isListening ? <Square /> : <Mic />}
              </button>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  doSend();
                }
              }}
              placeholder={isListening ? "Je vous écoute…" : "Écrivez à Elynea…"}
              aria-label="Message pour Elynea"
              rows={1}
              disabled={loading || isListening}
            />
            <button
              type="button"
              className="elynea-send"
              onClick={() => doSend()}
              disabled={loading || !input.trim()}
              aria-label="Envoyer le message"
            >
              <Send />
            </button>
          </footer>
        </section>
      )}
    </>
  );
}
