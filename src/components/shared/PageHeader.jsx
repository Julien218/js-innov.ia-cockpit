import React from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function PageHeader({ title, subtitle, onAdd, addLabel = "Ajouter" }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {onAdd && (
        <Button onClick={onAdd} className="gap-2 shadow-lg shadow-primary/20">
          <Plus className="w-4 h-4" />
          {addLabel}
        </Button>
      )}
    </div>
  );
}