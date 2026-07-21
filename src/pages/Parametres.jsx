import React, { useState } from "react";
import { Settings, Bot, Globe, Key, Bell, Shield, ExternalLink, Plus, Trash2, Eye, EyeOff, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const TABS = [
  { id: "agents",   label: "Agents IA",      icon: Bot },
  { id: "builder",  label: "Builder Web",     icon: Globe },
  { id: "api",      label: "APIs & Clés",     icon: Key },
  { id: "notifs",   label: "Notifications",   icon: Bell },
  { id: "securite", label: "Sécurité",        icon: Shield },
];

// ── Agents IA ─────────────────────────────────────────────────────────────────
function AgentsIA() {
  const [agents, setAgents] = useState([
    { id: 1, nom: "NOVA — Agent Principal",     type: "base44",    actif: true,  url: "https://app.base44.com/superagent/69ff4dc771a2cdab275f8a00" },
    { id: 2, nom: "Agent jsinnovia.com",         type: "base44",    actif: true,  url: "https://app.base44.com" },
  ]);
  const [showForm, setShowForm] = useState(false);
  const [newAgent, setNewAgent] = useState({ nom: "", type: "openai", apiKey: "", model: "gpt-4o", endpoint: "" });

  const typeOptions = ["openai","anthropic","mistral","base44","custom"];

  const addAgent = () => {
    if (!newAgent.nom) return;
    setAgents(prev => [...prev, { id: Date.now(), ...newAgent, actif: true }]);
    setNewAgent({ nom: "", type: "openai", apiKey: "", model: "gpt-4o", endpoint: "" });
    setShowForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Agents IA connectés</h3>
          <p className="text-sm text-slate-400">Gérez vos agents IA via API (OpenAI, Anthropic, Base44…)</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="bg-yellow-500 hover:bg-yellow-400 text-black">
          <Plus className="w-4 h-4 mr-2" /> Ajouter un agent
        </Button>
      </div>

      {/* Liste agents */}
      <div className="space-y-3">
        {agents.map(agent => (
          <div key={agent.id} className="flex items-center justify-between p-4 rounded-xl border border-slate-700 bg-slate-800/50">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${agent.actif ? "bg-green-400" : "bg-slate-500"}`} />
              <div>
                <p className="text-white font-medium">{agent.nom}</p>
                <p className="text-xs text-slate-400 capitalize">{agent.type} {agent.model ? `· ${agent.model}` : ""}</p>
              </div>
            </div>
            <div className="flex gap-2">
              {agent.url && (
                <Button size="sm" variant="ghost" onClick={() => window.open(agent.url, "_blank")}>
                  <ExternalLink className="w-4 h-4" />
                </Button>
              )}
              <Button size="sm" variant="ghost" className="text-red-400"
                onClick={() => setAgents(prev => prev.filter(a => a.id !== agent.id))}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Formulaire ajout agent */}
      {showForm && (
        <div className="p-5 rounded-xl border border-yellow-500/30 bg-slate-800 space-y-4">
          <h4 className="text-white font-semibold">Nouvel agent IA</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Nom de l'agent</label>
              <input className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                placeholder="Ex: GPT-4o Assistant" value={newAgent.nom}
                onChange={e => setNewAgent(p => ({ ...p, nom: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Type / Provider</label>
              <select className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                value={newAgent.type} onChange={e => setNewAgent(p => ({ ...p, type: e.target.value }))}>
                {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Clé API</label>
              <input className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                type="password" placeholder="sk-..." value={newAgent.apiKey}
                onChange={e => setNewAgent(p => ({ ...p, apiKey: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Modèle</label>
              <input className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                placeholder="gpt-4o / claude-3-5-sonnet..." value={newAgent.model}
                onChange={e => setNewAgent(p => ({ ...p, model: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-400 mb-1 block">Endpoint custom (optionnel)</label>
              <input className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                placeholder="https://api.example.com/v1" value={newAgent.endpoint}
                onChange={e => setNewAgent(p => ({ ...p, endpoint: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-3">
            <Button onClick={addAgent} className="bg-yellow-500 hover:bg-yellow-400 text-black">
              <Check className="w-4 h-4 mr-2" /> Ajouter
            </Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Annuler</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Builder Web ───────────────────────────────────────────────────────────────
function BuilderWeb() {
  const sites = [
    { nom: "jsinnovia.com",        url: "https://jsinnovia.com",              admin: "https://github.com/Julien218/js-innov.ia", statut: "en_ligne" },
    { nom: "oliviertrevis.be",     url: "https://www.oliviertrevis.be",       admin: "https://github.com/Julien218/oliviertrevis-site", statut: "en_ligne" },
    { nom: "fashionistartdour.be", url: "https://www.fashionistartdour.be",   admin: "https://github.com/Julien218/fashionist-art", statut: "en_ligne" },
    { nom: "synergiedour.be",      url: "https://www.synergiedour.be",        admin: "https://github.com/Julien218/synergie-dour", statut: "ssl_error" },
    { nom: "cockpit.jsinnovia.com",url: "https://cockpit.jsinnovia.com",      admin: "https://github.com/Julien218/js-innov.ia-cockpit", statut: "en_ligne" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white">Gestion des sites web</h3>
        <p className="text-sm text-slate-400">Accès rapide à vos sites et leur code source GitHub</p>
      </div>

      <div className="space-y-3">
        {sites.map(site => (
          <div key={site.nom} className="flex items-center justify-between p-4 rounded-xl border border-slate-700 bg-slate-800/50">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${site.statut === "en_ligne" ? "bg-green-400" : "bg-red-400"}`} />
              <div>
                <p className="text-white font-medium">{site.nom}</p>
                <p className="text-xs text-slate-500">{site.statut === "ssl_error" ? "⚠️ Erreur SSL" : "✅ En ligne"}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="border-slate-600 text-slate-300"
                onClick={() => window.open(site.url, "_blank")}>
                <Globe className="w-3.5 h-3.5 mr-1" /> Voir
              </Button>
              <Button size="sm" variant="outline" className="border-slate-600 text-slate-300"
                onClick={() => window.open(site.admin, "_blank")}>
                <ExternalLink className="w-3.5 h-3.5 mr-1" /> GitHub
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
        <p className="text-cyan-400 text-sm font-medium mb-1">💡 Builder en live</p>
        <p className="text-slate-400 text-sm">Pour éditer un site en live, ouvre le repo GitHub correspondant et utilise l'éditeur web GitHub ou clone-le localement. Bientôt : intégration directe dans le cockpit.</p>
      </div>
    </div>
  );
}

// ── APIs & Clés ───────────────────────────────────────────────────────────────
function ApisKeys() {
  const [show, setShow] = useState({});
  const keys = [
    { nom: "Supabase Project ID",   val: "gfjpryakxzdzwnazlsfz" },
    { nom: "Supabase URL",          val: "https://gfjpryakxzdzwnazlsfz.supabase.co" },
    { nom: "Backend Agent URL",     val: "https://jsinnovia-agent-production.up.railway.app" },
    { nom: "Cockpit URL",           val: "https://cockpit.jsinnovia.com" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white">APIs & Configurations</h3>
        <p className="text-sm text-slate-400">Références techniques de votre infrastructure</p>
      </div>
      <div className="space-y-3">
        {keys.map(k => (
          <div key={k.nom} className="flex items-center justify-between p-4 rounded-xl border border-slate-700 bg-slate-800/50">
            <div>
              <p className="text-xs text-slate-400">{k.nom}</p>
              <p className="text-white text-sm font-mono mt-0.5">
                {show[k.nom] ? k.val : "••••••••••••••••"}
              </p>
            </div>
            <Button size="icon" variant="ghost" onClick={() => setShow(p => ({ ...p, [k.nom]: !p[k.nom] }))}>
              {show[k.nom] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PAGE PRINCIPALE ──────────────────────────────────────────────────────────
export default function Parametres() {
  const [activeTab, setActiveTab] = useState("agents");

  const renderContent = () => {
    switch (activeTab) {
      case "agents":   return <AgentsIA />;
      case "builder":  return <BuilderWeb />;
      case "api":      return <ApisKeys />;
      case "notifs":   return (
        <div className="text-center py-12 text-slate-400">
          <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Configuration des notifications — bientôt disponible</p>
        </div>
      );
      case "securite": return (
        <div className="text-center py-12 text-slate-400">
          <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Paramètres de sécurité — bientôt disponible</p>
        </div>
      );
      default: return null;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings className="w-6 h-6 text-yellow-400" /> Paramètres
        </h1>
        <p className="text-slate-400 text-sm mt-1">Configuration globale de votre plateforme JS-Innov.IA</p>
      </div>

      <div className="flex gap-2 border-b border-slate-700 pb-0">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 ${
                activeTab === tab.id
                  ? "border-yellow-400 text-yellow-400 bg-slate-800"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}>
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        {renderContent()}
      </div>
    </div>
  );
}
