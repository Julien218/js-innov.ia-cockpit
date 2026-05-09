import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";

export default function PageHeader({ title, subtitle, onAdd, addLabel = "Ajouter", search, onSearch, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div>
        <h1 className="text-xl font-bold text-foreground" style={{fontFamily: "'Space Grotesk', sans-serif"}}>{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {onSearch !== undefined && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Rechercher..."
              value={search || ""}
              onChange={(e) => onSearch(e.target.value)}
              className="pl-8 h-8 text-xs w-48"
            />
          </div>
        )}
        {actions}
        {onAdd && (
          <Button onClick={onAdd} size="sm" className="h-8 gradient-primary border-0 text-white shadow-lg shadow-primary/25 hover:opacity-90 transition-opacity">
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            {addLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
