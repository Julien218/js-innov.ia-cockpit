// @ts-nocheck
import React from "react";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import AgentRunStatusBadge from "./AgentRunStatusBadge";

export default function AgentRunActions({ lastRun, onViewRun }) {
  if (!lastRun) return null;
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onViewRun(lastRun.id)} className="inline-flex items-center" title={`Run: ${lastRun.status}`}>
        <AgentRunStatusBadge status={lastRun.status} />
      </button>
      <Button size="icon" variant="ghost" onClick={() => onViewRun(lastRun.id)}
        title="Voir l'exécution" aria-label="Voir l'exécution">
        <Eye className="w-4 h-4" />
      </Button>
    </div>
  );
}
