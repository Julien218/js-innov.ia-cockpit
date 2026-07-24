import React, { useState, useMemo } from "react";
import PageHeader from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Boxes, ExternalLink, Settings, Link2, Crown, Users, ShoppingBag,
  Bot, FlaskConical, Lock, Filter,
} from "lucide-react";

// ─── DATA: 50 apps Base44 + agents (static, from inventory 2026-07-25) ───────
const APP_CATEGORIES = {
  active: { label: "Apps actives", icon: Crown, color: "text-emerald-600 bg-emerald-500/10" },
  client: { label: "Apps clients", icon: Users, color: "text-blue-600 bg-blue-500/10" },
  vendable: { label: "Apps vendables", icon: ShoppingBag, color: "text-amber-600 bg-amber-500/10" },
  agent: { label: "Agents IA", icon: Bot, color: "text-purple-600 bg-purple-500/10" },
  proto: { label: "Prototypes", icon: FlaskConical, color: "text-cyan-600 bg-cyan-500/10" },
  locked: { label: "Ne pas toucher", icon: Lock, color: "text-red-600 bg-red-500/10" },
};

const APPS = [
  // ─── Apps actives (7) ────────────────────────────────────────────────────
  { id: "69ff4dc771a2cdab275f8a00", name: "JS - AGENT - COCKPIT", cat: "active", type: "Superagent", url: "https://app.base44.com/superagent/69ff4dc771a2cdab275f8a00", domain: "—", github: "—", entities: 10 },
  { id: "691d332d17337e06a0c04ae3", name: "JS-INNOV.IA", cat: "active", type: "App vitrine", url: "https://jsinnovia.com", domain: "jsinnovia.com", github: "js-innov.ia", entities: 30, desc: "Site vitrine + marketplace IA" },
  { id: "6a0208edd1e235b62b4bda38", name: "SynergieDour.be", cat: "client", type: "App client", url: "https://synergiedour.be", domain: "synergiedour.be", github: "synergie-dour", entities: 3, desc: "Annuaire commerçants + ASBL", client: "Olivier Trévis" },
  { id: "6a0371a87c9257126b051d5a", name: "Multi site", cat: "client", type: "App client", url: "https://www.oliviertrevis.be", domain: "oliviertrevis.be", github: "oliviertrevis-site", entities: 16, desc: "Tour de Dour + mascottes", client: "Olivier Trévis" },
  { id: "6a1a095403fb2e90f7629464", name: "Miss DOUR", cat: "client", type: "App client", url: "https://missetmisterdour.be", domain: "missetmisterdour.be", github: "miss2026", entities: 1, desc: "Concours Miss & Mister Dour" },
  { id: "6a008b3e1571ea9f6ac3839d", name: "assurances-dour.be", cat: "client", type: "App client", url: "https://assurances-dour.be", domain: "assurances-dour.be", github: "—", entities: 0, desc: "Site assurances" },
  { id: "69a460cb984c65f748b49e7d", name: "Fashionist'ART", cat: "client", type: "App client", url: "https://fashionistartdour.be", domain: "fashionistartdour.be", github: "fashionist-art", entities: 0, desc: "Site événement mode/art" },

  // ─── Apps vendables (8) ──────────────────────────────────────────────────
  { id: "69905ec19aad4db89f14df43", name: "Voiced", cat: "vendable", type: "SaaS", url: "", domain: "—", desc: "TTS / voix IA → audio" },
  { id: "68f6561c09f2529366905346", name: "Offre-Devis-Incendie", cat: "vendable", type: "Outil", url: "", domain: "—", desc: "Devis assurance incendie" },
  { id: "6901e46e9cb8fe5df615dc45", name: "AutoDevis", cat: "vendable", type: "Outil", url: "", domain: "—", desc: "Devis assurance auto" },
  { id: "69c3f7e8ca0751023274d067", name: "LeadFinder Pro", cat: "vendable", type: "SaaS B2B", url: "", domain: "—", desc: "Recherche de leads B2B" },
  { id: "69d3271c4908d4dee7ca0aea", name: "ArtisPrint AI", cat: "vendable", type: "SaaS design", url: "", domain: "—", github: "artisprint-ai", desc: "Supports print IA" },
  { id: "6a0448473bebffcc3578f3b8", name: "QR - By - Js-innov.IA", cat: "vendable", type: "Utility", url: "", domain: "—", github: "qr-by-js-innov.ia", desc: "QR codes design premium" },
  { id: "69488c51b0b4d5fdde64f944", name: "AccèsFlow", cat: "vendable", type: "SaaS events", url: "", domain: "—", desc: "Gestion événements + inscriptions" },
  { id: "6a42b8049ec36908b1e8ad03", name: "NexusCore", cat: "vendable", type: "SaaS", url: "", domain: "—", desc: "OS cognitif unifié équipes" },

  // ─── Prototypes (14) ─────────────────────────────────────────────────────
  { id: "6a11d1493754e75ce76ee0de", name: "villeConnectOs", cat: "proto", type: "Prototype", desc: "OS ville connectée" },
  { id: "6a22f0c096ce009a943f4a05", name: "Dourconnect2", cat: "proto", type: "Prototype", desc: "Dour Connect v2" },
  { id: "6a1040aa743a034828d39d6d", name: "Tour de Dour IA", cat: "proto", type: "Prototype", desc: "IA Tour de Dour" },
  { id: "6a2fa761fde60b63a229ca94", name: "Dour IA", cat: "proto", type: "Prototype", desc: "IA locale Dour" },
  { id: "6a01e1846a85b26a308ff1f3", name: "AURA", cat: "proto", type: "Agent IA", desc: "Agent IA" },
  { id: "6a5a8ceaf61837f9dc5ef067", name: "Elara", cat: "proto", type: "Agent IA", desc: "Agent IA" },
  { id: "6a500d5849f7e063943dbfd5", name: "Kaelo", cat: "proto", type: "Agent IA", desc: "Agent IA" },
  { id: "6a52dee301883fd921fae048", name: "Lyra", cat: "proto", type: "Agent IA", desc: "Agent IA" },
  { id: "69dd23ae215213c8d8b4e8d9", name: "Generateur Video", cat: "proto", type: "Prototype", desc: "Générateur vidéo mode" },
  { id: "69e4a3c0a07828ee872a9576", name: "Video Reseaux", cat: "proto", type: "Prototype", desc: "Vidéo réseaux sociaux" },
  { id: "6a3f9ee42c7e10c599154289", name: "Monteur vidéo jsconstruct", cat: "proto", type: "Prototype", desc: "Monteur vidéo" },
  { id: "69cf0da8d95b0fb5fee1e1ff", name: "Starlight Events", cat: "proto", type: "Prototype", desc: "Portail ASBL events" },
  { id: "6979af262dcf0f9c5953d90a", name: "ConnectSocial", cat: "proto", type: "Prototype", desc: "Réseau social" },
  { id: "69e486575cdb2326e2d74da7", name: "PROK 4K", cat: "proto", type: "Prototype", desc: "—" },

  // ─── Agents IA (11) ──────────────────────────────────────────────────────
  { id: "6a04f0925bd7811bc3b50cdc", name: "Agent Js-innov.ia", cat: "agent", type: "Agent IA", desc: "Agent spécialisé" },
  { id: "6a035427dca907aa03b71398", name: "Agent Fashionistart", cat: "agent", type: "Agent IA", desc: "Agent fashion" },
  { id: "69e732e1d54abfd1783f5d06", name: "Agent Miss & Mister Dour", cat: "agent", type: "Agent IA", desc: "Agent concours" },
  { id: "6a199bf9a8a9f3bf17256d73", name: "Agentvideomasvotedour", cat: "agent", type: "Agent IA", desc: "Agent vidéo" },
  { id: "69e467a9d6329bb2ead81fa3", name: "Agent GeneratVideoPro", cat: "agent", type: "Agent IA", desc: "Agent vidéo pro" },
  { id: "69ed0a42be17008cf11027eb", name: "Js-Innov.IA Creative Director", cat: "agent", type: "Agent IA", desc: "Directeur créatif IA" },
  { id: "69f2ea9f9d6e7f23e5fc608a", name: "Createur Innovent", cat: "agent", type: "Agent IA", desc: "Créateur innovant" },
  { id: "6a24286d838202b06e2597aa", name: "Julien AI", cat: "agent", type: "Superagent", desc: "Superagent Julien" },
  { id: "6a1c9994f291ffb4c326b9d3", name: "Julien AI (v2)", cat: "agent", type: "Superagent", desc: "Superagent Julien v2" },
  { id: "6a1845e17cc526d1e44965bc", name: "JsInnov-Agent", cat: "agent", type: "Superagent", desc: "Superagent JsInnov" },
  { id: "6a24447757a075f2d198c1e9", name: "Box fla et Js-Innov.IA", cat: "agent", type: "Agent IA", desc: "—" },

  // ─── Ne pas toucher (10) ─────────────────────────────────────────────────
  { id: "691e39377331052edc6a3529", name: "untitled", cat: "locked", type: "Bloqué", desc: "Processing bloqué" },
  { id: "6a1b12811275ee21ab554068", name: "Superagent #1", cat: "locked", type: "Superagent", desc: "Instance multiple" },
  { id: "6a3da927bc6d60d5b874b70f", name: "Superagent #2", cat: "locked", type: "Superagent", desc: "Instance multiple" },
  { id: "6a3a0dd18f96ff07d77dfac9", name: "Superagent #3", cat: "locked", type: "Superagent", desc: "Instance multiple" },
  { id: "6a1b7c27c25b0647242bb711", name: "Superagent #4", cat: "locked", type: "Superagent", desc: "Instance multiple" },
  { id: "6a2fbb077af1ee09563d1041", name: "Superagent #5", cat: "locked", type: "Superagent", desc: "Instance multiple" },
  { id: "6a1a3ac31b08f6ace95e9710", name: "Superagent #6", cat: "locked", type: "Superagent", desc: "Instance multiple" },
  { id: "69ff6bdd433e4de901d9c8f1", name: "JS-Innov.IA Cockpit (Base44)", cat: "locked", type: "App Base44", desc: "Proto cockpit Base44 (doublon)" },
  { id: "698d07cc46b814e05008b085", name: "Social Hub (Copy)", cat: "locked", type: "App Base44", desc: "Hub réseaux sociaux" },
  { id: "69fcda52258a254f4220b0bd", name: "Yanis JY-Trix.AI", cat: "locked", type: "App Base44", desc: "—" },
];

function AppCard({ app }) {
  const cat = APP_CATEGORIES[app.cat];
  const Icon = cat?.icon || Boxes;
  const appUrl = app.url || `https://app.base44.com/apps/${app.id}`;

  return (
    <div className="bg-card rounded-lg border border-border p-4 hover:shadow-md transition-shadow group">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", cat?.color)}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{app.name}</p>
            <p className="text-[10px] text-muted-foreground">{app.type}</p>
          </div>
        </div>
        <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap", cat?.color)}>
          {cat?.label}
        </span>
      </div>

      {app.desc && <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{app.desc}</p>}

      <div className="flex flex-wrap gap-1 mb-2">
        {app.domain && app.domain !== "—" && (
          <Badge variant="outline" className="text-[9px] py-0 px-1.5">{app.domain}</Badge>
        )}
        {app.github && app.github !== "—" && (
          <Badge variant="outline" className="text-[9px] py-0 px-1.5">GH: {app.github}</Badge>
        )}
        {app.entities > 0 && (
          <Badge variant="outline" className="text-[9px] py-0 px-1.5">{app.entities} tables</Badge>
        )}
        {app.client && (
          <Badge variant="outline" className="text-[9px] py-0 px-1.5 text-blue-600">{app.client}</Badge>
        )}
      </div>

      <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button size="sm" variant="outline" className="h-7 text-[11px] px-2" asChild>
          <a href={appUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-3 h-3 mr-1" /> Ouvrir
          </a>
        </Button>
        {app.cat === "vendable" && (
          <Button size="sm" variant="outline" className="h-7 text-[11px] px-2">
            <Settings className="w-3 h-3 mr-1" /> Finaliser
          </Button>
        )}
        {app.cat === "vendable" || app.cat === "agent" ? (
          <Button size="sm" variant="outline" className="h-7 text-[11px] px-2">
            <Link2 className="w-3 h-3 mr-1" /> Connecter
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default function AppsAgents() {
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    if (filter === "all") return APPS;
    return APPS.filter(a => a.cat === filter);
  }, [filter]);

  const counts = useMemo(() => {
    const c = {};
    APPS.forEach(a => { c[a.cat] = (c[a.cat] || 0) + 1; });
    return c;
  }, []);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Apps & Agents"
        subtitle={`${APPS.length} applications Base44, agents IA et superagents`}
      />

      {/* Stats tiles */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {Object.entries(APP_CATEGORIES).map(([key, cat]) => (
          <button
            key={key}
            onClick={() => setFilter(filter === key ? "all" : key)}
            className={cn(
              "rounded-lg border p-3 text-left transition-all hover:shadow-sm",
              filter === key ? "border-primary ring-2 ring-primary/20" : "border-border"
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <cat.icon className={cn("w-4 h-4", cat.color)} />
              <span className="text-lg font-bold">{counts[key] || 0}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">{cat.label}</p>
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <button
          onClick={() => setFilter("all")}
          className={cn("text-xs px-2.5 py-1 rounded-full", filter === "all" ? "bg-primary text-white" : "bg-muted text-muted-foreground")}
        >
          Tout ({APPS.length})
        </button>
        {Object.entries(APP_CATEGORIES).map(([key, cat]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn("text-xs px-2.5 py-1 rounded-full", filter === key ? "bg-primary text-white" : "bg-muted text-muted-foreground")}
          >
            {cat.label} ({counts[key] || 0})
          </button>
        ))}
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(app => <AppCard key={app.id} app={app} />)}
      </div>
    </div>
  );
}
