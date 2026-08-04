// @ts-nocheck
import React from "react";
import { Button } from "@/components/ui/button";
import { Send, Loader2 } from "lucide-react";

export default function TaskDispatchButton({ task, isDispatching, onDispatch, disabled }) {
  if (!task || task.statut === "termine" || task.statut === "annule") return null;
  return (
    <Button
      size="icon"
      variant="ghost"
      className="text-primary hover:text-primary"
      onClick={onDispatch}
      disabled={disabled || isDispatching}
      title="Envoyer à l'agent"
      aria-label="Envoyer à l'agent"
    >
      {isDispatching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
    </Button>
  );
}
