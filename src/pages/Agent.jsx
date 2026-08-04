import React, { useState, useRef, useEffect } from "react";
import { Bot, Check, Send, ShieldCheck, Trash2, User, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const SUGGESTIONS = [
  "Résume mes projets en cours",
  "Prépare un devis pour mon prochain client",
  "Montre-moi les factures en retard",
  "Crée une tâche urgente pour un projet",
];

export default function AgentPage() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Bonjour Julien 👋 Je suis ton agent IA personnel JS-Innov.IA. Je peux consulter tes clients, projets, tâches, leads et finances en temps réel. Que puis-je faire pour toi ?",
      ts: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg, ts: new Date() }]);
    setLoading(true);

    try {
      const res = await fetch('/api/assistant/chat', {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ message: msg }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.response || data.reply || data.message || "⚠️ Réponse vide", ts: new Date() }]);
        setConfirmation(data.confirmation || null);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `❌ Erreur : ${data.error || "Réponse invalide de l'agent"}`, ts: new Date(), error: true },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "❌ Impossible de joindre l'agent. Vérifiez votre connexion.", ts: new Date(), error: true },
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
      const res = await fetch('/api/assistant/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ token: confirmation.token })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action refusée');
      if (data.client_action) {
        const actionRes = await fetch(data.client_action.url, {
          method: data.client_action.method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(data.client_action.body || {})
        });
        const actionData = await actionRes.json().catch(() => ({}));
        await fetch('/api/assistant/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            token: data.completion_token,
            success: actionRes.ok,
            details: actionRes.ok ? 'Action exécutée par la route métier sécurisée' : (actionData.error || `HTTP ${actionRes.status}`)
          })
        });
        if (!actionRes.ok) throw new Error(actionData.error || 'Action métier non exécutée');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: '✅ Action exécutée et ajoutée au journal d’activité.', ts: new Date() }]);
      setConfirmation(null);
    } catch (error) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${error.message}`, ts: new Date(), error: true }]);
    } finally {
      setActionLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([
      {
        role: "assistant",
        content: "Conversation réinitialisée. Comment puis-je t'aider ?",
        ts: new Date(),
      },
    ]);
    setConfirmation(null);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-env(safe-area-inset-top))] sm:h-[calc(100vh-4rem)] max-h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/30 flex-shrink-0">
            <Bot className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold truncate" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Julien AI <span className="text-primary">Agent</span>
            </h1>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] sm:text-[11px] text-muted-foreground">En ligne · GPT-4o</span>
            </div>
          </div>
        </div>
        <button
          onClick={clearChat}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors px-3 py-1.5 rounded-lg hover:bg-destructive/10 shrink-0 min-h-[36px]"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Effacer</span>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4 overscroll-contain">
        {messages.map((msg, i) => (
          <div key={i} className={cn("flex gap-2 sm:gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
            {msg.role === "assistant" && (
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full gradient-primary flex items-center justify-center flex-shrink-0 shadow shadow-primary/20 mt-0.5">
                <img src="/logo.png" alt="" className="w-6 h-6 object-contain" />
              </div>
            )}
            <div className={cn("max-w-[80%] sm:max-w-[75%] space-y-1")}>
              <div
                className={cn(
                  "px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words",
                  msg.role === "user"
                    ? "bg-primary text-white rounded-tr-sm"
                    : msg.error
                    ? "bg-destructive/10 text-destructive border border-destructive/20 rounded-tl-sm"
                    : "bg-card border border-border text-foreground rounded-tl-sm shadow-sm"
                )}
              >
                {msg.content}
              </div>
              <p className={cn("text-[10px] text-muted-foreground", msg.role === "user" ? "text-right" : "")}>
                {format(msg.ts, "HH:mm", { locale: fr })}
              </p>
            </div>
            {msg.role === "user" && (
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-2 sm:gap-3 justify-start">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full gradient-primary flex items-center justify-center flex-shrink-0 shadow shadow-primary/20">
              <img src="/logo.png" alt="" className="w-6 h-6 object-contain" />
            </div>
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
                <button type="button" onClick={confirmAction} disabled={actionLoading} className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-50">
                  {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Confirmer
                </button>
                <button type="button" onClick={() => setConfirmation(null)} disabled={actionLoading} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs"><X className="h-3.5 w-3.5" /> Annuler</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Suggestions */}
      {messages.length === 1 && (
        <div className="px-3 sm:px-6 pb-2 sm:pb-3 flex gap-2 flex-wrap shrink-0">
          {SUGGESTIONS.map((s, i) => (
            <button
              key={i}
              onClick={() => send(s)}
              className="flex items-center gap-1.5 text-xs bg-muted hover:bg-primary/10 hover:text-primary border border-border hover:border-primary/30 text-muted-foreground px-3 py-1.5 rounded-xl transition-all duration-200"
            >
              <Sparkles className="w-3 h-3" />
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input — sticky en bas avec safe area */}
      <div className="px-3 sm:px-6 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2 shrink-0">
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="flex gap-2 sm:gap-3 bg-card border border-border rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm focus-within:border-primary/50 focus-within:shadow-md focus-within:shadow-primary/10 transition-all duration-200"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pose une question à ton agent IA..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-w-0"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="w-9 h-9 sm:w-8 sm:h-8 rounded-xl gradient-primary flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-all duration-200 shadow shadow-primary/30 flex-shrink-0"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            ) : (
              <Send className="w-4 h-4 text-white" />
            )}
          </button>
        </form>
        <p className="text-center text-[10px] text-muted-foreground mt-2 hidden sm:block">
          Agent IA · JS-Innov.IA · Données en temps réel via Supabase
        </p>
      </div>
    </div>
  );
}
