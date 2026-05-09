import React from "react";
import { cn } from "@/lib/utils";

export default function StatCard({ title, value, icon: Icon, trend, trendLabel, color = "primary" }) {
  const colorMap = {
    primary: "bg-primary/10 text-primary",
    accent: "bg-accent/10 text-accent",
    success: "bg-emerald-500/10 text-emerald-600",
    warning: "bg-amber-500/10 text-amber-600",
    destructive: "bg-destructive/10 text-destructive",
  };

  return (
    <div className="bg-card rounded-xl border border-border p-5 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          {trend !== undefined && (
            <p className={cn("text-xs font-medium", trend >= 0 ? "text-emerald-600" : "text-destructive")}>
              {trend >= 0 ? "+" : ""}{trend}% {trendLabel}
            </p>
          )}
        </div>
        <div className={cn("p-3 rounded-xl", colorMap[color])}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}