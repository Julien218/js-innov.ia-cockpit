import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorState({ title = "Erreur de chargement", message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="bg-red-500/10 rounded-full p-4 mb-4">
        <AlertTriangle className="w-8 h-8 text-red-500" />
      </div>
      <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
      {message && (
        <p className="text-xs text-muted-foreground max-w-sm mb-4">{message}</p>
      )}
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" /> Réessayer
        </Button>
      )}
    </div>
  );
}
