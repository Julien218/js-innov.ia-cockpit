import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import {
  Send, Bot, FileText, Cpu, ShieldCheck, Shield, ShieldAlert, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const AGENTS = [
  { id: "communication-agent", name: "Communication",   icon: "📧", color: "#06B6D4" },
  { id: "social-media-agent",  name: "Réseaux Sociaux", icon: "📱", color: "#7C3AED" },
  { id: "developer-agent",    name: "Développeur",     icon: "💻", color: "#D4AF37" },
  { id: "billing-agent",       name: "Facturation",    icon: "🧾", color: "#10B981" },
  { id: "sales-agent",         name: "Commercial",     icon: "📊", color: "#F59E0B" },
  { id: "seo-audit-agent",     name: "SEO Audit",      icon: "🔍", color: "#3B82F6" },
  { id: "creative-agent",      name: "Créatif",        icon: "🎨", color: "#EC4899" },
  { id: "general-agent",       name: "Général",        icon: "🤖", color: "#6B7280" },
];

const EXEC_MODES = [
  { value: "prepare_only",     label: "Préparation uniquement", description: "L'agent prépare le résultat sans action externe", icon: Shield,      color: "text-blue-400" },
  { value: "approval_required", label: "Approbation requise",  description: "L'agent prépare puis attend ta validation avant l'action", icon: ShieldCheck, color: "text-amber-400" },
  { value: "autonomous",       label: "Autonome",              description: "L'agent termine automatiquement (tâches autorisées uniquement)", icon: ShieldAlert,  color: "text-emerald-400" },
];

function suggestAgent(task) {
  var text = ((task.titre || "") + " " + (task.description || "") + " " + (task.notes || "")).toLowerCase();
  if (/email|newsletter|messenger|message/.test(text)) return "communication-agent";
  if (/facebook|linkedin|tiktok|post|social|reseau/.test(text)) return "social-media-agent";
  if (/code|bug|fix|deploi|deploy|ci\/cd|pr|github|docker/.test(text)) return "developer-agent";
  if (/facture|devis|invoice|quote|billing|paiement/.test(text)) return "billing-agent";
  if (/lead|prospect|commercial|vente|sale/.test(text)) return "sales-agent";
  if (/seo|referencement|google|audit.*site/.test(text)) return "seo-audit-agent";
  if (/design|branding|logo|creatif|visuel|contenu/.test(text)) return "creative-agent";
  return "general-agent";
}

export default function TaskDispatchModal({ open, onClose, task, isDispatching, onConfirm }) {
  const [agentId, setAgentId] = useState("");
  const [executionMode, setExecutionMode] = useState("approval_required");
  const [instructions, setInstructions] = useState("");

  useMemo(() => {
    if (task) {
      setAgentId(suggestAgent(task));
      setExecutionMode("approval_required");
      setInstructions("");
    }
  }, [task]);

  const selectedAgent = AGENTS.find(a => a.id === agentId);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            Envoyer à un agent IA
          </DialogTitle>
          <DialogDescription>La tâche sera transmise à l'agent sélectionné pour exécution.</DialogDescription>
        </DialogHeader>

        {task && (
          <div className="space-y-4 py-2">
            {/* Résumé tâche */}
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
              <div className="flex items-start gap-2">
                <FileText className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{task.titre}</p>
                  {task.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {task.client_nom && <div><span className="text-muted-foreground">Client :</span> <span className="text-foreground">{task.client_nom}</span></div>}
                {task.projet_nom && <div><span className="text-muted-foreground">Projet :</span> <span className="text-foreground">{task.projet_nom}</span></div>}
                {task.priorite && <div><span className="text-muted-foreground">Priorité :</span> <StatusBadge status={task.priorite} /></div>}
                {task.date_echeance && <div><span className="text-muted-foreground">Échéance :</span> <span className="text-foreground">{new Date(task.date_echeance).toLocaleDateString("fr-BE")}</span></div>}
              </div>
            </div>

            {/* Agent */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Agent IA</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Sélectionner un agent" /></SelectTrigger>
                <SelectContent>
                  {AGENTS.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="mr-2">{a.icon}</span><span className="font-medium">{a.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedAgent && <p className="text-xs text-muted-foreground flex items-center gap-1"><Cpu className="w-3 h-3" /> Suggestion automatique : {selectedAgent.name}</p>}
            </div>

            {/* Autonomie */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Niveau d'autonomie</Label>
              <div className="grid gap-2">
                {EXEC_MODES.map(mode => {
                  var Icon = mode.icon;
                  return (
                    <button key={mode.value} type="button" onClick={() => setExecutionMode(mode.value)}
                      className={cn("flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                        executionMode === mode.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/50")}>
                      <Icon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", mode.color)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{mode.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{mode.description}</p>
                      </div>
                      {executionMode === mode.value && <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Consignes */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Consignes complémentaires</Label>
              <Textarea value={instructions} onChange={e => setInstructions(e.target.value)}
                placeholder="Instructions spécifiques pour l'agent..." className="text-sm resize-none" rows={3} />
            </div>

            {/* Note sécurité */}
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
              <ShieldCheck className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">Les actions sensibles (email, publication, suppression, facture) nécessitent toujours une validation humaine, quel que soit le mode choisi.</p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isDispatching}>Annuler</Button>
          <Button onClick={() => onConfirm({ agentId, executionMode, instructions, attachments: [] })} disabled={!agentId || isDispatching} className="gap-2">
            {isDispatching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {isDispatching ? "Envoi..." : "Envoyer à l'agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
