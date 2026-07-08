import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import StatCard from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Image as ImageIcon, Video, FileText, CheckCircle2, XCircle, Eye, EyeOff,
  Archive, Sparkles, History, Package, AlertTriangle, Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

const typeIcons = { image: ImageIcon, video: Video, document: FileText };

function ScoreBadge({ score }) {
  if (score === null || score === undefined) return <span className="text-xs text-muted-foreground">—</span>;
  const color = score >= 75 ? "text-emerald-600 bg-emerald-500/10" : score >= 50 ? "text-amber-600 bg-amber-500/10" : "text-red-600 bg-red-500/10";
  return <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-md", color)}>{score}/100</span>;
}

// Actions sensibles nécessitant une confirmation explicite
const CONFIRM_ACTIONS = {
  valider: {
    title: "Valider cet Asset ?",
    description: "Le statut passera à 'Validé'. Cette action sera enregistrée avec ton nom dans l'historique.",
  },
  publier: {
    title: "Publier cet Asset dans le Portfolio public ?",
    description: "Il deviendra visible sur le site et dans les vues publiques (PortfolioView). Cette action est irréversible sans une nouvelle intervention manuelle.",
  },
  retirer: {
    title: "Retirer cet Asset du Portfolio public ?",
    description: "Il ne sera plus visible publiquement, mais reste dans la bibliothèque (statut inchangé).",
  },
  archiver: {
    title: "Archiver cet Asset ?",
    description: "Il sera masqué de toutes les vues actives (mais pas supprimé).",
  },
  refuser: {
    title: "Refuser cet Asset ?",
    description: "Il passera en statut 'À retravailler'.",
  },
};

export default function Portfolio() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filterStatut, setFilterStatut] = useState("");
  const [historyAsset, setHistoryAsset] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null); // { type, asset }

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: () => base44.entities.Asset.list("-created_date"),
    staleTime: 15000,
  });

  const { data: history = [] } = useQuery({
    queryKey: ["asset-history", historyAsset?.id],
    queryFn: () => base44.entities.AssetHistory.filter({ asset_id: historyAsset.id }),
    enabled: !!historyAsset,
  });

  const effectuePar = user?.full_name ? `${user.full_name} (via Cockpit)` : "Julien (via Cockpit)";

  const logHistory = async (assetId, action, ancien, nouveau, details) => {
    await base44.entities.AssetHistory.create({
      asset_id: assetId,
      action,
      ancien_statut: ancien,
      nouveau_statut: nouveau,
      details,
      effectue_par: effectuePar,
    });
  };

  const actionMutation = useMutation({
    mutationFn: async ({ type, asset }) => {
      const now = new Date().toISOString();
      if (type === "valider") {
        await base44.entities.Asset.update(asset.id, { statut: "valide", valide_le: now });
        await logHistory(asset.id, "validation", asset.statut, "valide", `Validé manuellement depuis le Cockpit par ${effectuePar}.`);
      } else if (type === "publier") {
        await base44.entities.Asset.update(asset.id, { statut: "publie", portfolio_visible: true, publie_le: now });
        await logHistory(asset.id, "publication", asset.statut, "publie", `Publié manuellement depuis le Cockpit par ${effectuePar}.`);
      } else if (type === "retirer") {
        await base44.entities.Asset.update(asset.id, { portfolio_visible: false });
        await logHistory(asset.id, "modification", asset.statut, asset.statut, `Retiré du Portfolio public par ${effectuePar} (statut inchangé).`);
      } else if (type === "archiver") {
        await base44.entities.Asset.update(asset.id, { statut: "archive", portfolio_visible: false });
        await logHistory(asset.id, "archivage", asset.statut, "archive", `Archivé manuellement depuis le Cockpit par ${effectuePar}.`);
      } else if (type === "refuser") {
        await base44.entities.Asset.update(asset.id, { statut: "a_retravailler" });
        await logHistory(asset.id, "refus", asset.statut, "a_retravailler", `Refusé manuellement depuis le Cockpit par ${effectuePar}.`);
      } else if (type === "analyser") {
        await logHistory(asset.id, "modification", asset.statut, asset.statut, `Demande de ré-analyse IA envoyée par ${effectuePar} depuis le Cockpit (traitée par l'agent Portfolio JS-Innov.IA).`);
      }
    },
    onSuccess: (_, { type }) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-history"] });
      toast({ title: "Action effectuée", description: `${type} appliqué avec succès.` });
      setConfirmAction(null);
    },
    onError: (err) => {
      toast({ title: "Erreur", description: String(err.message || err), variant: "destructive" });
    },
  });

  const filtered = useMemo(() => {
    if (!filterStatut) return assets;
    return assets.filter(a => a.statut === filterStatut);
  }, [assets, filterStatut]);

  const stats = useMemo(() => ({
    total: assets.length,
    enAttente: assets.filter(a => a.statut === "en_attente_validation").length,
    publies: assets.filter(a => a.statut === "publie").length,
    visibles: assets.filter(a => a.portfolio_visible).length,
  }), [assets]);

  const statutOptions = ["", "brouillon", "analyse_ia", "en_attente_validation", "valide", "a_retravailler", "publie", "archive"];

  return (
    <div>
      <PageHeader
        title="Portfolio — Bibliothèque Asset"
        subtitle="Toutes les créations JS-Innov.IA : validation, publication et historique complet"
        actions={
          <select
            value={filterStatut}
            onChange={(e) => setFilterStatut(e.target.value)}
            className="h-8 text-xs border border-border rounded-md px-2 bg-background"
          >
            <option value="">Tous les statuts</option>
            {statutOptions.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard title="Assets total" value={stats.total} icon={Package} color="primary" />
        <StatCard title="En attente de validation" value={stats.enAttente} icon={AlertTriangle} color="warning" />
        <StatCard title="Publiés" value={stats.publies} icon={CheckCircle2} color="success" />
        <StatCard title="Visibles Portfolio" value={stats.visibles} icon={Eye} color="accent" />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">Aucun Asset pour ce filtre.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((asset) => {
            const Icon = typeIcons[asset.type_media] || FileText;
            return (
              <div key={asset.id} className="bg-card rounded-2xl border border-border overflow-hidden card-hover flex flex-col">
                <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
                  {asset.miniature_url ? (
                    <img src={asset.miniature_url} alt={asset.titre} className="w-full h-full object-cover" />
                  ) : (
                    <Icon className="w-8 h-8 text-muted-foreground" />
                  )}
                </div>
                <div className="p-4 flex-1 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground line-clamp-2">{asset.titre || "(sans titre)"}</h3>
                    {asset.portfolio_visible ? (
                      <Eye className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" title="Visible dans le Portfolio public" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" title="Non visible publiquement" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{asset.description || "Pas de description."}</p>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    <StatusBadge status={asset.statut} />
                    {asset.categorie && <Badge variant="outline" className="text-[10px]">{asset.categorie}</Badge>}
                    <ScoreBadge score={asset.score_qualite} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {asset.created_date && format(new Date(asset.created_date), "d MMM yyyy à HH:mm", { locale: fr })} · source: {asset.source || "?"}
                  </p>

                  <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-border">
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setConfirmAction({ type: "analyser", asset })}>
                      <Sparkles className="w-3 h-3 mr-1" /> Ré-analyser
                    </Button>
                    {asset.statut !== "valide" && asset.statut !== "publie" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => setConfirmAction({ type: "valider", asset })}>
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Valider
                      </Button>
                    )}
                    {asset.statut !== "publie" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] text-primary border-primary/30 hover:bg-primary/10" onClick={() => setConfirmAction({ type: "publier", asset })}>
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Publier
                      </Button>
                    )}
                    {asset.portfolio_visible && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setConfirmAction({ type: "retirer", asset })}>
                        <EyeOff className="w-3 h-3 mr-1" /> Retirer
                      </Button>
                    )}
                    {asset.statut !== "a_retravailler" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] text-orange-600 border-orange-200 hover:bg-orange-50" onClick={() => setConfirmAction({ type: "refuser", asset })}>
                        <XCircle className="w-3 h-3 mr-1" /> Refuser
                      </Button>
                    )}
                    {asset.statut !== "archive" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] text-slate-600" onClick={() => setConfirmAction({ type: "archiver", asset })}>
                        <Archive className="w-3 h-3 mr-1" /> Archiver
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setHistoryAsset(asset)}>
                      <History className="w-3 h-3 mr-1" /> Historique
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal historique */}
      <Dialog open={!!historyAsset} onOpenChange={(open) => !open && setHistoryAsset(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Historique — {historyAsset?.titre}</DialogTitle>
            <DialogDescription>Traçabilité complète (AssetHistory)</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {history.length === 0 && <p className="text-xs text-muted-foreground">Aucun historique.</p>}
            {history
              .slice()
              .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
              .map((h) => (
                <div key={h.id} className="border border-border rounded-lg p-3 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">{h.action}</span>
                    <span className="text-muted-foreground">{h.created_date && format(new Date(h.created_date), "d MMM HH:mm", { locale: fr })}</span>
                  </div>
                  {h.ancien_statut && h.nouveau_statut && (
                    <p className="text-muted-foreground mb-1">{h.ancien_statut} → {h.nouveau_statut}</p>
                  )}
                  <p className="text-foreground">{h.details}</p>
                  <p className="text-muted-foreground mt-1 italic">par {h.effectue_par || "?"}</p>
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation actions sensibles */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction && (CONFIRM_ACTIONS[confirmAction.type]?.title || "Confirmer l'action ?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction && (CONFIRM_ACTIONS[confirmAction.type]?.description || "Déclencher une ré-analyse IA de cet Asset.")}
              {confirmAction?.asset && <span className="block mt-2 font-medium text-foreground">Asset : {confirmAction.asset.titre}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionMutation.isPending}
              onClick={() => actionMutation.mutate(confirmAction)}
            >
              {actionMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
