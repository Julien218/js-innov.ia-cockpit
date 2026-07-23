import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Pause, Play, ShieldAlert, ShieldCheck, Activity, Folder, Loader2, AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

const DECISION_LABELS = {
  manuel_en_attente: { label: "Manuel — en attente", color: "bg-blue-500/10 text-blue-600" },
  auto_publish_eligible: { label: "Éligible auto-publish", color: "bg-purple-500/10 text-purple-600" },
  auto_publish_bloque: { label: "Auto-publish bloqué (verrou global)", color: "bg-amber-500/10 text-amber-600" },
  publie: { label: "Publié (auto)", color: "bg-emerald-500/10 text-emerald-600" },
  annule: { label: "Annulé par Julien", color: "bg-red-500/10 text-red-600" },
};

export default function Automations() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [confirmReactivateRequest, setConfirmReactivateRequest] = useState(false);

  const { data: configRows = [], isLoading: loadingConfig, isError: errorConfig, refetch: refetchConfig } = useQuery({
    queryKey: ["system-config"],
    queryFn: () => base44.entities.SystemConfig.list(),
    staleTime: 10000,
  });

  const { data: audit = [], isLoading: loadingAudit, isError: errorAudit, refetch: refetchAudit } = useQuery({
    queryKey: ["automation-audit"],
    queryFn: () => base44.entities.AutomationAudit.list("-created_at"),
    staleTime: 10000,
  });

  const autoPublishConfig = configRows.find(c => c.key === "AUTO_PUBLISH_ENABLED");
  const autoPublishEnabled = autoPublishConfig?.value === "true";

  const effectuePar = user?.full_name ? `${user.full_name} (via Cockpit)` : "Julien (via Cockpit)";

  const toggleMutation = useMutation({
    mutationFn: async () => {
      const newValue = autoPublishEnabled ? "false" : "true";
      if (autoPublishConfig) {
        await base44.entities.SystemConfig.update(autoPublishConfig.id, {
          value: newValue,
          updated_by: effectuePar,
          updated_at: new Date().toISOString(),
        });
      } else {
        await base44.entities.SystemConfig.create({
          key: "AUTO_PUBLISH_ENABLED",
          value: newValue,
          description: "Interrupteur global — si false, aucune publication automatique n'a lieu même dans le dossier encadré.",
          updated_by: effectuePar,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-config"] });
      toast({ title: "Verrou mis à jour", description: "AUTO_PUBLISH_ENABLED a été modifié." });
      setConfirmToggle(false);
    },
    onError: (err) => toast({ title: "Erreur", description: String(err.message || err), variant: "destructive" }),
  });

  const requestReactivateMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.AutomationAudit.create({
        dossier: "01_A_VALIDER + 02_PORTFOLIO_AUTO_PUBLISH",
        decision: "reactivation_demandee",
        details: `Demande de réactivation de l'automation Drive envoyée depuis le Cockpit par ${effectuePar}. Nécessite confirmation explicite de Julien directement dans la conversation avec l'agent avant toute réactivation réelle.`,
        workflow_version: "v1.0.0",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automation-audit"] });
      toast({ title: "Demande envoyée", description: "L'agent verra cette demande, mais la réactivation nécessite toujours ta confirmation explicite dans le chat." });
      setConfirmReactivateRequest(false);
    },
    onError: (err) => toast({ title: "Erreur", description: String(err.message || err), variant: "destructive" }),
  });

  return (
    <div>
      <PageHeader
        title="Automations — Pipeline Portfolio"
        subtitle="Statut de l'automation Drive, verrou global de publication et audit complet"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Statut automation Drive */}
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Automation Drive — détection</h3>
          </div>
          <div className="flex items-center gap-2 mb-4">
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
              <Pause className="w-3 h-3 mr-1" /> En pause
            </Badge>
            <span className="text-xs text-muted-foreground">Aucune détection automatique en cours</span>
          </div>
          <div className="flex items-start gap-2 bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground mb-3">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <p>Pour des raisons de sécurité (incident du 2026-07-07), la réactivation de cette automation nécessite une confirmation explicite de Julien directement dans la conversation avec l'agent. Ce bouton envoie uniquement une <strong>demande</strong> — il ne réactive rien lui-même.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setConfirmReactivateRequest(true)} disabled={requestReactivateMutation.isPending}>
            <Play className="w-3.5 h-3.5 mr-1.5" /> Demander la réactivation
          </Button>

          <div className="mt-4 pt-4 border-t border-border space-y-1.5 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5"><Folder className="w-3 h-3" /> 01_A_VALIDER — pipeline manuel strict</p>
            <p className="flex items-center gap-1.5"><Folder className="w-3 h-3" /> 02_PORTFOLIO_AUTO_PUBLISH — auto-publish encadré</p>
          </div>
        </div>

        {/* Verrou global AUTO_PUBLISH_ENABLED */}
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center gap-2 mb-3">
            {autoPublishEnabled ? <ShieldAlert className="w-4 h-4 text-red-500" /> : <ShieldCheck className="w-4 h-4 text-emerald-600" />}
            <h3 className="text-sm font-semibold">Verrou global — AUTO_PUBLISH_ENABLED</h3>
          </div>
          {loadingConfig ? (
            <div className="flex items-center text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> Chargement...</div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-3">
                <Switch checked={autoPublishEnabled} onCheckedChange={() => setConfirmToggle(true)} />
                <span className={cn("text-sm font-medium", autoPublishEnabled ? "text-red-600" : "text-emerald-600")}>
                  {autoPublishEnabled ? "ACTIVÉ — publication automatique possible" : "DÉSACTIVÉ — aucune publication automatique, quel que soit le résultat des checks"}
                </span>
              </div>
              {errorConfig && (
                <div className="flex items-center gap-2 bg-red-500/10 rounded-lg p-3 text-xs text-red-600 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Erreur de connexion à SystemConfig. <button onClick={refetchConfig} className="underline ml-1">Réessayer</button></span>
                </div>
              )}
              {!errorConfig && !configRows.length && (
                <p className="text-xs text-amber-600 bg-amber-500/10 rounded-lg p-2">⚠️ Table SystemConfig introuvable ou vide — le SQL de production doit être exécuté dans Supabase.</p>
              )}
              <p className="text-xs text-muted-foreground">
                Ce flag est le coupe-circuit ultime : même si un Asset du dossier encadré passe tous les checks (score, visages, OCR), aucune publication réelle n'aura lieu tant que ce verrou est désactivé.
              </p>
            </>
          )}
        </div>
      </div>

      {/* AutomationAudit */}
      <div className="bg-card rounded-2xl border border-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Historique d'audit (AutomationAudit)</h3>
        </div>
        {loadingAudit ? (
          <div className="flex items-center text-xs text-muted-foreground py-6"><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> Chargement...</div>
        ) : audit.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Aucune entrée d'audit pour le moment (normal si le SQL n'a pas encore été exécuté ou si l'automation n'a pas encore tourné).</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Dossier</th>
                  <th className="py-2 pr-3">Décision</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Version</th>
                  <th className="py-2">Détails</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => {
                  const d = DECISION_LABELS[a.decision] || { label: a.decision, color: "bg-muted text-muted-foreground" };
                  return (
                    <tr key={a.id} className="border-b border-border/50">
                      <td className="py-2 pr-3 whitespace-nowrap">{a.created_at && format(new Date(a.created_at), "d MMM HH:mm", { locale: fr })}</td>
                      <td className="py-2 pr-3">{a.dossier}</td>
                      <td className="py-2 pr-3"><Badge variant="outline" className={cn("text-[10px]", d.color)}>{d.label}</Badge></td>
                      <td className="py-2 pr-3">{a.score_qualite ?? "—"}</td>
                      <td className="py-2 pr-3">{a.workflow_version || "—"}</td>
                      <td className="py-2 text-muted-foreground max-w-xs truncate" title={a.details}>{a.details}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmations */}
      <AlertDialog open={confirmToggle} onOpenChange={setConfirmToggle}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{autoPublishEnabled ? "Désactiver" : "Activer"} AUTO_PUBLISH_ENABLED ?</AlertDialogTitle>
            <AlertDialogDescription>
              {autoPublishEnabled
                ? "Cela bloquera immédiatement toute publication automatique, même pour les Assets déjà éligibles."
                : "⚠️ Cela autorisera le pipeline à publier automatiquement des Assets du dossier 02_PORTFOLIO_AUTO_PUBLISH qui passent tous les checks de sécurité, après le délai de 10 minutes. Assure-toi que le workflow a été validé avant d'activer ce mode."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction disabled={toggleMutation.isPending} onClick={() => toggleMutation.mutate()}>
              {toggleMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmReactivateRequest} onOpenChange={setConfirmReactivateRequest}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Demander la réactivation de l'automation Drive ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cela enregistre ta demande dans l'audit. La réactivation réelle nécessite toujours une confirmation explicite de ta part directement dans la conversation avec l'agent — ce bouton ne réactive rien automatiquement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction disabled={requestReactivateMutation.isPending} onClick={() => requestReactivateMutation.mutate()}>
              {requestReactivateMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
              Confirmer la demande
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
