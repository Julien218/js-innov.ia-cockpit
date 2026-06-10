import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, Target, FolderKanban,
  FileText, Receipt, Shield, ChevronLeft, ChevronRight,
  CheckSquare, MessageSquare, Package, Zap, ShieldCheck, Activity, Bot, Network
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

const useValidationsBadge = () => {
  const { data = [] } = useQuery({
    queryKey: ["validations"],
    queryFn: () => base44.entities.Validation.list(),
    staleTime: 30000,
  });
  return data.filter(v => v.statut === "en_attente").length;
};

const useDemandeBadge = () => {
  const { data = [] } = useQuery({
    queryKey: ["demandes"],
    queryFn: () => base44.entities.Demande.list(),
    staleTime: 30000,
  });
  return data.filter(d => d.statut === "ouverte").length;
};

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const validationCount = useValidationsBadge();
  const demandeCount = useDemandeBadge();

  const navGroups = [
    {
      label: "Vue générale",
      items: [
        { label: "Tableau de bord", icon: LayoutDashboard, path: "/" },
      ]
    },
    {
      label: "CRM",
      items: [
        { label: "Clients", icon: Users, path: "/clients" },
        { label: "Leads", icon: Target, path: "/leads" },
      ]
    },
    {
      label: "Opérations",
      items: [
        { label: "Projets", icon: FolderKanban, path: "/projets" },
        { label: "Tâches", icon: CheckSquare, path: "/taches" },
        { label: "Demandes", icon: MessageSquare, path: "/demandes", badge: demandeCount },
      ]
    },
    {
      label: "Finance",
      items: [
        { label: "Devis", icon: FileText, path: "/devis" },
        { label: "Factures", icon: Receipt, path: "/factures" },
        { label: "Commissions", icon: Shield, path: "/commissions" },
      ]
    },
    {
      label: "IA & Contrôle",
      items: [
        { label: "Julien AI", icon: Bot, path: "/agent" },
        { label: "Agents IA", icon: Network, path: "/agents-ia" },
        { label: "Validations", icon: ShieldCheck, path: "/validations", badge: validationCount },
        { label: "Journal", icon: Activity, path: "/logs" },
      ]
    },
    {
      label: "Catalogue",
      items: [
        { label: "Services", icon: Package, path: "/services" },
      ]
    }
  ];

  return (
    <aside className={cn(
      "relative flex flex-col h-screen bg-white border-r border-border transition-all duration-300 ease-in-out z-30",
      collapsed ? "w-[68px]" : "w-[240px]"
    )}>
      {/* Logo */}
      <div className={cn("flex items-center gap-3 px-4 py-4 border-b border-border", collapsed && "justify-center px-2")}>
        <div className="flex-shrink-0 w-9 h-9 rounded-xl overflow-hidden shadow-lg">
          <img src="/logo.png" alt="JS-Innov.IA" className="w-full h-full object-cover" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <p className="text-sm font-bold text-foreground leading-tight" style={{fontFamily: "'Space Grotesk', sans-serif"}}>JS-Innov.IA</p>
            <p className="text-[10px] text-muted-foreground font-medium tracking-wide">COCKPIT</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 mb-2">
                {group.label}
              </p>
            )}
            {group.items.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "sidebar-item mb-0.5 relative",
                    collapsed ? "justify-center px-0 py-2.5" : "",
                    active
                      ? "bg-primary text-white shadow-lg shadow-primary/25"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <item.icon className={cn("flex-shrink-0", collapsed ? "w-5 h-5" : "w-4 h-4")} />
                  {!collapsed && <span className="flex-1">{item.label}</span>}
                  {item.badge > 0 && (
                    <span className={cn(
                      "flex-shrink-0 text-[10px] font-bold rounded-full flex items-center justify-center",
                      collapsed ? "absolute top-1 right-1 w-4 h-4" : "w-5 h-5",
                      active ? "bg-white/20 text-white" : "bg-primary text-white"
                    )}>
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="px-3 py-3 border-t border-border">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-muted/50">
            <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 shadow">
              <img src="/logo.png" alt="JP" className="w-full h-full object-cover" />
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-semibold text-foreground truncate">Julien Pagin</p>
              <p className="text-[10px] text-muted-foreground truncate">JS-Innov.IA</p>
            </div>
          </div>
        </div>
      )}

      {/* Toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 bg-white border border-border rounded-full flex items-center justify-center shadow-md hover:bg-primary hover:text-white hover:border-primary transition-all duration-200 z-10"
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </button>
    </aside>
  );
}