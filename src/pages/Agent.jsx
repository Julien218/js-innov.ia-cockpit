import React, { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Check, Send, ShieldCheck, Trash2, User, Loader2, Sparkles, X, Cpu, Cloud, Wifi, WifiOff, ChevronDown, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { shouldUseLocalFirst } from "@/lib/nova-routing";

const LOCAL_AGENT_URL = "http://127.0.0.1:8787";
const STORAGE_KEY = "jsinnovia_ai_provider";
const STORAGE_MODEL = "jsinnovia_ai_model";
const CONVERSATION_ID = "main";

const GREETING = "Bonjour Julien 👋 Je suis NOVA, l’assistante unique du Cockpit JS-Innov.IA. J’utilise le Cloud pour l’orchestration et les tâches complexes, et l’IA locale pour les outils Windows, les fichiers et le mode hors connexion.";

const SUGGESTIONS = [
  "Résume mes projets en cours",
  "Prépare un devis pour mon prochain client",
  "Montre-moi les factures en retard",
  "Crée une tâche urgente pour un projet",
];

const SYSTEM_PROMPT = `Tu es NOVA, l’unique assistante et architecte du Cockpit JS-Innov.IA.
Tu aides avec clients, projets, tâches, leads, devis, factures, automatisation, création web, branding et IA.
Conserve le contexte des messages précédents, notamment les références courtes comme « lui », « ajoute-le », « sur le net BCE ».
Avant de poser une question, exploite les données, outils et valeurs internes par défaut déjà disponibles. Ne transforme jamais une demande d’architecture en questionnaire générique.
Ne prétends jamais qu’une action est exécutée sans confirmation réelle. Réponds en français naturel de Belgique, précisément et sans jargon inutile.`;

function initialProvider() {
  const stored = localStorage.getItem(STORAGE_KEY);
  // Migration de l'ancien mode local bloquant vers le mode Companion automatique.
  if (!stored || stored === "local") return "auto";
  return ["auto", "cloud", "local"].includes(stored) ? stored : "auto";
}

function normalizeHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((item) => item?.role === "user" || item?.role === "assistant")
    .map((item) => ({
      role: item.role,
      content: String(item.content || ""),
      ts: item.created_at ? new Date(item.created_at) : new Date(),
    }))
    .filter((item) => item.content);
}

export default function AgentPage() {
  const [messages, setMessages] = useState([{ role: "assistant", content: GREETING, ts: new Date() }]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [provider, setProvider] = useState(initialProvider);
  const [agentModels, setAgentModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem(STORAGE_MODEL) || "");
  const [agentStatus, setAgentStatus] = useState("checking");
  const [activeEngine, setActiveEngine] = useState("cloud");
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const providerRef = useRef(null);
  const modelRef = useRef(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/assistant/history?conversation_id=${CONVERSATION_ID}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`Historique ${res.status}`);
      const data = await res.json();
      const restored = normalizeHistory(data.messages);
      setMessages(restored.length ? restored : [{ role: "assistant", content: GREETING, ts: new Date() }]);
    } catch {
      // Le chat reste utilisable même si la restauration est momentanément indisponible.
      setMessages((current) => current.length ? current : [{ role: "assistant", content: GREETING, ts: new Date() }]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const checkAgent = useCallback(async () => {
    setAgentStatus("checking");
    try {
      const res = await fetch(`${LOCAL_AGENT_URL}/health`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error("offline");
      try {
        const modelsRes = await fetch(`${LOCAL_AGENT_URL}/api/agent/models`, { signal: AbortSignal.timeout(3000) });
        if (modelsRes.ok) {
          const modelsData = await modelsRes.json();
          const rawModels = Array.isArray(modelsData) ? modelsData : (modelsData.models || modelsData.data || []);
          const names = rawModels.map((m) => typeof m === "string" ? m : (m.name || m.model || m.id)).filter(Boolean);
          setAgentModels(names);
          if (names.length && !selectedModel) {
            setSelectedModel(names[0]);
            localStorage.setItem(STORAGE_MODEL, names[0]);
          }
        }
      } catch {
        setAgentModels([]);
      }
      setAgentStatus("online");
    } catch {
      setAgentStatus("offline");
      setAgentModels([]);
    }
  }, [selectedModel]);

  useEffect(() => { loadHistory(); checkAgent(); }, [loadHistory, checkAgent]);

  useEffect(() => {
    const handler = (event) => {
      if (providerRef.current && !providerRef.current.contains(event.target)) setShowProviderMenu(false);
      if (modelRef.current && !modelRef.current.contains(event.target)) setShowModelMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const switchProvider = (next) => {
    setProvider(next);
    localStorage.setItem(STORAGE_KEY, next);
    setShowProviderMenu(false);
  };
  const switchModel = (model) => {
    setSelectedModel(model);
    localStorage.setItem(STORAGE_MODEL, model);
    setShowModelMenu(false);
  };

  const persistMessages = async (items) => {
    const res = await fetch('/api/assistant/history/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ conversation_id: CONVERSATION_ID, messages: items }),
    });
    if (!res.ok) throw new Error('Synchronisation mémoire indisponible');
  };

  const sendToLocal = async (msg) => {
    const history = messages.slice(-20).map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.content,
    }));
    const res = await fetch(`${LOCAL_AGENT_URL}/api/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: msg,
        model: selectedModel || undefined,
        history,
        system_prompt: SYSTEM_PROMPT,
        context: { source: "cockpit", user: "julien", conversation_id: CONVERSATION_ID },
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) throw new Error(`Agent Local ${res.status}`);
    const data = await res.json();
    const response = data.response || data.reply || data.message || data.content || data.text || "⚠️ Réponse vide de l'Agent Local";
    return { response, confirmation: data.confirmation || null };
  };

  const sendToCloud = async (msg) => {
    const res = await fetch('/api/assistant/chat', {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ message: msg, conversation_id: CONVERSATION_ID }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Réponse invalide du Companion");
    return { response: data.response || data.reply || data.message || "⚠️ Réponse vide", confirmation: data.confirmation || null };
  };

  const runCompanion = async (msg) => {
    if (provider === "cloud") {
      setActiveEngine("cloud");
      return sendToCloud(msg);
    }
    if (provider === "local") {
      if (agentStatus !== "online") throw new Error("Agent Local (8787) non accessible en mode Local uniquement");
      const result = await sendToLocal(msg);
      await persistMessages([{ role: 'user', content: msg }, { role: 'assistant', content: result.response }]);
      setActiveEngine("local");
      return result;
    }

    // Mode NOVA automatique : le Cloud orchestre les demandes métier/complexes.
    // Le local est prioritaire uniquement pour une opération locale explicite ou un échange très simple.
    if (shouldUseLocalFirst(msg, agentStatus === "online")) {
      try {
        const result = await sendToLocal(msg);
        await persistMessages([{ role: 'user', content: msg }, { role: 'assistant', content: result.response }]);
        setActiveEngine("local");
        return result;
      } catch {
        setAgentStatus("offline");
      }
    }
    setActiveEngine("cloud");
    return sendToCloud(msg);
  };

  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg, ts: new Date() }]);
    setLoading(true);
    try {
      const result = await runCompanion(msg);
      setMessages((prev) => [...prev, { role: "assistant", content: result.response, ts: new Date() }]);
      setConfirmation(result.confirmation || null);
    } catch (error) {
      setMessages((prev) => [...prev, { role: "assistant", content: `❌ ${error.message}`, ts: new Date(), error: true }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const confirmAction = async () => {
    if (!confirmation || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/assistant/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ token: confirmation.token }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Action refusée');
      if (data.client_action) {
        const actionRes = await fetch(data.client_action.url, { method: data.client_action.method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(data.client_action.body || {}) });
        const actionData = await actionRes.json().catch(() => ({}));
        await fetch('/api/assistant/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ token: data.completion_token, success: actionRes.ok, details: actionRes.ok ? 'Action exécutée' : (actionData.error || `HTTP ${actionRes.status}`) }) });
        if (!actionRes.ok) throw new Error(actionData.error || 'Action métier non exécutée');
      }
      const successMessage = '✅ Action réellement exécutée et ajoutée au journal.';
      setMessages((prev) => [...prev, { role: 'assistant', content: successMessage, ts: new Date() }]);
      persistMessages([{ role: 'assistant', content: successMessage }]).catch(() => {});
      setConfirmation(null);
    } catch (error) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${error.message}`, ts: new Date(), error: true }]);
    } finally {
      setActionLoading(false);
    }
  };

  const clearChat = async () => {
    try {
      await fetch(`/api/assistant/history?conversation_id=${CONVERSATION_ID}`, { method: 'DELETE', credentials: 'same-origin' });
    } finally {
      setMessages([{ role: "assistant", content: "Conversation réinitialisée. Je reste NOVA, ton assistante unique. Comment puis-je t’aider ?", ts: new Date() }]);
      setConfirmation(null);
    }
  };

  const providerBadge = provider === "auto"
    ? {
        icon: agentStatus === "online" ? <Wifi className="w-3 h-3 text-emerald-500" /> : <Cloud className="w-3 h-3 text-primary" />,
        label: agentStatus === "checking" ? "Companion · vérification…" : agentStatus === "online" ? `Companion · ${activeEngine === "local" ? "Local" : "Cloud"} · 8787 disponible` : "Companion · Cloud actif · Local indisponible",
        color: agentStatus === "online" ? "text-emerald-500" : "text-primary",
      }
    : provider === "local"
      ? {
          icon: agentStatus === "online" ? <Wifi className="w-3 h-3 text-emerald-500" /> : <WifiOff className="w-3 h-3 text-red-500" />,
          label: agentStatus === "checking" ? "Connexion…" : agentStatus === "online" ? `Local 8787${selectedModel ? " · " + selectedModel : ""}` : "Local 8787 offline",
          color: agentStatus === "online" ? "text-emerald-500" : "text-red-500",
        }
      : { icon: <Cloud className="w-3 h-3 text-primary" />, label: "Cloud · JS-Innov.IA", color: "text-primary" };

  const localControlsVisible = provider !== "cloud" && agentStatus === "online";

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-env(safe-area-inset-top))] sm:h-[calc(100vh-4rem)] max-h-[calc(100vh-3.5rem)]">
      <div className="flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/30 flex-shrink-0"><Bot className="w-4 h-4 sm:w-5 sm:h-5 text-white" /></div>
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold truncate" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Julien AI <span className="text-primary">Companion</span></h1>
            <div className="flex items-center gap-1.5">{providerBadge.icon}<span className={cn("text-[10px] sm:text-[11px]", providerBadge.color)}>{providerBadge.label}</span></div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative" ref={providerRef}>
            <button onClick={() => setShowProviderMenu(!showProviderMenu)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs font-medium hover:bg-accent transition-colors min-h-[36px]">
              {provider === "local" ? <Server className="w-3.5 h-3.5 text-emerald-500" /> : <Cloud className="w-3.5 h-3.5 text-primary" />}
              <span className="hidden sm:inline">{provider === "auto" ? "Companion" : provider === "local" ? "Local" : "Cloud"}</span>
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            </button>
            {showProviderMenu && (
              <div className="absolute right-0 top-full mt-1 w-64 rounded-xl border border-border bg-popover shadow-xl z-50 overflow-hidden">
                <button onClick={() => switchProvider("auto")} className={cn("w-full flex items-start gap-3 px-3 py-2.5 hover:bg-accent transition-colors text-left", provider === "auto" && "bg-accent/50")}>
                  <Bot className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div><div className="text-sm font-medium">Companion automatique</div><div className="text-[10px] text-muted-foreground">Cloud toujours disponible · Local utilisé automatiquement</div></div>
                </button>
                <button onClick={() => switchProvider("local")} className={cn("w-full flex items-start gap-3 px-3 py-2.5 hover:bg-accent transition-colors text-left border-t border-border", provider === "local" && "bg-accent/50")}>
                  <Server className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  <div><div className="text-sm font-medium">Local uniquement (8787)</div><div className="text-[10px] text-muted-foreground">Ollama + fichiers + outils du PC</div><div className={cn("text-[10px] mt-0.5", agentStatus === "online" ? "text-emerald-500" : "text-red-500")}>{agentStatus === "online" ? "✓ Connecté" : "✗ Hors ligne"}</div></div>
                </button>
                <button onClick={() => switchProvider("cloud")} className={cn("w-full flex items-start gap-3 px-3 py-2.5 hover:bg-accent transition-colors text-left border-t border-border", provider === "cloud" && "bg-accent/50")}>
                  <Cloud className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div><div className="text-sm font-medium">Cloud uniquement</div><div className="text-[10px] text-muted-foreground">Backend Railway · mémoire persistante · recherche web</div></div>
                </button>
              </div>
            )}
          </div>

          {localControlsVisible && agentModels.length > 0 && (
            <div className="relative" ref={modelRef}>
              <button onClick={() => setShowModelMenu(!showModelMenu)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs font-medium hover:bg-accent transition-colors max-w-[140px] min-h-[36px]">
                <span className="truncate">{selectedModel || "Modèle"}</span><ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
              </button>
              {showModelMenu && (
                <div className="absolute right-0 top-full mt-1 w-56 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover shadow-xl z-50">
                  {agentModels.map((model) => (
                    <button key={model} onClick={() => switchModel(model)} className={cn("w-full flex items-center gap-2 px-3 py-2 hover:bg-accent transition-colors text-left text-sm", model === selectedModel && "bg-accent/50")}>
                      <Cpu className="w-3.5 h-3.5 text-emerald-500 shrink-0" /><span className="truncate">{model}</span>{model === selectedModel && <Check className="w-3.5 h-3.5 text-emerald-500 ml-auto shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {provider !== "cloud" && (
            <button onClick={checkAgent} className="p-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors min-h-[36px]" title="Vérifier l'Agent Local">
              <Loader2 className={cn("w-3.5 h-3.5 text-muted-foreground", agentStatus === "checking" && "animate-spin")} />
            </button>
          )}
          <button onClick={clearChat} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors px-3 py-1.5 rounded-lg hover:bg-destructive/10 shrink-0 min-h-[36px]"><Trash2 className="w-3.5 h-3.5" /><span className="hidden sm:inline">Effacer</span></button>
        </div>
      </div>

      {provider === "auto" && agentStatus === "offline" && (
        <div className="mx-3 sm:mx-6 mt-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-muted-foreground">
          <strong className="text-foreground">Cloud actif.</strong> L’Agent Local 8787 n’est pas détecté, mais le Companion continue normalement. Il réutilisera automatiquement le Local dès qu’il sera disponible.
        </div>
      )}
      {provider === "local" && agentStatus === "offline" && (
        <div className="mx-3 sm:mx-6 mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600 dark:text-amber-400">
          <strong>Mode Local uniquement : Agent 8787 non détecté.</strong> Lance l’Agent Local sur <code className="px-1 py-0.5 rounded bg-amber-500/20">127.0.0.1:8787</code> ou repasse en mode Companion automatique.
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4 overscroll-contain">
        {historyLoading && messages.length <= 1 && <div className="text-center text-xs text-muted-foreground py-2">Restauration de la mémoire…</div>}
        {messages.map((msg, index) => (
          <div key={`${msg.role}-${index}-${msg.ts?.getTime?.() || index}`} className={cn("flex gap-2 sm:gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
            {msg.role === "assistant" && <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full gradient-primary flex items-center justify-center flex-shrink-0 shadow shadow-primary/20 mt-0.5"><img src="/logo.png" alt="" className="w-6 h-6 object-contain" /></div>}
            <div className="max-w-[80%] sm:max-w-[75%] space-y-1">
              <div className={cn("px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words", msg.role === "user" ? "bg-primary text-white rounded-tr-sm" : msg.error ? "bg-destructive/10 text-destructive border border-destructive/20 rounded-tl-sm" : "bg-card border border-border text-foreground rounded-tl-sm shadow-sm")}>{msg.content}</div>
              <p className={cn("text-[10px] text-muted-foreground", msg.role === "user" ? "text-right" : "")}>{format(msg.ts || new Date(), "HH:mm", { locale: fr })}</p>
            </div>
            {msg.role === "user" && <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5"><User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground" /></div>}
          </div>
        ))}
        {loading && (
          <div className="flex gap-2 sm:gap-3 justify-start">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full gradient-primary flex items-center justify-center flex-shrink-0 shadow shadow-primary/20"><img src="/logo.png" alt="" className="w-6 h-6 object-contain" /></div>
            <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm"><div className="flex gap-1.5 items-center"><div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" /><div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce [animation-delay:150ms]" /><div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce [animation-delay:300ms]" /></div></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {confirmation && (
        <div className="mx-3 sm:mx-6 mb-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4" role="alert">
          <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" /><div className="flex-1"><p className="text-sm font-semibold">Confirmation obligatoire</p><p className="mt-1 text-xs text-muted-foreground">{confirmation.summary}</p><div className="mt-3 flex gap-2"><button type="button" onClick={confirmAction} disabled={actionLoading} className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-50">{actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Confirmer</button><button type="button" onClick={() => setConfirmation(null)} disabled={actionLoading} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs"><X className="h-3.5 w-3.5" /> Annuler</button></div></div></div>
        </div>
      )}

      {messages.length === 1 && !historyLoading && (
        <div className="px-3 sm:px-6 pb-2 flex flex-wrap gap-2">{SUGGESTIONS.map((suggestion) => <button key={suggestion} onClick={() => send(suggestion)} disabled={loading} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border bg-card hover:bg-accent hover:border-primary/30 transition-colors disabled:opacity-50"><Sparkles className="w-3 h-3 text-primary" />{suggestion}</button>)}</div>
      )}

      <div className="px-3 sm:px-6 py-3 border-t border-border bg-card shrink-0 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <form onSubmit={(event) => { event.preventDefault(); send(); }} className="flex gap-2 items-end">
          <input ref={inputRef} type="text" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Écrire à NOVA…" disabled={loading} className="flex-1 bg-background border border-border rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 disabled:opacity-50" />
          <button type="submit" disabled={loading || !input.trim()} className="rounded-2xl gradient-primary p-2.5 text-white disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0">{loading ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Send className="w-4 h-4 text-white" />}</button>
        </form>
        <p className="text-center text-[10px] text-muted-foreground mt-2 hidden sm:block">Mémoire persistante · Cloud JS-Innov.IA · Agent Local 8787 optionnel · actions sensibles confirmées</p>
      </div>
    </div>
  );
}
