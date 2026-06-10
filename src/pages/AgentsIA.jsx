import React, { useState, useRef, useEffect } from "react";
import {
  Bot, Send, Plus, Trash2, ChevronLeft, Loader2,
  Sparkles, User, MessageSquare, Settings, Zap, RefreshCw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

// ─── Configuration des agents Base44 disponibles ───────────────────────────
const AGENTS_CONFIG = [
  {
    id: "6a0208edd1e235b62b4bda38",
    name: "Synergie Dour Assistant",
    description: "Agent IA officiel de Synergie Dour — gestion membres, événements, annuaire.",
    color: "#D4AF37",
    bgColor: "#001a3d",
    emoji: "🏢",
    apiKey: import.meta.env.VITE_BASE44_SYNERGIE_API_KEY || "",
  },
  // Ajoute ici d'autres agents Base44 avec leur id + apiKey
  // {
  //   id: "AUTRE_AGENT_ID",
  //   name: "Nom de l'agent",
  //   description: "Description courte",
  //   color: "#4CAF50",
  //   bgColor: "#1a3d1a",
  //   emoji: "🤖",
  //   apiKey: import.meta.env.VITE_BASE44_AUTRE_API_KEY || "",
  // },
];

const BASE44_BASE = "https://app.base44.com/api/agents";

// ─── Composant Message ────────────────────────────────────────────────────────
function Message({ msg, agentColor }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-3 mb-4", isUser ? "flex-row-reverse" : "flex-row")}>
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm",
        isUser ? "bg-gray-200 text-gray-600" : "text-white"
      )}
        style={!isUser ? { backgroundColor: agentColor } : {}}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div className={cn(
        "max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
        isUser
          ? "bg-[#001a3d] text-white rounded-tr-sm"
          : "bg-white border border-gray-100 text-gray-800 rounded-tl-sm shadow-sm"
      )}>
        <p className="whitespace-pre-wrap">{msg.content}</p>
        {msg.ts && (
          <p className={cn("text-[10px] mt-1.5", isUser ? "text-white/50 text-right" : "text-gray-400")}>
            {format(msg.ts, "HH:mm", { locale: fr })}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Vue Chat d'un agent ─────────────────────────────────────────────────────
function AgentChat({ agent, onBack }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: `Bonjour ! Je suis **${agent.name}** ${agent.emoji}\n\nComment puis-je vous aider aujourd'hui ?`,
      ts: new Date(),
    },
  ]);
  const [conversationId, setConversationId] = useState(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Obtenir ou créer une conversation
  const getOrCreateConversation = async () => {
    if (conversationId) return conversationId;
    try {
      const res = await fetch(`${BASE44_BASE}/${agent.id}/conversations`, {
        method: "POST",
        headers: {
          "api_key": agent.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      const cid = data.id;
      setConversationId(cid);
      return cid;
    } catch (err) {
      console.error("Erreur création conversation:", err);
      return null;
    }
  };

  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg, ts: new Date() }]);
    setLoading(true);

    try {
      const cid = await getOrCreateConversation();
      if (!cid) throw new Error("Impossible de créer la conversation");

      const res = await fetch(`${BASE44_BASE}/${agent.id}/conversations/${cid}/messages`, {
        method: "POST",
        headers: {
          "api_key": agent.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "user", content: msg }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Erreur ${res.status}`);
      }

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.content || data.message || "…",
          ts: new Date(),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `❌ Erreur : ${err.message}`,
          ts: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const clearChat = () => {
    setConversationId(null);
    setMessages([{
      role: "assistant",
      content: `Conversation réinitialisée. ${agent.emoji} Comment puis-je vous aider ?`,
      ts: new Date(),
    }]);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] max-h-[800px]">
      {/* Header agent */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-t-xl text-white"
        style={{ backgroundColor: agent.bgColor }}>
        <button onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0"
          style={{ backgroundColor: agent.color + "33", border: `2px solid ${agent.color}` }}>
          {agent.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate" style={{ color: agent.color }}>{agent.name}</p>
          <p className="text-xs text-white/60 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block"></span>
            En ligne · Base44 API
          </p>
        </div>
        <button onClick={clearChat} title="Nouvelle conversation"
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-50/80 space-y-1">
        {messages.map((msg, i) => (
          <Message key={i} msg={msg} agentColor={agent.color} />
        ))}
        {loading && (
          <div className="flex gap-3 mb-4">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white flex-shrink-0"
              style={{ backgroundColor: agent.color }}>
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }}></span>
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }}></span>
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }}></span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 bg-white border-t border-gray-100 rounded-b-xl">
        <form onSubmit={(e) => { e.preventDefault(); send(); }}
          className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder={`Message à ${agent.name}…`}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent max-h-32"
            style={{ "--tw-ring-color": agent.color }}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 text-white flex-shrink-0"
            style={{ backgroundColor: agent.color }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Liste des agents ─────────────────────────────────────────────────────────
function AgentCard({ agent, onClick }) {
  return (
    <button onClick={() => onClick(agent)}
      className="w-full text-left p-5 rounded-xl border-2 border-gray-100 bg-white hover:border-gray-200 hover:shadow-md transition-all group">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
          style={{ backgroundColor: agent.bgColor }}>
          {agent.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-gray-900 text-sm truncate">{agent.name}</h3>
            <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" title="En ligne"></span>
          </div>
          <p className="text-xs text-gray-500 line-clamp-2">{agent.description}</p>
          <div className="flex items-center gap-1.5 mt-2">
            <Zap className="w-3 h-3" style={{ color: agent.color }} />
            <span className="text-xs font-medium" style={{ color: agent.color }}>Base44 API</span>
          </div>
        </div>
        <MessageSquare className="w-5 h-5 text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0 mt-1" />
      </div>
    </button>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────
export default function AgentsIA() {
  const [selectedAgent, setSelectedAgent] = useState(null);

  if (selectedAgent) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <AgentChat agent={selectedAgent} onBack={() => setSelectedAgent(null)} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-[#001a3d] flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Agents IA</h1>
            <p className="text-sm text-gray-500">Discutez directement avec vos agents Base44</p>
          </div>
        </div>
        <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800 flex items-start gap-2">
          <Zap className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>Connexion directe via <strong>Base44 API</strong> — les réponses sont générées en temps réel par chaque agent.</span>
        </div>
      </div>

      {/* Liste agents */}
      <div className="space-y-3">
        {AGENTS_CONFIG.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onClick={setSelectedAgent} />
        ))}
      </div>

      {/* Footer : ajouter un agent */}
      <div className="mt-6 p-4 rounded-xl border-2 border-dashed border-gray-200 text-center">
        <Bot className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500 mb-1">Ajouter un autre agent Base44</p>
        <p className="text-xs text-gray-400">Configure son ID et sa clé API dans <code className="bg-gray-100 px-1 rounded">AGENTS_CONFIG</code> dans <code className="bg-gray-100 px-1 rounded">AgentsIA.jsx</code></p>
      </div>
    </div>
  );
}
