import React from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Clapperboard, Mic, Image, FileText, FolderOpen,
  Send, Plus, Video, Sparkles, Link2, MonitorPlay, ArrowRight, PlayCircle, Cpu,
} from "lucide-react";

const ACTIONS = [
  { label: "Fabrique vidéo Grok / Sora", icon: Sparkles, color: "text-primary bg-primary/10", route: "/video-factory-api" },
  { label: "Fabrique vidéo locale", icon: Cpu, color: "text-emerald-600 bg-emerald-500/10", route: "/video-factory-local" },
  { label: "Piloter écran géant", icon: MonitorPlay, color: "text-cyan-600 bg-cyan-500/10", route: "/ecran-geant" },
  { label: "Créer prompt vidéo", icon: Video, color: "text-blue-600 bg-blue-500/10", route: "/video-studio/new" },
  { label: "Créer script voix-off", icon: Mic, color: "text-purple-600 bg-purple-500/10", route: "/ai-video" },
  { label: "Ajouter asset", icon: Plus, color: "text-emerald-600 bg-emerald-500/10", route: "/documents" },
  { label: "Lier à client", icon: Link2, color: "text-amber-600 bg-amber-500/10", route: "/clients" },
  { label: "Envoyer validation", icon: Send, color: "text-cyan-600 bg-cyan-500/10", route: "/validations" },
  { label: "Publier au portfolio", icon: FolderOpen, color: "text-rose-600 bg-rose-500/10", route: "/portfolio" },
];

const CATEGORIES = [
  { label: "Vidéos écran géant", icon: Clapperboard, count: 0, color: "text-blue-600 bg-blue-500/10", route: "/exported-videos" },
  { label: "Prompts Grok/Sora/Canva", icon: Sparkles, count: 0, color: "text-purple-600 bg-purple-500/10", route: "/templates" },
  { label: "Images générées", icon: Image, count: 0, color: "text-cyan-600 bg-cyan-500/10", route: "/thumbnail" },
  { label: "Voix-off", icon: Mic, count: 0, color: "text-amber-600 bg-amber-500/10", route: "/ai-video" },
  { label: "Assets clients", icon: FileText, count: 0, color: "text-emerald-600 bg-emerald-500/10", route: "/documents" },
  { label: "Publications réseaux", icon: Send, count: 0, color: "text-rose-600 bg-rose-500/10", route: "/automations" },
  { label: "Dossiers portfolio", icon: FolderOpen, count: 0, color: "text-indigo-600 bg-indigo-500/10", route: "/portfolio" },
];

export default function Production() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Production"
        subtitle="Créer, reprendre et livrer sans chercher le bon module"
      />

      <section className="workspace-hero overflow-hidden">
        <div className="relative z-10 grid gap-5 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              <Clapperboard className="h-3.5 w-3.5" /> Atelier JS-Innov.IA
            </div>
            <h2 className="text-2xl font-semibold sm:text-3xl">Que veux-tu produire maintenant ?</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              La fabrique choisit Grok ou Sora, rattache chaque coût au client, puis vérifie et archive automatiquement le MP4 et sa fiche JSON.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => navigate("/video-factory-api")} className="production-primary-card group sm:col-span-2">
              <span className="production-primary-icon text-primary"><Sparkles className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1 text-left">
                <strong className="block text-sm">Créer une vidéo avec Grok ou Sora</strong>
                <span className="mt-0.5 block text-xs text-muted-foreground">8 secondes · coût client · métadonnées · Dropbox</span>
              </span>
              <ArrowRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-1" />
            </button>
            <button type="button" onClick={() => navigate("/video-factory-local")} className="production-primary-card group">
              <span className="production-primary-icon text-emerald-300"><Cpu className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1 text-left">
                <strong className="block text-sm">Fabrique locale</strong>
                <span className="mt-0.5 block text-xs text-muted-foreground">ComfyUI · sans coût API</span>
              </span>
              <ArrowRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-1" />
            </button>
            <button type="button" onClick={() => navigate("/ecran-geant")} className="production-primary-card group">
              <span className="production-primary-icon text-cyan-300"><MonitorPlay className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1 text-left">
                <strong className="block text-sm">Piloter l’écran géant</strong>
                <span className="mt-0.5 block text-xs text-muted-foreground">Contenus, diffusion et aperçu</span>
              </span>
              <ArrowRight className="h-4 w-4 text-cyan-300 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        </div>
      </section>

      {/* Actions rapides */}
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="workspace-eyebrow">Raccourcis</p>
            <h2 className="text-base font-semibold">Continuer le travail</h2>
          </div>
          <span className="text-xs text-muted-foreground">5 outils</span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {ACTIONS.slice(2).map(action => (
            <button
              type="button"
              key={action.label}
              className="workspace-card group flex min-h-[108px] flex-col items-start justify-between p-3 text-left"
              onClick={() => navigate(action.route)}
            >
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", action.color)}>
                <action.icon className="w-4 h-4" />
              </div>
              <span className="text-xs font-medium leading-tight group-hover:text-primary">{action.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Catégories */}
      <section>
        <div className="mb-3">
          <p className="workspace-eyebrow">Bibliothèque</p>
          <h2 className="text-base font-semibold">Retrouver les créations</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {CATEGORIES.map(cat => (
            <button
              type="button"
              key={cat.label}
              onClick={() => navigate(cat.route)}
              className="workspace-card p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-3", cat.color)}>
                <cat.icon className="w-4 h-4" />
              </div>
              <p className="text-xs font-semibold leading-tight">{cat.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{cat.count} élément{cat.count > 1 ? "s" : ""}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Hub connecté aux modules existants */}
      <div className="workspace-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="workspace-metric-icon text-primary"><PlayCircle className="w-4 h-4" /></div>
          <div>
            <p className="text-sm font-medium">Besoin d’une vue d’ensemble ?</p>
            <p className="text-xs text-muted-foreground">Le portfolio rassemble les livrables prêts à montrer ou valider.</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => navigate("/portfolio")} className="text-xs">
          Ouvrir le portfolio <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
