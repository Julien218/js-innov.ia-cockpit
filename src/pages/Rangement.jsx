import React, { useState, useMemo } from "react";
import PageHeader from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PLATFORM_SERVICES } from "@/config/platformServices";
import {
  Boxes, GitBranch, Server, Database, Zap, Globe,
  CheckCircle2, AlertCircle, Clock, Copy, Lock,
} from "lucide-react";

// ─── STATUS HELPERS ────────────────────────────────────────────────────────
const STATUS_STYLES = {
  actif: { label: "Actif", icon: CheckCircle2, color: "text-emerald-600 bg-emerald-500/10" },
  a_finaliser: { label: "À finaliser", icon: AlertCircle, color: "text-amber-600 bg-amber-500/10" },
  prototype: { label: "Prototype", icon: Clock, color: "text-cyan-600 bg-cyan-500/10" },
  doublon: { label: "Doublon", icon: Copy, color: "text-purple-600 bg-purple-500/10" },
  archiver: { label: "À archiver + tard", icon: Clock, color: "text-orange-600 bg-orange-500/10" },
  ne_pas_toucher: { label: "Ne pas toucher", icon: Lock, color: "text-red-600 bg-red-500/10" },
  a_verifier: { label: "À vérifier", icon: AlertCircle, color: "text-blue-600 bg-blue-500/10" },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.a_verifier;
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium", s.color)}>
      <Icon className="w-3 h-3" /> {s.label}
    </span>
  );
}

// ─── DATA: Apps Base44 ─────────────────────────────────────────────────────
const APPS_B44 = [
  { name: "JS-INNOV.IA (Base44)", status: "a_verifier", desc: "Ancienne app / agent — pas le site officiel" },
  { name: "SynergieDour.be", status: "actif", desc: "Annuaire commerçants" },
  { name: "Multi site", status: "actif", desc: "Tour de Dour + mascottes" },
  { name: "Miss DOUR", status: "actif", desc: "Concours" },
  { name: "assurances-dour.be", status: "actif", desc: "Site assurances" },
  { name: "Fashionist'ART", status: "actif", desc: "Événement mode" },
  { name: "JS - AGENT - COCKPIT", status: "actif", desc: "Ce superagent" },
  { name: "Voiced", status: "a_finaliser", desc: "TTS voix IA" },
  { name: "Offre-Devis-Incendie", status: "a_finaliser", desc: "Devis incendie" },
  { name: "AutoDevis", status: "a_finaliser", desc: "Devis auto" },
  { name: "LeadFinder Pro", status: "a_finaliser", desc: "Leads B2B" },
  { name: "ArtisPrint AI", status: "a_finaliser", desc: "Print IA" },
  { name: "QR - By - Js-innov.IA", status: "a_finaliser", desc: "QR design" },
  { name: "AccèsFlow", status: "a_finaliser", desc: "SaaS events" },
  { name: "NexusCore", status: "a_finaliser", desc: "OS cognitif" },
  { name: "villeConnectOs", status: "prototype", desc: "Ville connectée" },
  { name: "Dourconnect2", status: "doublon", desc: "Doublon villeConnectOs?" },
  { name: "Tour de Dour IA", status: "prototype", desc: "IA Dour" },
  { name: "Dour IA", status: "prototype", desc: "IA locale" },
  { name: "AURA", status: "prototype", desc: "Agent IA" },
  { name: "Elara", status: "prototype", desc: "Agent IA" },
  { name: "Kaelo", status: "prototype", desc: "Agent IA" },
  { name: "Lyra", status: "prototype", desc: "Agent IA" },
  { name: "Generateur Video", status: "prototype", desc: "Vidéo mode" },
  { name: "Video Reseaux", status: "prototype", desc: "Vidéo social" },
  { name: "Monteur vidéo", status: "prototype", desc: "Monteur" },
  { name: "Starlight Events", status: "prototype", desc: "ASBL events" },
  { name: "ConnectSocial", status: "prototype", desc: "Réseau social" },
  { name: "PROK 4K", status: "a_verifier", desc: "—" },
  { name: "Agent Js-innov.ia", status: "prototype", desc: "Agent" },
  { name: "Agent Fashionistart", status: "prototype", desc: "Agent" },
  { name: "Agent Miss & Mister Dour", status: "prototype", desc: "Agent" },
  { name: "Agentvideomasvotedour", status: "prototype", desc: "Agent vidéo" },
  { name: "Agent GeneratVideoPro", status: "prototype", desc: "Agent" },
  { name: "Julien AI", status: "doublon", desc: "Superagent (2 instances)" },
  { name: "JsInnov-Agent", status: "prototype", desc: "Superagent" },
  { name: "Js-Innov.IA Creative Director", status: "prototype", desc: "Agent" },
  { name: "Createur Innovent", status: "prototype", desc: "Agent" },
  { name: "Box fla et Js-Innov.IA", status: "a_verifier", desc: "—" },
  { name: "Yanis JY-Trix.AI", status: "a_verifier", desc: "—" },
  { name: "untitled", status: "ne_pas_toucher", desc: "Bloqué processing" },
  { name: "Superagent #1-6", status: "ne_pas_toucher", desc: "6 instances multiples" },
  { name: "JS-Innov.IA Cockpit (B44)", status: "doublon", desc: "Proto cockpit" },
  { name: "Social Hub (Copy)", status: "a_verifier", desc: "Hub social" },
];

// ─── DATA: GitHub repos ────────────────────────────────────────────────────
const GITHUB_REPOS = [
  { name: "js-innov.ia-cockpit", status: "actif", role: "Cockpit Railway", last: "25/07" },
  { name: PLATFORM_SERVICES.publicSite.repository.split('/')[1], status: "actif", role: "Site officiel www.jsinnovia.com · Railway/main", last: "24/08" },
  { name: PLATFORM_SERVICES.signageLegacySite.repository.split('/')[1], status: "actif", role: "Produit Signage sur branche dédiée — pas le site officiel", last: "19/08" },
  { name: "letourdedour-site", status: "actif", role: "Site Tour de Dour", last: "23/07" },
  { name: "oliviertrevis-site", status: "actif", role: "Site Olivier Trevis", last: "21/07" },
  { name: "synergie-dour", status: "actif", role: "App Synergie Dour", last: "11/07" },
  { name: "qr-by-js-innov.ia", status: "a_verifier", role: "App Base44 QR", last: "27/06" },
  { name: "artisprint-ai", status: "a_verifier", role: "App Base44 Print", last: "16/06" },
  { name: "fashionist-art", status: "a_verifier", role: "App Base44 Fashion", last: "14/06" },
  { name: "qr-generator-jsinnovia", status: "a_verifier", role: "QR Railway", last: "07/06" },
  { name: "ADN-Studio-By-Js-Innov.IA", status: "archiver", role: "Inactif", last: "22/05" },
  { name: "miss2026", status: "actif", role: "Miss/Mister Dour", last: "28/05" },
  { name: "jsinnovia-assets-", status: "archiver", role: "Assets statiques", last: "28/05" },
  { name: "APPopensource", status: "a_verifier", role: "—", last: "28/05" },
];

// ─── DATA: Railway services ───────────────────────────────────────────────
const RAILWAY = [
  { name: "cockpit-v3", status: "actif", role: "Cockpit central", supabase: "rzvv" },
  { name: "js-innovia-site", status: "actif", role: "Site officiel www.jsinnovia.com", supabase: "—" },
  { name: "olivier-signage-cockpit", status: "actif", role: "Gestion écran géant séparée", supabase: "—" },
  { name: "olivier-signage-site", status: "a_verifier", role: "Ancienne vitrine technique sans domaine officiel", supabase: "—" },
  { name: "jsinnovia-agent", status: "actif", role: "Proxy data Supabase", supabase: "gfj" },
  { name: "cockpit-prod", status: "archiver", role: "Ancien cockpit (Supabase mort)", supabase: "fng (MORT)" },
  { name: "js-innov-command-center", status: "archiver", role: "Ancien projet (Supabase mort)", supabase: "fng (MORT)" },
  { name: "MySQL", status: "a_verifier", role: "DB interne", supabase: "—" },
];

// ─── DATA: Supabase ────────────────────────────────────────────────────────
const SUPABASE = [
  { name: "rzvvwcwyaddzsaattwqt", status: "actif", role: "Auth cockpit + assets", tables: "cockpit_users, cockpit_sessions" },
  { name: "gfjpryakxzdzwnazlsfz", status: "actif", role: "Business data CRM", tables: "Client, Lead, Projet, Facture, Asset, SystemConfig..." },
  { name: "fngyikpxvggrokqtezia", status: "ne_pas_toucher", role: "Ancien projet mort", tables: "—" },
];

// ─── DATA: Automatisations ─────────────────────────────────────────────────
const AUTOMATIONS = [
  { name: "Sync Leads jsinnovia.com", status: "actif", role: "Daily 07:00 — sync leads" },
  { name: "Agent Portfolio Drive", status: "a_verifier", role: "Google Drive connector — en pause" },
  { name: "TEST auto-publish delay", status: "archiver", role: "Test one-time — archivé" },
];

// ─── DATA: Domaines ────────────────────────────────────────────────────────
const DOMAINS_DATA = [
  { name: "cockpit.jsinnovia.com", status: "actif" },
  { name: "www.jsinnovia.com", status: "actif" },
  { name: "jsinnovia.com (apex TLS/DNS)", status: "a_finaliser" },
  { name: "jsinnovia.store", status: "a_verifier" },
  { name: "assurances-dour.be", status: "actif" },
  { name: "letourdedour.com", status: "a_verifier" },
  { name: "oliviertrevis.be", status: "a_verifier" },
  { name: "synergiedour.be", status: "a_verifier" },
  { name: "missetmisterdour.be", status: "actif" },
  { name: "fashionistartdour.be", status: "a_verifier" },
];

function Section({ icon: Icon, title, items, columns }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <Icon className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1 text-left">{title}</span>
        <span className="text-xs text-muted-foreground">{items.length} items</span>
      </button>
      {expanded && (
        <div className="border-t border-border">
          <div className={cn("grid gap-px bg-border", columns)}>
            {items.map((item, i) => (
              <div key={i} className="bg-card p-3 hover:bg-muted/20 transition-colors">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-xs font-medium truncate">{item.name}</p>
                  <StatusBadge status={item.status} />
                </div>
                {item.desc && <p className="text-[10px] text-muted-foreground truncate">{item.desc}</p>}
                {item.role && <p className="text-[10px] text-muted-foreground">{item.role}</p>}
                {(item.last || item.supabase || item.tables) && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {item.last && <Badge variant="outline" className="text-[9px] py-0 px-1">{item.last}</Badge>}
                    {item.supabase && <Badge variant="outline" className="text-[9px] py-0 px-1">SB: {item.supabase}</Badge>}
                    {item.tables && <Badge variant="outline" className="text-[9px] py-0 px-1">{item.tables}</Badge>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Rangement() {
  const stats = useMemo(() => {
    const all = [...APPS_B44, ...GITHUB_REPOS, ...RAILWAY, ...SUPABASE, ...AUTOMATIONS, ...DOMAINS_DATA];
    const c = {};
    all.forEach(a => { c[a.status] = (c[a.status] || 0) + 1; });
    return c;
  }, []);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <PageHeader
        title="Rangement"
        subtitle="Inventaire administrateur complet — ne rien supprimer, classer uniquement"
      />

      {/* Stats globales */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(STATUS_STYLES).map(([key, s]) => (
          <div key={key} className={cn("rounded-lg px-3 py-1.5 flex items-center gap-2", s.color)}>
            <s.icon className="w-3.5 h-3.5" />
            <span className="text-xs font-semibold">{stats[key] || 0}</span>
            <span className="text-[10px]">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Sections */}
      <Section icon={Boxes} title="Apps Base44" items={APPS_B44} columns="grid-cols-2 md:grid-cols-3 lg:grid-cols-4" />
      <Section icon={GitBranch} title="Repos GitHub" items={GITHUB_REPOS} columns="grid-cols-2 md:grid-cols-3 lg:grid-cols-4" />
      <Section icon={Server} title="Services Railway" items={RAILWAY} columns="grid-cols-2 md:grid-cols-3 lg:grid-cols-5" />
      <Section icon={Database} title="Projets Supabase" items={SUPABASE} columns="grid-cols-1 md:grid-cols-3" />
      <Section icon={Zap} title="Automatisations" items={AUTOMATIONS} columns="grid-cols-1 md:grid-cols-3" />
      <Section icon={Globe} title="Domaines" items={DOMAINS_DATA} columns="grid-cols-2 md:grid-cols-3 lg:grid-cols-5" />

      {/* Note */}
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
        <p className="text-xs text-muted-foreground">
          📋 Cet inventaire est statique (snapshot 25/07/2026). Aucune suppression, aucun archivage — classification uniquement.
          Les statuts seront connectés aux APIs dans une phase ultérieure.
        </p>
      </div>
    </div>
  );
}
