// @ts-nocheck
import React from "react";
import { Clock, Send, Loader2, ShieldCheck, CheckCircle2, XCircle, Ban, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_CONFIG = {
  pending:           { label: "En attente",   icon: Clock,        color: "text-muted-foreground bg-muted" },
  dispatching:       { label: "Envoi...",     icon: Zap,          color: "text-blue-400 bg-blue-500/10" },
  dispatched:        { label: "Envoyée",      icon: Send,         color: "text-blue-400 bg-blue-500/10" },
  running:           { label: "En cours",     icon: Loader2,      color: "text-amber-400 bg-amber-500/10" },
  awaiting_approval: { label: "À valider",   icon: ShieldCheck,  color: "text-amber-400 bg-amber-500/10" },
  completed:         { label: "Terminée",     icon: CheckCircle2, color: "text-emerald-400 bg-emerald-500/10" },
  failed:            { label: "Échec",        icon: XCircle,      color: "text-red-400 bg-red-500/10" },
  cancelled:         { label: "Annulée",      icon: Ban,          color: "text-muted-foreground bg-muted" },
};

export default function AgentRunStatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md", config.color)}>
      <Icon className={cn("w-3 h-3", (status === "running" || status === "dispatching") && "animate-spin")} />
      {config.label}
    </span>
  );
}
