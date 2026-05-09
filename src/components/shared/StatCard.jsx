import React from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

export default function StatCard({ title, value, icon: Icon, trend, trendLabel, color = "primary", subtitle }) {
  const colorMap = {
    primary: { bg: "bg-primary/10", text: "text-primary", glow: "shadow-primary/20" },
    accent:  { bg: "bg-purple-500/10", text: "text-purple-600", glow: "shadow-purple-500/20" },
    success: { bg: "bg-emerald-500/10", text: "text-emerald-600", glow: "shadow-emerald-500/20" },
    warning: { bg: "bg-amber-500/10", text: "text-amber-600", glow: "shadow-amber-500/20" },
    destructive: { bg: "bg-red-500/10", text: "text-red-600", glow: "shadow-red-500/20" },
  };
  const c = colorMap[color] || colorMap.primary;

  return (
    <div className="bg-card rounded-2xl border border-border p-5 card-hover">
      <div className="flex items-start justify-between mb-3">
        <div className={cn("p-2.5 rounded-xl", c.bg)}>
          <Icon className={cn("w-4 h-4", c.text)} />
        </div>
        {trend !== undefined && (
          <div className={cn("flex items-center gap-1 text-xs font-medium", trend >= 0 ? "text-emerald-600" : "text-red-500")}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-foreground" style={{fontFamily: "'Space Grotesk', sans-serif"}}>{value}</p>
      <p className="text-xs font-medium text-muted-foreground mt-1">{title}</p>
      {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  );
}
