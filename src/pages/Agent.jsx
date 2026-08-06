import React, { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Check, Send, ShieldCheck, Trash2, User, Loader2, Sparkles, X, Cpu, Cloud, Wifi, WifiOff, ChevronDown, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

// ── Agent Local JS-Innov.IA (port 8787) ─────────────────────────────
// Le cockpit parle à l'Agent Local, PAS directement à Ollama.
// L'Agent Local gère lui-même: Ollama, fichiers, outils, mémoire, actions.
const LOCAL_AGENT_URL = "http://127.0.0.1:8787";
const STORAGE_KEY = "jsinnovia_ai_provider";
const STORAGE_MODEL = "jsinnovia_ai_model";

const SUGGESTIONS = [
  "Résume mes projets en cours",
  "Prépare un devis pour mon prochain client",
  "Montre-moi les factures en retard",
  "Crée une tâche urgente pour un projet",
];

const SYSTEM_PROMPT = `Tu es l'assistant IA personnel de Julien Pagin, fondateur de JS-Innov.IA (www.jsinnovia.com), basé à Dour, Belgique.
Tu aides avec: clients, projets, tâches, leads, devis, factures, automatisation, création web, branding, IA.
Sois précis, professionnel, chaleureux et direct. Réponds en français.
Tu as accès aux données du cockpit (clients, projets, tâches, finances) via les actions disponibles.
Propose des actions concrètes quand c'est pertinent.`;

export default function AgentPage() {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Bonjour Julien 👋 Je suis ton agent IA JS-Innov.IA. Je passe par ton Agent Local (8787) qui gère Ollama, les fichiers et les outils. Pose ta question.", ts: new Date() },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [provider, setProvider] = useState(() => localStorage.getItem(STORAGE_KEY) || "local");
  const [agentModels, setAgentModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem(STORAGE_MODEL) || "");
  const [agentStatus, setAgentStatus] = useState("checking"); // checking | online | offline
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const providerRef = useRef(null);
  const modelRef = useRef(null);

  // ── Vérifier l'Agent Local au montage ──
  const checkAgent = useCallback(async () => {
    setAgentStatus("checking");
    try {
      const res = await fetch(`${LOCAL_AGENT_URL}/health`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        // L'agent est en ligne — essayer de récupérer les modèles
        try {
          const modelsRes = await fetch(`${LOCAL_AGENT_URL}/api/agent/models`, { signal: AbortSignal.timeout(3000) });
          if (modelsRes.ok) {
            const modelsData = await modelsRes.json();
            // Format flexible: { models: [...] } ou [ ... ] ou { models: [{name}] }
            const rawModels = Array.isArray(modelsData) ? modelsData
              : (modelsData.models || modelsData.data || []);
            const modelNames = rawModels.map(m => typeof m === "string" ? m : (m.name || m.model || m.id)).filter(Boolean);
            setAgentModels(modelNames);
            if (modelNames.length > 0 && !selectedModel) {
              setSelectedModel(modelNames[0]);
              localStorage.setItem(STORAGE_MODEL, modelNames[0]);
            }
          }
        } catch {
          // L'agent n'expose pas /api/agent/models — ce n'est pas bloquant
          setAgentModels([]);
        }
        setAgentStatus("online");
      } else {
        setAgentStatus("offline");
      }
    } catch {
      setAgentStatus("offline");
    }
  }, [selectedModel]);

  useEffect(() => { checkAgent(); }, [checkAgent]);

  useEffect(() => {
    const handler = (e) => {
      if (providerRef.current && !providerRef.current.contains(e.target)) setShowProviderMenu(false);
      if (modelRef.current && !modelRef.current.contains(e.target)) setShowModelMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const switchProvider = (p) => { setProvider(p); localStorage.setItem(STORAGE_KEY, p); setShowProviderMenu(false); };
  const switchModel = (m) => { setSelectedModel(m); localStorage.setItem(STORAGE_MODEL, m); setShowModelMenu(false); };

  // ── Envoyer à l'Agent Local (8787) ──
  const sendToLocal = async (msg) => {
    const history = messages.slice(-8).map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

    const res = await fetch(`${LOCAL_AGENT_URL}/api/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: msg,
        model: selectedModel || undefined,
        history,
        system_prompt: SYSTEM_PROMPT,
        context: { source: "cockpit", user: "julien" },
      }),
      signal: AbortSignal.timeout(90000),
    });

    if (!res.ok) throw new Error(`Agent Local ${res.status}`);

    const data = await res.json();
    // Format flexible: { response } ou { reply } ou { message } ou { content }
    const response = data.response || data.reply || data.message || data.content || data.text || "⚠️ Réponse vide de l'agent local";
    return { response, confirmation: data.confirmation || null };
  };

  // ── Envoyer au backend cloud ──
  const sendToCloud = async (msg) => {
    const res = await fetch('/api/assistant/chat', {
      method: "POST", headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ message: msg }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Réponse invalide de l'agent");
    return { response: data.response || data.reply || data.message || "⚠️ Réponse vide", confirmation: data.confirmation || null };
  };

  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    if (provider === "local" && agentStatus !== "online") {
      setMessages((prev) => [...prev,
        { role: "user", content: msg, ts: new Date() },
        { role: "assistant", content: "❌ Agent Local (8787) non accessible. Lance l'agent sur ton PC ou bascule en mode Cloud.", ts: new Date(), error: true },
      ]);
      return;
    }
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg, ts: new Date() }]);
    setLoading(true);
    try {
      const result = provider === "local" ? await sendToLocal(msg) : await sendToCloud(msg);
      setMessages((prev) => [...prev, { role: "assistant", content: result.response, ts: new Date() }]);
      setConfirmation(result.confirmation || null);
    } catch (error) {
      setMessages((prev) => [...prev,
        { role: "assistant", content: `❌ ${error.message}${provider === "local" ? " — Vérifie que l'Agent Local tourne sur 127.0.0.1:8787" : ""}`, ts: new Date(), error: true },
      ]);
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action refusée');
      if (data.client_action) {
        const actionRes = await fetch(data.client_action.url, { method: data.client_action.method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(data.client_action.body || {}) });
        const actionData = await actionRes.json().catch(() => ({}));
        await fetch('/api/assistant/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ token: data.completion_token, success: actionRes.ok, details: actionRes.ok ? 'Action exécutée' : (actionData.error || `HTTP ${actionRes.status}`) }) });
        if (!actionRes.ok) throw new Error(actionData.error || 'Action métier non exécutée');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: '✅ Action exécutée et ajoutée au journal.', ts: new Date() }]);
      setConfirmation(null);
    } catch (error) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${error.message}`, ts: new Date(), error: true }]);
    } finally { setActionLoading(false); }
  };

  const clearChat = () => { setMessages([{ role: "assistant", content: "Conversation réinitialisée. Comment puis-je t'aider ?", ts: new Date() }]); setConfirmation(null); };

  const providerBadge = provider === "local" ? {
    icon: agentStatus === "online" ? <Wifi className="w-3 h-3 text-emerald-500" /> : <WifiOff className="w-3 h-3 text-red-500" />,
    label: agentStatus === "checking" ? "Connexion…" : agentStatus === "online" ? `Agent 8787${selectedModel ? " · " + selectedModel : ""}` : "Agent 8787 offline",
    color: agentStatus === "online" ? "text-emerald-500" : "text-red-500",
  } : { icon: <Cloud className="w-3 h-3 text-primary" />, label: "Cloud · JS-Innov.IA", color: "text-primary" };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-env(safe-area-inset-top))] sm:h-[calc(100vh-4rem)] max-h-[calc(100vh-3.5rem)]">
      <div className="flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/30 flex-shrink-0"><Bot className="w-4 h-4 sm:w-5 sm:h-5 text-white" /></div>
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold truncate" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Julien AI <span className="text-primary">Agent</span></h1>
            <div className="flex items-center gap-1.5">{providerBadge.icon}<span className={cn("text-[10px] sm:text-[11px]", providerBadge.color)}>{providerBadge.label}</span></div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative" ref={providerRef}>
            <button onClick={() => setShowProviderMenu(!showProviderMenu)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs font-medium hover:bg-accent transition-colors min-h-[36px]">
              {provider === "local" ? <Server className="w-3.5 h-3.5 text-emerald-500" /> : <Cloud className="w-3.5 h-3.5 text-primary" />}
              <span className="hidden sm:inline">{provider === "local" ? "Agent Local" : "Cloud"}</span>
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            </button>
            {showProviderMenu && (
              <div className="absolute right-0 top-full mt-1 w-60 rounded-xl border border-border bg-popover shadow-xl z-50 overflow-hidden">
                <button onClick={() => switchProvider("local")} className={cn("w-full flex items-start gap-3 px-3 py-2.5 hover:bg-accent transition-colors text-left", provider === "local" && "bg-accent/50")}>
                  <Server className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium">Agent Local (8787)</div>
                    <div className="text-[10px] text-muted-foreground">127.0.0.1:8787 · Ollama + fichiers + outils</div>
                    <div className={cn("text-[10px] mt-0.5", agentStatus === "online" ? "text-emerald-500" : "text-red-500")}>
                      {agentStatus === "online" ? `✓ Connecté${agentModels.length > 0 ? " · " + agentModels.length + " modèle(s)" : ""}` : agentStatus === "checking" ? "…" : "✗ Hors ligne — lance l'agent 8787"}
                    </div>
                  </div>
                </button>
                <button onClick={() => switchProvider("cloud")} className={cn("w-full flex items-start gap-3 px-3 py-2.5 hover:bg-accent transition-colors text-left border-t border-border", provider === "cloud" && "bg-accent/50")}>
                  <Cloud className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium">Cloud (JS-Innov.IA)</div>
                    <div className="text-[10px] text-muted-foreground">Backend Railway · cockpit.jsinnovia.com</div>
                  </div>
                </button>
              </div>
            )}
          </div>
          {provider === "local" && agentStatus === "online" && agentModels.length > 0 && (
            <div className="relative" ref={modelRef}>
              <button onClick={() => setShowModelMenu(!showModelMenu)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs font-medium hover:bg-accent transition-colors max-w-[140px] min-h-[36px]">
                <span className="truncate">{selectedModel || "Modèle"}</span><ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
              </button>
              {showModelMenu && (
                <div className="absolute right-0 top-full mt-1 w-56 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover shadow-xl z-50">
                  {agentModels.map(m => (
                    <button key={m} onClick={() => switchModel(m)} className={cn("w-full flex items-center gap-2 px-3 py-2 hover:bg-accent transition-colors text-left text-sm", m === selectedModel && "bg-accent/50")}>
                      <Cpu className="w-3.5 h-3.5 text-emerald-500 shrink-0" /><span className="truncate">{m}</span>{m === selectedModel && <Check className="w-3.5 h-3.5 text-emerald-500 ml-auto shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {provider === "local" && (
            <button onClick={checkAgent} className="p-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors min-h-[36px]" title="Reconnecter l'Agent Local">
              <Loader2 className={cn("w-3.5 h-3.5 text-muted-foreground", agentStatus === "checking" && "animate-spin")} />
            </button>
          )}
          <button onClick={clearChat} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors px-3 py-1.5 rounded-lg hover:bg-destructive/10 shrink-0 min-h-[36px]"><Trash2 className="w-3.5 h-3.5" /><span className="hidden sm:inline">Effacer</span></button>
        </div>
      </div>

      {provider === "local" && agentStatus === "offline" && (
        <div className="mx-3 sm:mx-6 mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600 dark:text-amber-400">
          <strong>Agent Local (8787) non détecté.</strong> Lance ton Agent Local JS-Innov.IA sur <code className="px-1 py-0.5 rounded bg-amber-500/20">127.0.0.1:8787</code>, puis clique sur le bouton refresh. L'agent gère Ollama, les fichiers et les outils — le cockpit ne se connecte plus directement à Ollama.
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4 overscroll-contain">
        {messages.map((msg, i) => (
          <div key={i} className={cn("flex gap-2 sm:gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
            {msg.role === "assistant" && (
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full gradient-primary flex items-center justify-center flex-shrink-0 shadow shadow-primary/20 mt-0.5"><img src="/logo.png" alt="" className="w-6 h-6 object-contain" /></div>
            )}
            <div className={cn("max-w-[80%] sm:max-w-[75%] space-y-1")}>
              <div className={cn("px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words", msg.role === "user" ? "bg-primary text-white rounded-tr-sm" : msg.error ? "bg-destructive/10 text-destructive border border-destructive/20 rounded-tl-sm" : "bg-card border border-border text-foreground rounded-tl-sm shadow-sm")}>{msg.content}</div>
              <p className={cn("text-[10px] text-muted-foreground", msg.role === "user" ? "text-right" : "")}>{format(msg.ts, "HH:mm", { locale: fr })}</p>
            </div>
            {msg.role === "user" && (
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5"><User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground" /></div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex gap-2 sm:gap-3 justify-start">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full gradient-primary flex items-center justify-center flex-shrink-0 shadow shadow-primary/20"><img src="/logo.png" alt="" className="w-6 h-6 object-contain" /></div>
            <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm">
              <div className="flex gap-1.5 items-center">
                <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" />
                <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce [animation-delay:150ms]" />
                <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {confirmation && (
        <div className="mx-3 sm:mx-6 mb-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4" role="alert">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div className="flex-1">
              <p className="text-sm font-semibold">Confirmation obligatoire</p>
              <p className="mt-1 text-xs text-muted-foreground">{confirmation.summary}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={confirmAction} disabled={actionLoading} className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-50">{actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Confirmer</button>
                <button type="button" onClick={() => setConfirmation(null)} disabled={actionLoading} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs"><X className="h-3.5 w-3.5" /> Annuler</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {messages.length === 1 && (
        <div className="px-3 sm:px-6 pb-2 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)} disabled={loading} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border bg-card hover:bg-accent hover:border-primary/30 transition-colors disabled:opacity-50"><Sparkles className="w-3 h-3 text-primary" />{s}</button>
          ))}
        </div>
      )}

      <div className="px-3 sm:px-6 py-3 border-t border-border bg-card shrink-0 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 items-end">
          <input ref={inputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder={provider === "local" ? `Écrire à l'Agent Local${selectedModel ? " (" + selectedModel + ")" : ""}…` : "Écrire à l'agent cloud…"} disabled={loading} className="flex-1 bg-background border border-border rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 disabled:opacity-50" />
          <button type="submit" disabled={loading || !input.trim()} className="rounded-2xl gradient-primary p-2.5 text-white disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0">{loading ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Send className="w-4 h-4 text-white" />}</button>
        </form>
        <p className="text-center text-[10px] text-muted-foreground mt-2 hidden sm:block">{provider === "local" ? `Agent Local · 127.0.0.1:8787 · Ollama + fichiers + outils${selectedModel ? " · " + selectedModel : ""}` : "Agent IA · JS-Innov.IA · Données via Supabase"}</p>
      </div>
    </div>
  );
}
