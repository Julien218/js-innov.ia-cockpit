import React, { useState, useRef, useEffect } from "react";
import {
  Bot, Send, ChevronLeft, Loader2, Sparkles, User,
  MessageSquare, Zap, RefreshCw, Lock, CheckCircle2,
  Server, Cpu, FileText, Wrench, Brain, FolderOpen
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useAuth } from "@/lib/AuthContext";
import { useCommerceEntitlements } from "@/lib/useCommerceEntitlements";

// ─── TOUS LES AGENTS JS-INNOV.IA ─────────────────────────────────────────────
const AGENTS_CONFIG = [
  {
    id: "6a1845e17cc526d1e44965bc",
    name: "JsInnov-Agent",
    description: "Agent IA principal — développement, architecture, DevOps, documentation.",
    color: "#D4AF37",
    bgColor: "#0a0a1a",
    emoji: "🚀",
    tag: "Principal",
    tagColor: "#D4AF37",
  },
  {
    id: "6a0208edd1e235b62b4bda38",
    name: "Synergie Dour Assistant",
    description: "Agent officiel Synergie Dour — membres, événements, annuaire commerçants.",
    color: "#D4AF37",
    bgColor: "#001a3d",
    emoji: "🏢",
    tag: "Client",
    tagColor: "#1a56db",
  },
  {
    id: "69fcda52258a254f4220b0bd",
    name: "A Yanis",
    description: "Agent IA personnel A Yanis — assistant dédié.",
    color: "#10b981",
    bgColor: "#001a0d",
    emoji: "👤",
    tag: "Personnel",
    tagColor: "#10b981",
  },
  {
    id: "6a0371a87c9257126b051d5a",
    name: "Site Olivier landing Page",
    description: "Agent pour le site d'Olivier Trevis — gestion contenu et communication.",
    color: "#f97316",
    bgColor: "#1a0d00",
    emoji: "🎯",
    tag: "Client",
    tagColor: "#f97316",
  },
  {
    id: "", // Ouvre l'agent → Développeur → URL base → copie l'ID
    name: "Agent VilleConnect",
    description: "Agent IA VilleConnect OS — gestion territoriale, citoyens, commerces.",
    color: "#06b6d4",
    bgColor: "#001a3d",
    emoji: "🌆",
    tag: "VilleConnect",
    tagColor: "#06b6d4",
  },
  {
    id: "6a22f0c096ce009a943f4a05",
    name: "Dourconnect2",
    description: "Agent IA DourConnect — plateforme territoriale de la ville de Dour.",
    color: "#06b6d4",
    bgColor: "#001a3d",
    emoji: "🌆",
    tag: "VilleConnect",
    tagColor: "#06b6d4",
  },
  {
    id: "69ff4dc771a2cdab275f8a00",
    name: "NOVA  JS-Innov.IA",
    description: "Agent NOVA — assistant créatif et stratégique Js-Innov.IA.",
    color: "#a855f7",
    bgColor: "#1a0a2e",
    emoji: "✨",
    tag: "Créatif",
    tagColor: "#a855f7",
  },
  {
    id: "6a035427dca907aa03b71398",
    name: "Agent Fashionistart",
    description: "Agent dédié à Fashionist'ART Dour — événements, mode, communication.",
    color: "#f43f5e",
    bgColor: "#1a0010",
    emoji: "👗",
    tag: "Client",
    tagColor: "#f43f5e",
  },
  {
    id: "69e732e1d54abfd1783f5d06",
    name: "Agent Miss & Mister Dour",
    description: "Agent IA officiel Miss & Mister Dour — événements, candidatures, communication.",
    color: "#ec4899",
    bgColor: "#1a0015",
    emoji: "👑",
    tag: "Événement",
    tagColor: "#ec4899",
  },
];

// ─── Message bubble ───────────────────────────────────────────────────────────
function Message({ msg, agentColor }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-2.5 mb-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div className={cn(
        "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0",
        isUser ? "bg-gray-200 text-gray-600" : "text-white"
      )} style={!isUser ? { backgroundColor: agentColor } : {}}>
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>
      <div className={cn(
        "max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
        isUser
          ? "bg-[#001a3d] text-white rounded-tr-sm"
          : "bg-white border border-gray-100 text-gray-800 rounded-tl-sm shadow-sm"
      )}>
        <p className="whitespace-pre-wrap">{msg.content}</p>
        {msg.ts && (
          <p className={cn("text-[10px] mt-1", isUser ? "text-white/50 text-right" : "text-gray-400")}>
            {format(msg.ts, "HH:mm", { locale: fr })}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Vue Chat ─────────────────────────────────────────────────────────────────
function AgentChat({ agent, onBack }) {
  const [messages, setMessages] = useState([{
    role: "assistant",
    content: `Bonjour ! Je suis **${agent.name}** ${agent.emoji}\nComment puis-je vous aider ?`,
    ts: new Date(),
  }]);
  const [convId, setConvId] = useState(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const getOrCreateConv = async () => {
    if (convId) return convId;
    const res = await fetch(`/api/agents/${agent.id}/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(res.status === 403 ? "Agent non inclus dans votre abonnement" : `Erreur ${res.status}`);
    const data = await res.json();
    setConvId(data.id);
    return data.id;
  };

  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput("");
    setMessages(p => [...p, { role: "user", content: msg, ts: new Date() }]);
    setLoading(true);
    try {
      const cid = await getOrCreateConv();
      const res = await fetch(`/api/agents/${agent.id}/conversations/${cid}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ role: "user", content: msg }),
      });
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const data = await res.json();
      setMessages(p => [...p, { role: "assistant", content: data.content || "…", ts: new Date() }]);
    } catch (err) {
      setMessages(p => [...p, { role: "assistant", content: `❌ ${err.message}`, ts: new Date() }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const reset = () => {
    setConvId(null);
    setMessages([{ role: "assistant", content: `Nouvelle conversation ${agent.emoji}`, ts: new Date() }]);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-h-[820px]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-t-xl text-white flex-shrink-0"
        style={{ backgroundColor: agent.bgColor, borderBottom: `2px solid ${agent.color}44` }}>
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-xl flex-shrink-0"
          style={{ backgroundColor: agent.color + "22", border: `2px solid ${agent.color}` }}>
          {agent.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm truncate" style={{ color: agent.color }}>{agent.name}</p>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: agent.tagColor + "33", color: agent.tagColor }}>
              {agent.tag}
            </span>
          </div>
          <p className="text-xs text-white/50 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block"></span>
            Base44 · En ligne
          </p>
        </div>
        <button onClick={reset} title="Nouvelle conversation"
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/50 hover:text-white">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-50 min-h-0">
        {messages.map((m, i) => <Message key={i} msg={m} agentColor={agent.color} />)}
        {loading && (
          <div className="flex gap-2.5 mb-3">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white flex-shrink-0"
              style={{ backgroundColor: agent.color }}>
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1">
                {[0,150,300].map(d => (
                  <span key={d} className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                    style={{ animationDelay: `${d}ms` }}></span>
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 bg-white border-t border-gray-100 rounded-b-xl flex-shrink-0">
        <form onSubmit={e => { e.preventDefault(); send(); }} className="flex gap-2 items-end">
          <textarea ref={inputRef} rows={1} value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={`Message à ${agent.name}…`}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 max-h-28"
            disabled={loading} />
          <button type="submit" disabled={loading || !input.trim()}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 text-white flex-shrink-0"
            style={{ backgroundColor: agent.color }}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Card agent ────────────────────────────────────────────────────────────────
function AgentCard({ agent, onClick }) {
  const isActive = !!agent.id;

  return (
    <div onClick={() => isActive && onClick(agent)}
      className={cn(
        "w-full p-4 rounded-xl border-2 transition-all",
        isActive
          ? "border-gray-100 bg-white hover:border-gray-200 hover:shadow-md cursor-pointer group"
          : "border-gray-100 bg-gray-50/60 cursor-default"
      )}>
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
          style={{ backgroundColor: agent.bgColor || "#001a3d" }}>
          {agent.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <h3 className="font-semibold text-gray-900 text-sm">{agent.name}</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: agent.tagColor + "22", color: agent.tagColor }}>
              {agent.tag}
            </span>
            {isActive
              ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              : <Lock className="w-3.5 h-3.5 text-amber-400" />
            }
          </div>
          <p className="text-xs text-gray-500 line-clamp-1">{agent.description}</p>
          {!agent.id && (
            <p className="text-[10px] text-amber-600 mt-1 font-medium">
              ID manquant — Développeur → URL de base → copier l'ID
            </p>
          )}
        </div>
        {isActive && (
          <MessageSquare className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0" />
        )}
      </div>
    </div>
  );
}


// ── Badge statut Agent Local ───────────────────────────────────────────────────
function AgentLocalBadge() {
  const [status, setStatus] = useState("checking");
  useEffect(() => {
    const check = () => {
      fetch("http://127.0.0.1:8787/health", { signal: AbortSignal.timeout(3000) })
        .then(r => setStatus(r.ok ? "online" : "offline"))
        .catch(() => setStatus("offline"));
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  const dotColor = status === "online" ? "bg-emerald-500" : status === "checking" ? "bg-amber-400 animate-pulse" : "bg-red-500";
  const textColor = status === "online" ? "text-emerald-600" : status === "checking" ? "text-amber-500" : "text-red-500";

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${textColor}`}>
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      {status === "online" ? "Connecté" : status === "checking" ? "…" : "Hors ligne"}
    </span>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────
export default function AgentsIA() {
  const [selected, setSelected] = useState(null);
  const { user } = useAuth();
  const { enabledModules, isLoading: entitlementsLoading } = useCommerceEntitlements();
  const isClient = user?.role === 'client';
  const visibleAgents = isClient
    ? AGENTS_CONFIG.filter((agent) => agent.id && enabledModules.has(`ai_agent:${agent.id}`))
    : AGENTS_CONFIG;

  const active  = visibleAgents.filter(a => a.id);
  const pending = isClient ? [] : visibleAgents.filter(a => !a.id);

  useEffect(() => {
    if (selected && !visibleAgents.some((agent) => agent.id === selected.id)) setSelected(null);
  }, [selected, visibleAgents]);

  if (selected) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <AgentChat agent={selected} onBack={() => setSelected(null)} />
      </div>
    );
  }

  return (
    <div className="p-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-[#001a3d] flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-[#D4AF37]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Agents IA</h1>
          <p className="text-xs text-gray-500">
            {active.length} actif{active.length > 1 ? "s" : ""} · {pending.length} en attente
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: "Total", value: visibleAgents.length, color: "#1a56db" },
          { label: "Actifs", value: active.length, color: "#16a34a" },
          { label: "En attente", value: pending.length, color: "#f59e0b" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 p-3 text-center">
            <p className="text-2xl font-bold" style={{ color }}>{value}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>


      {/* ── Agent Local 8787 ─────────────────────────────────────────────── */}
      {!isClient && <div className="mb-5 rounded-xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-600 flex items-center justify-center flex-shrink-0">
            <Server className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-gray-900 text-sm">Agent Local JS-Innov.IA</h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">
                127.0.0.1:8787
              </span>
              <AgentLocalBadge />
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Hub IA local — gère Ollama, fichiers, outils, mémoire et actions du cockpit
            </p>
          </div>
        </div>

        {/* Sous-composants de l'Agent Local */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
          {[
            { icon: Cpu, label: "Ollama", sub: "qwen3.5:4b · llama3.2:3b", color: "text-blue-600 bg-blue-50" },
            { icon: FileText, label: "Fichiers locaux", sub: "Lecture / écriture", color: "text-amber-600 bg-amber-50" },
            { icon: Wrench, label: "Outils", sub: "Actions autorisées", color: "text-purple-600 bg-purple-50" },
            { icon: Brain, label: "Mémoire locale", sub: "Futur", color: "text-gray-500 bg-gray-50", future: true },
            { icon: FolderOpen, label: "Contrôle cockpit", sub: "Navigation / données", color: "text-emerald-600 bg-emerald-50" },
            { icon: Lock, label: "Actions autorisées", sub: "Futur", color: "text-gray-400 bg-gray-50", future: true },
          ].map((comp) => (
            <div key={comp.label} className={`rounded-lg p-2.5 ${comp.color} ${comp.future ? "opacity-50" : ""}`}>
              <comp.icon className="w-4 h-4 mb-1" />
              <p className="text-xs font-semibold">{comp.label}</p>
              <p className="text-[10px] opacity-70">{comp.sub}</p>
            </div>
          ))}
        </div>

        {/* Architecture flow */}
        <div className="mt-3 flex items-center gap-2 text-[10px] text-gray-400 font-mono">
          <span className="px-2 py-1 rounded bg-gray-100">Cockpit</span>
          <span>→</span>
          <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-700 font-semibold">Agent 8787</span>
          <span>→</span>
          <span className="px-2 py-1 rounded bg-blue-100 text-blue-600">Ollama 11434</span>
          <span className="text-gray-300">·</span>
          <span className="px-2 py-1 rounded bg-gray-100">fichiers</span>
          <span className="text-gray-300">·</span>
          <span className="px-2 py-1 rounded bg-gray-100">outils</span>
        </div>

        <a href="/agent" className="mt-3 block text-center text-xs font-medium text-emerald-700 hover:text-emerald-800 transition-colors py-2 rounded-lg bg-emerald-100 hover:bg-emerald-200">
          Ouvrir Julien AI →
        </a>
      </div>}

      {isClient && !entitlementsLoading && active.length === 0 && (
        <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
          Aucun agent IA n’est actuellement inclus dans votre abonnement.
        </div>
      )}

      {/* Agents actifs */}
      {active.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1 mb-2">
            ✅ Actifs
          </p>
          <div className="space-y-2">
            {active.map(a => <AgentCard key={a.id} agent={a} onClick={setSelected} />)}
          </div>
        </div>
      )}

      {/* Agents en attente */}
      {pending.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1 mb-2">
            🔒 ID manquant
          </p>
          <div className="space-y-2">
            {pending.map(a => <AgentCard key={a.name} agent={a} onClick={setSelected} />)}
          </div>
        </div>
      )}

      {/* Guide */}
      {!isClient && <div className="mt-5 p-4 rounded-xl border border-dashed border-gray-200 bg-gray-50">
        <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-[#D4AF37]" /> Activer un agent
        </p>
        <ol className="text-xs text-gray-500 space-y-1 list-decimal list-inside">
          <li>Ouvre l'agent → <strong>Personnaliser → Développeur</strong></li>
          <li>Copie l'<strong>ID</strong> depuis l'URL de base</li>
          <li>Ajoute-le dans <code className="bg-gray-200 px-1 rounded">AgentsIA.jsx</code></li>
          <li>Attribue ensuite l’agent au client depuis les droits d’abonnement du cockpit</li>
        </ol>
      </div>}
    </div>
  );
}

