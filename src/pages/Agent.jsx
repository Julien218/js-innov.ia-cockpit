import React, { useState, useRef, useEffect } from "react";
import { Bot, Send, Trash2, Zap, User, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const AGENT_URL = "https://jsinnovia-agent-production.up.railway.app";
const AGENT_KEY = import.meta.env.VITE_AGENT_KEY || "julien-ai-secret-key-change-me"; // Fallback si var env absente

const SESSION_ID = `julien-${Date.now()}`;

const SUGGESTIONS = [
  "Résume mes projets en cours",
  "Quels leads sont en attente ?",
  "Montre-moi les tâches urgentes",
  "Quel est mon chiffre d'affaires ce mois ?",
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
      const res = await fetch(`${AGENT_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agent-key": AGENT_KEY,
        },
        body: JSON.stringify({ message: msg, session_id: SESSION_ID }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.response || data.reply || data.message || "⚠️ Réponse vide", ts: new Date() }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `❌ Erreur : ${data.error || "Réponse invalide de l'agent"}`, ts: new Date(), error: true },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "❌ Impossible de joindre l'agent. Vérifiez votre connexion.", ts: new Date(), error: true },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
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
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/30">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Julien AI <span className="text-primary">Agent</span>
            </h1>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[11px] text-muted-foreground">En ligne · GPT-4o</span>
            </div>
          </div>
        </div>
        <button
          onClick={clearChat}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors px-3 py-1.5 rounded-lg hover:bg-destructive/10"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Effacer
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
            {msg.role === "assistant" && (
              <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center flex-shrink-0 shadow shadow-primary/20 mt-0.5">
                <Zap className="w-4 h-4 text-white" />
              </div>
            )}
            <div className={cn("max-w-[75%] space-y-1")}>
              <div
                className={cn(
                  "px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap",
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
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center flex-shrink-0 shadow shadow-primary/20">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
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

      {/* Suggestions */}
      {messages.length === 1 && (
        <div className="px-6 pb-3 flex gap-2 flex-wrap shrink-0">
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

      {/* Input */}
      <div className="px-6 pb-6 pt-2 shrink-0">
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="flex gap-3 bg-card border border-border rounded-2xl px-4 py-3 shadow-sm focus-within:border-primary/50 focus-within:shadow-md focus-within:shadow-primary/10 transition-all duration-200"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pose une question à ton agent IA..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-xl gradient-primary flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-all duration-200 shadow shadow-primary/30 flex-shrink-0"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            ) : (
              <Send className="w-4 h-4 text-white" />
            )}
          </button>
        </form>
        <p className="text-center text-[10px] text-muted-foreground mt-2">
          Agent IA · JS-Innov.IA · Données en temps réel via Supabase
        </p>
      </div>
    </div>
  );
}
