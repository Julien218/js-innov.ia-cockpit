import React, { useState } from "react";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Clapperboard, Mic, Image, FileText, FolderOpen,
  Send, Plus, Video, Sparkles, Link2,
} from "lucide-react";

const ACTIONS = [
  { label: "Créer prompt vidéo", icon: Video, color: "text-blue-600 bg-blue-500/10" },
  { label: "Créer script voix-off", icon: Mic, color: "text-purple-600 bg-purple-500/10" },
  { label: "Ajouter asset", icon: Plus, color: "text-emerald-600 bg-emerald-500/10" },
  { label: "Lier à client", icon: Link2, color: "text-amber-600 bg-amber-500/10" },
  { label: "Envoyer validation", icon: Send, color: "text-cyan-600 bg-cyan-500/10" },
  { label: "Publier au portfolio", icon: FolderOpen, color: "text-rose-600 bg-rose-500/10" },
];

const CATEGORIES = [
  { label: "Vidéos écran géant", icon: Clapperboard, count: 0, color: "text-blue-600 bg-blue-500/10" },
  { label: "Prompts Grok/Sora/Canva", icon: Sparkles, count: 0, color: "text-purple-600 bg-purple-500/10" },
  { label: "Images générées", icon: Image, count: 0, color: "text-cyan-600 bg-cyan-500/10" },
  { label: "Voix-off", icon: Mic, count: 0, color: "text-amber-600 bg-amber-500/10" },
  { label: "Assets clients", icon: FileText, count: 0, color: "text-emerald-600 bg-emerald-500/10" },
  { label: "Publications réseaux", icon: Send, count: 0, color: "text-rose-600 bg-rose-500/10" },
  { label: "Dossiers portfolio", icon: FolderOpen, count: 0, color: "text-indigo-600 bg-indigo-500/10" },
];

export default function Production() {
  const [activeCat, setActiveCat] = useState(null);

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
              onClick={() => setActiveCat(activeCat === cat.label ? null : cat.label)}
              className={cn(
                "rounded-lg border p-4 text-left transition-all hover:shadow-sm",
                activeCat === cat.label ? "border-primary ring-2 ring-primary/20" : "border-border"
              )}
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

      {/* Zone contenu (placeholder — données statiques pour l'instant) */}
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <Clapperboard className="w-6 h-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">Module Production — Phase statique</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              Les données seront connectées aux entités Asset et aux dossiers Drive une fois l'API intégrée.
              Pour l'instant, cette page centralise les raccourcis d'action.
            </p>
          </div>
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="outline" asChild>
              <a href="/portfolio" className="text-xs">Voir Portfolio</a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href="/automations" className="text-xs">Voir Automatisations</a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
