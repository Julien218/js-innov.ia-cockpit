import React from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Clapperboard, Mic, Image, FileText, FolderOpen,
  Send, Plus, Video, Sparkles, Link2,
} from "lucide-react";

const ACTIONS = [
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
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Production"
        subtitle="Centralisation des créations, prompts, assets et publications"
      />

      {/* Actions rapides */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Actions rapides</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {ACTIONS.map(action => (
            <Button
              key={action.label}
              variant="outline"
              className="h-auto py-3 flex-col gap-2"
              onClick={() => navigate(action.route)}
            >
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", action.color)}>
                <action.icon className="w-4 h-4" />
              </div>
              <span className="text-[11px] font-medium text-center leading-tight">{action.label}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Catégories */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Catégories</p>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {CATEGORIES.map(cat => (
            <button
              key={cat.label}
              onClick={() => navigate(cat.route)}
              className="rounded-lg border border-border p-4 text-left transition-all hover:shadow-sm hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center mb-2", cat.color)}>
                <cat.icon className="w-5 h-5" />
              </div>
              <p className="text-sm font-semibold">{cat.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{cat.count} élément{cat.count > 1 ? "s" : ""}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Hub connecté aux modules existants */}
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Clapperboard className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium">Module Production — Hub fonctionnel</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Les actions rapides et catégories ouvrent maintenant les modules déjà disponibles du Cockpit.
              Les compteurs seront alimentés par les entités de production lors de la prochaine étape de centralisation des données.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 mt-2">
            <Button size="sm" variant="outline" onClick={() => navigate("/video-studio/new")} className="text-xs">
              Ouvrir Video Studio
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate("/portfolio")} className="text-xs">
              Voir Portfolio
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate("/automations")} className="text-xs">
              Voir Automatisations
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
