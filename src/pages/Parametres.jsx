import React, { useState } from "react";
import {
  Settings, Bot, Globe, Key, Bell, Shield, Database,
  ExternalLink, Plus, Trash2, Eye, EyeOff, Check,
  AlertTriangle, X, Pencil, PowerOff, Copy, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const TABS = [
  { id: "agents",   label: "Agents IA",      icon: Bot },
  { id: "builder",  label: "Builder Web",     icon: Globe },
  { id: "api",      label: "APIs & Clés",     icon: Key },
  { id: "moteur",   label: "Moteur données",  icon: Database },
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

// ── APIs & Clés — constantes ──────────────────────────────────────────────────
const SERVICES  = ["OpenAI","Supabase","Base44","Railway Agent","GitHub","Make","Canva","ElevenLabs","Grok / xAI","Autre"];
const TYPES     = ["frontend public","backend secret","webhook secret","token GitHub","autre"];
const ENVS      = ["local","staging","production"];
const STATUSES  = ["actif","inactif","à vérifier"];

// Variables sensibles interdites côté frontend
const DANGEROUS_FRONTEND = ["SUPABASE_SERVICE_KEY","SUPABASE_SERVICE_ROLE_KEY","OPENAI_API_KEY","AGENT_API_KEY"];

// Données initiales non-secrètes (URLs de référence publiques uniquement)
const INITIAL_KEYS = [
  { id: 1, name: "Backend Agent URL",  service: "Railway Agent", variableName: "VITE_AGENT_URL",  type: "frontend public", environment: "production", maskedValue: "https://jsinnovia-agent-production.up.railway.app", status: "actif", notes: "URL publique du service Railway", createdAt: "2026-06-01", updatedAt: "2026-07-22" },
  { id: 2, name: "Supabase Project URL",service: "Supabase",    variableName: "VITE_SUPABASE_URL",type: "frontend public", environment: "production", maskedValue: "https://gfjpryakxzdzwnazlsfz.supabase.co", status: "actif", notes: "Supabase actif — projet gfjpry", createdAt: "2026-06-01", updatedAt: "2026-07-22" },
];

const STATUS_COLORS = { actif: "bg-green-500/20 text-green-400 border-green-500/30", inactif: "bg-slate-600/30 text-slate-400 border-slate-600/30", "à vérifier": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" };
const TYPE_COLORS   = { "frontend public": "text-cyan-400", "backend secret": "text-red-400", "webhook secret": "text-orange-400", "token GitHub": "text-purple-400", autre: "text-slate-400" };

const EMPTY_FORM = { name: "", service: "OpenAI", variableName: "", type: "backend secret", environment: "production", value: "", notes: "", status: "actif" };

// ── Modal Ajout/Édition ───────────────────────────────────────────────────────
function KeyModal({ initial = null, onSave, onClose }) {
  const [form, setForm] = useState(initial ? {
    name: initial.name, service: initial.service, variableName: initial.variableName,
    type: initial.type, environment: initial.environment, value: "",
    notes: initial.notes, status: initial.status,
  } : { ...EMPTY_FORM });
  const [showValue, setShowValue] = useState(false);

  const isEditing = !!initial;

  // Alertes de sécurité dynamiques
  const warnVite    = form.variableName.startsWith("VITE_") && form.type === "backend secret";
  const warnDanger  = DANGEROUS_FRONTEND.includes(form.variableName) && form.type === "frontend public";

  const handleSave = () => {
    if (!form.name.trim() || !form.variableName.trim()) return;
    if (warnVite || warnDanger) return; // blocage si alerte critique
    const now = new Date().toISOString().slice(0, 10);
    onSave({
      id: initial?.id ?? Date.now(),
      name: form.name.trim(),
      service: form.service,
      variableName: form.variableName.trim().toUpperCase(),
      type: form.type,
      environment: form.environment,
      maskedValue: form.value ? "••••••••" + form.value.slice(-4) : (initial?.maskedValue ?? "••••••••"),
      status: form.status,
      notes: form.notes,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    });
  };

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    /* Overlay */
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(8px)", background: "rgba(0,0,0,0.75)" }}>
      {/* Modal glassmorphism */}
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-600/60 shadow-2xl"
        style={{ background: "linear-gradient(135deg, rgba(15,23,42,0.97) 0%, rgba(30,41,59,0.97) 100%)", boxShadow: "0 0 60px rgba(212,175,55,0.08), 0 25px 50px rgba(0,0,0,0.7)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-700/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center">
              <Key className="w-4 h-4 text-yellow-400" />
            </div>
            <div>
              <h2 className="text-white font-semibold text-base">{isEditing ? "Modifier la clé API" : "Ajouter une nouvelle clé API"}</h2>
              <p className="text-slate-400 text-xs">Les valeurs sont masquées après sauvegarde</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-700 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Corps */}
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">

          {/* Alertes sécurité */}
          {warnVite && (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/40 bg-red-500/10">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-red-400 font-medium text-sm">Conflit de sécurité détecté</p>
                <p className="text-red-300/80 text-xs mt-0.5">Une variable <code className="bg-red-900/40 px-1 rounded">VITE_</code> est exposée dans le bundle frontend. Ne jamais y stocker un secret backend.</p>
              </div>
            </div>
          )}
          {warnDanger && (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-orange-500/40 bg-orange-500/10">
              <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-orange-400 font-medium text-sm">Variable sensible interdite côté frontend</p>
                <p className="text-orange-300/80 text-xs mt-0.5"><code className="bg-orange-900/40 px-1 rounded">{form.variableName}</code> est une clé critique — elle ne doit jamais être exposée côté client.</p>
              </div>
            </div>
          )}

          {/* Grille champs */}
          <div className="grid grid-cols-2 gap-4">

            {/* Nom */}
            <div className="col-span-2">
              <label className="text-xs text-slate-400 mb-1.5 block font-medium">Nom de la clé <span className="text-red-400">*</span></label>
              <input
                className="w-full bg-slate-800/80 border border-slate-600/60 rounded-xl px-4 py-2.5 text-white text-sm focus:border-yellow-500/60 focus:ring-1 focus:ring-yellow-500/20 outline-none transition-all"
                placeholder="Ex: Clé API principale OpenAI"
                value={form.name} onChange={e => set("name", e.target.value)} />
            </div>

            {/* Service */}
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block font-medium">Service</label>
              <div className="relative">
                <select
                  className="w-full appearance-none bg-slate-800/80 border border-slate-600/60 rounded-xl px-4 py-2.5 text-white text-sm focus:border-yellow-500/60 outline-none transition-all pr-8"
                  value={form.service} onChange={e => set("service", e.target.value)}>
                  {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Nom de variable */}
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block font-medium">Nom de variable <span className="text-red-400">*</span></label>
              <input
                className="w-full bg-slate-800/80 border border-slate-600/60 rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:border-yellow-500/60 focus:ring-1 focus:ring-yellow-500/20 outline-none transition-all uppercase"
                placeholder="Ex: OPENAI_API_KEY"
                value={form.variableName} onChange={e => set("variableName", e.target.value)} />
            </div>

            {/* Type */}
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block font-medium">Type</label>
              <div className="relative">
                <select
                  className="w-full appearance-none bg-slate-800/80 border border-slate-600/60 rounded-xl px-4 py-2.5 text-white text-sm focus:border-yellow-500/60 outline-none transition-all pr-8"
                  value={form.type} onChange={e => set("type", e.target.value)}>
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Environnement */}
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block font-medium">Environnement</label>
              <div className="flex gap-2">
                {ENVS.map(env => (
                  <button key={env}
                    type="button"
                    onClick={() => set("environment", env)}
                    className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-all capitalize ${form.environment === env ? "bg-yellow-500/20 border-yellow-500/50 text-yellow-400" : "bg-slate-800/60 border-slate-600/40 text-slate-400 hover:border-slate-500"}`}>
                    {env}
                  </button>
                ))}
              </div>
            </div>

            {/* Valeur */}
            <div className="col-span-2">
              <label className="text-xs text-slate-400 mb-1.5 block font-medium">
                Valeur de la clé{isEditing && <span className="text-slate-500 ml-2">(laisser vide pour ne pas modifier)</span>}
              </label>
              <div className="relative">
                <input
                  className="w-full bg-slate-800/80 border border-slate-600/60 rounded-xl px-4 py-2.5 pr-12 text-white text-sm font-mono focus:border-yellow-500/60 focus:ring-1 focus:ring-yellow-500/20 outline-none transition-all"
                  type={showValue ? "text" : "password"}
                  placeholder={isEditing ? "••••••••••••" : "Coller la valeur ici..."}
                  value={form.value} onChange={e => set("value", e.target.value)} />
                <button type="button" onClick={() => setShowValue(p => !p)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 transition-colors">
                  {showValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1.5">La valeur sera masquée (••••••) après enregistrement. Elle n'est jamais stockée en clair.</p>
            </div>

            {/* Statut */}
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block font-medium">Statut</label>
              <div className="flex gap-2">
                {STATUSES.map(s => (
                  <button key={s} type="button" onClick={() => set("status", s)}
                    className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-all capitalize ${form.status === s ? STATUS_COLORS[s] : "bg-slate-800/60 border-slate-600/40 text-slate-400 hover:border-slate-500"}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="col-span-2">
              <label className="text-xs text-slate-400 mb-1.5 block font-medium">Notes</label>
              <textarea
                className="w-full bg-slate-800/80 border border-slate-600/60 rounded-xl px-4 py-2.5 text-white text-sm focus:border-yellow-500/60 outline-none transition-all resize-none"
                rows={2}
                placeholder="Utilisation, expiration, notes..."
                value={form.notes} onChange={e => set("notes", e.target.value)} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700/60">
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" /> Stockage UI local — prévu pour connexion backend
          </p>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onClose} className="text-slate-400 hover:text-white">
              Annuler
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.name.trim() || !form.variableName.trim() || warnVite || warnDanger}
              className="bg-yellow-500 hover:bg-yellow-400 text-black font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
              <Check className="w-4 h-4 mr-2" /> {isEditing ? "Mettre à jour" : "Enregistrer"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Composant ligne de clé ────────────────────────────────────────────────────
function KeyRow({ apiKey, onEdit, onToggle, onDelete }) {
  const [copied, setCopied] = useState(false);

  const copyVar = () => {
    navigator.clipboard.writeText(apiKey.variableName).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <tr className="border-b border-slate-700/50 hover:bg-slate-800/40 transition-colors group">
      <td className="px-4 py-3.5">
        <p className="text-white text-sm font-medium">{apiKey.name}</p>
        <p className="text-slate-500 text-xs">{apiKey.service}</p>
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          <code className="text-xs font-mono text-cyan-300 bg-slate-800 px-2 py-0.5 rounded">{apiKey.variableName}</code>
          <button onClick={copyVar} className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-slate-200">
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      </td>
      <td className="px-4 py-3.5">
        <span className={`text-xs font-medium capitalize ${TYPE_COLORS[apiKey.type] ?? "text-slate-400"}`}>{apiKey.type}</span>
      </td>
      <td className="px-4 py-3.5">
        <span className="text-xs text-slate-400 capitalize">{apiKey.environment}</span>
      </td>
      <td className="px-4 py-3.5">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border capitalize ${STATUS_COLORS[apiKey.status]}`}>
          {apiKey.status}
        </span>
      </td>
      <td className="px-4 py-3.5 text-xs text-slate-500">{apiKey.updatedAt}</td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          <button title="Modifier" onClick={() => onEdit(apiKey)}
            className="w-7 h-7 rounded-lg hover:bg-slate-700 flex items-center justify-center transition-colors text-slate-400 hover:text-yellow-400">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button title={apiKey.status === "actif" ? "Désactiver" : "Activer"} onClick={() => onToggle(apiKey.id)}
            className="w-7 h-7 rounded-lg hover:bg-slate-700 flex items-center justify-center transition-colors text-slate-400 hover:text-orange-400">
            <PowerOff className="w-3.5 h-3.5" />
          </button>
          <button title="Supprimer" onClick={() => onDelete(apiKey.id)}
            className="w-7 h-7 rounded-lg hover:bg-red-900/40 flex items-center justify-center transition-colors text-slate-400 hover:text-red-400">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── APIs & Clés — section principale ─────────────────────────────────────────
function ApisKeys() {
  const [apiKeys, setApiKeys]     = useState(INITIAL_KEYS);
  const [modal, setModal]         = useState(null); // null | "add" | { id: ... }
  const [filterEnv, setFilterEnv] = useState("tous");

  const openAdd  = ()  => setModal("add");
  const openEdit = (k) => setModal(k);
  const closeModal     = ()  => setModal(null);

  const saveKey = (entry) => {
    setApiKeys(prev => {
      const exists = prev.find(k => k.id === entry.id);
      return exists ? prev.map(k => k.id === entry.id ? entry : k) : [...prev, entry];
    });
    closeModal();
  };

  const toggleStatus = (id) => {
    setApiKeys(prev => prev.map(k => k.id === id
      ? { ...k, status: k.status === "actif" ? "inactif" : "actif", updatedAt: new Date().toISOString().slice(0,10) }
      : k));
  };

  const deleteKey = (id) => {
    if (window.confirm("Supprimer cette clé ?")) {
      setApiKeys(prev => prev.filter(k => k.id !== id));
    }
  };

  const filtered = filterEnv === "tous" ? apiKeys : apiKeys.filter(k => k.environment === filterEnv);

  return (
    <>
      {/* Modal */}
      {modal !== null && (
        <KeyModal
          initial={modal === "add" ? null : modal}
          onSave={saveKey}
          onClose={closeModal} />
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">APIs & Clés</h3>
            <p className="text-sm text-slate-400">Gestion centralisée de vos clés d'API et tokens. Les valeurs sont masquées.</p>
          </div>
          <Button onClick={openAdd}
            className="bg-yellow-500 hover:bg-yellow-400 text-black font-semibold shadow shadow-yellow-500/20">
            <Plus className="w-4 h-4 mr-2" /> Ajouter une nouvelle clé API
          </Button>
        </div>

        {/* Bandeau sécurité */}
        <div className="flex items-start gap-3 p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5">
          <Shield className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-yellow-400 text-sm font-medium">Stockage sécurisé — phase UI</p>
            <p className="text-slate-400 text-xs mt-0.5">Les valeurs ne sont jamais affichées en clair après sauvegarde. Pour la production, configurez les secrets dans les variables d'environnement Railway. Aucun secret n'est commité dans le code.</p>
          </div>
        </div>

        {/* Filtres */}
        <div className="flex gap-2">
          {["tous", ...ENVS].map(env => (
            <button key={env} onClick={() => setFilterEnv(env)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all border ${filterEnv === env ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-400" : "bg-slate-800/60 border-slate-700 text-slate-400 hover:border-slate-500"}`}>
              {env}
            </button>
          ))}
          <span className="ml-auto text-xs text-slate-500 self-center">{filtered.length} clé{filtered.length > 1 ? "s" : ""}</span>
        </div>

        {/* Tableau */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <Key className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">Aucune clé configurée</p>
            <button onClick={openAdd} className="mt-3 text-yellow-400 hover:text-yellow-300 text-sm underline underline-offset-2">
              Ajouter la première clé
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-700/60 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/60 bg-slate-800/60">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Nom / Service</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Variable</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Env</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Statut</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Modifié</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-slate-900/40">
                {filtered.map(k => (
                  <KeyRow key={k.id} apiKey={k}
                    onEdit={openEdit} onToggle={toggleStatus} onDelete={deleteKey} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Moteur données ────────────────────────────────────────────────────────────
function MoteurDonnees() {
  return (
    <div className="text-center py-12 text-slate-400">
      <Database className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p>Configuration du moteur de données — bientôt disponible</p>
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
      case "moteur":   return <MoteurDonnees />;
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

      <div className="flex gap-2 border-b border-slate-700 pb-0 flex-wrap">
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
