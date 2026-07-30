// @ts-nocheck
import React, { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Bot, CheckCircle2, XCircle, Ban, AlertCircle, Loader2 } from "lucide-react";
import AgentRunStatusBadge from "./AgentRunStatusBadge";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

export default function AgentRunDetail({ open, onClose, runId, onApprove, onReject, onCancel }) {
  const [run, setRun] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchRun = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/runs/" + runId, { credentials: "include" });
      const data = await res.json();
      if (data.run) { setRun(data.run); setApprovals(data.approvals || []); }
    } catch (e) { console.error("Erreur fetch run:", e); }
    finally { setLoading(false); }
  }, [runId]);

  useMemo(() => { if (open && runId) fetchRun(); }, [open, runId, fetchRun]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            Détail de l'exécution
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : run ? (
          <div className="space-y-4 py-2">
            {/* Statut + date */}
            <div className="flex items-center gap-3">
              <AgentRunStatusBadge status={run.status} />
              <span className="text-xs text-muted-foreground">
                {run.created_at && format(new Date(run.created_at), "d MMM yyyy à HH:mm", { locale: fr })}
              </span>
            </div>

            {/* Agent + mode */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Agent</p><p className="font-medium text-foreground">{run.agent_id}</p></div>
              <div><p className="text-xs text-muted-foreground">Mode</p><p className="font-medium text-foreground">{run.execution_mode}</p></div>
              <div><p className="text-xs text-muted-foreground">Demandé par</p><p className="font-medium text-foreground">{run.requested_by}</p></div>
              <div><p className="text-xs text-muted-foreground">Démarré</p><p className="font-medium text-foreground">{run.started_at ? format(new Date(run.started_at), "d MMM à HH:mm", { locale: fr }) : "—"}</p></div>
            </div>

            {/* Conversation Base44 */}
            {run.base44_conv_id && (
              <div className="text-xs text-muted-foreground">
                Conversation Base44 : <code className="text-foreground">{run.base44_conv_id}</code>
              </div>
            )}

            {/* Demande initiale */}
            {run.input && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Demande initiale</p>
                <pre className="text-xs text-foreground whitespace-pre-wrap font-mono">
                  {JSON.stringify(run.input.task || run.input, null, 2)}
                </pre>
              </div>
            )}

            {/* Instructions */}
            {run.input && run.input.instructions && (
              <div><p className="text-xs text-muted-foreground mb-1">Consignes</p><p className="text-sm text-foreground">{run.input.instructions}</p></div>
            )}

            {/* Erreur */}
            {run.error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-3">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-400">{run.error}</p>
              </div>
            )}

            {/* Résultat */}
            {run.result && Object.keys(run.result).length > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Résultat</p>
                <pre className="text-xs text-foreground whitespace-pre-wrap font-mono">
                  {JSON.stringify(run.result, null, 2)}
                </pre>
              </div>
            )}

            {/* Approbations */}
            {approvals.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Historique des validations</p>
                <div className="space-y-2">
                  {approvals.map(a => (
                    <div key={a.id} className="flex items-center gap-2 text-xs">
                      <span className={cn("px-2 py-0.5 rounded-md font-medium",
                        a.status === "approved" && "bg-emerald-500/10 text-emerald-400",
                        a.status === "rejected" && "bg-red-500/10 text-red-400",
                        a.status === "pending" && "bg-amber-500/10 text-amber-400")}>
                        {a.status}
                      </span>
                      {a.approved_by && <span className="text-muted-foreground">par {a.approved_by}</span>}
                      {a.rejection_reason && <span className="text-red-400">— {a.rejection_reason}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              {run.status === "awaiting_approval" && (
                <>
                  <Button size="sm" className="gap-1.5" onClick={() => onApprove(run.id)}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Valider
                  </Button>
                  <Button size="sm" variant="destructive" className="gap-1.5" onClick={() => onReject(run.id)}>
                    <XCircle className="w-3.5 h-3.5" /> Rejeter
                  </Button>
                </>
              )}
              {["pending", "dispatched", "running", "awaiting_approval"].includes(run.status) && (
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => onCancel(run.id)}>
                  <Ban className="w-3.5 h-3.5" /> Annuler
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">Exécution introuvable.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
