import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Target, FolderKanban,
  FileText, Receipt, Shield, ChevronLeft, ChevronRight,
  CheckSquare, MessageSquare, Package, Zap, ShieldCheck, Activity,
  Bot, Network, UserPlus, LogOut, Crown, Briefcase, User, Store, Settings, Handshake
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { usePermissions } from "@/lib/usePermissions";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/roles";

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

const ROLE_ICONS = {
  superadmin: Crown,
  admin: Shield,
  collaborateur: Briefcase,
  client: User,
};

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { role, canAccess } = usePermissions();
  const validationCount = useValidationsBadge();
  const demandeCount = useDemandeBadge();

  const colors = ROLE_COLORS[role] || ROLE_COLORS.client;
  const RoleIcon = ROLE_ICONS[role] || User;

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  // Définition de TOUTES les routes avec leur rôle minimum requis
  const allNavGroups = [
    {
      label: "Vue générale",
      items: [
        { label: "Tableau de bord", icon: LayoutDashboard, path: "/" },
      ]
    },
    {
      label: "CRM",
      minRole: "collaborateur",
      items: [
        { label: "Clients", icon: Users, path: "/clients", minRole: "collaborateur" },
        { label: "Leads", icon: Target, path: "/leads", minRole: "collaborateur" },
      ]
    },
    {
      label: "Opérations",
      items: [
        { label: "Projets", icon: FolderKanban, path: role === "client" ? "/mes-projets" : "/projets" },
        { label: "Tâches", icon: CheckSquare, path: "/taches", minRole: "collaborateur" },
        { label: "Demandes", icon: MessageSquare, path: "/demandes", badge: demandeCount },
        { label: "Partenariat JY-Trix", icon: Handshake, path: "/partenariat-jytrix", minRole: "collaborateur" },
      ]
    },
    {
      label: "Finance",
      minRole: "admin",
      items: [
        { label: "Devis", icon: FileText, path: role === "client" ? "/mes-devis" : "/devis" },
        { label: "Factures", icon: Receipt, path: role === "client" ? "/mes-factures" : "/factures" },
        { label: "Commissions", icon: Shield, path: "/commissions", minRole: "admin" },
      ]
    },
    {
      label: "IA & Contrôle",
      items: [
        { label: "Julien AI", icon: Bot, path: "/agent", minRole: "collaborateur" },
        { label: "Agents IA", icon: Network, path: "/agents-ia" },
        { label: "Validations", icon: ShieldCheck, path: "/validations", badge: validationCount, minRole: "admin" },
        { label: "Journal", icon: Activity, path: "/logs", minRole: "superadmin" },
      ]
    },
    {
      label: "Équipe",
      minRole: "admin",
      items: [
        { label: "Invitations", icon: UserPlus, path: "/invitations", minRole: "admin" },
      ]
    },
    {
      label: "VilleConnect",
      minRole: "collaborateur",
      items: [
        { label: "Commerçants", icon: Store, path: "/commercants", minRole: "collaborateur" },
      ]
    },
    {
      label: "Catalogue",
      minRole: "admin",
      items: [
        { label: "Services", icon: Package, path: "/services", minRole: "admin" },
      ]
    },
    {
      label: "Système",
      minRole: "admin",
      items: [
        { label: "Paramètres", icon: Settings, path: "/parametres", minRole: "admin" },
      ]
    }
  ];

  // Filtrer les groupes et items selon les permissions
  const navGroups = allNavGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item => canAccess(item.path))
    }))
    .filter(group => group.items.length > 0);

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

      {/* Badge rôle */}
      {!collapsed && (
        <div className="mx-3 mt-3 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
          style={{ backgroundColor: colors.badge + "15" }}>
          <RoleIcon className="w-3 h-3 flex-shrink-0" style={{ color: colors.badge }} />
          <span className="text-[10px] font-semibold" style={{ color: colors.badge }}>
            {ROLE_LABELS[role]}
          </span>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-3">
            {!collapsed && (
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 mb-1.5">
                {group.label}
              </p>
            )}
            {group.items.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link key={item.path} to={item.path}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "sidebar-item mb-0.5 relative",
                    collapsed ? "justify-center px-0 py-2.5" : "",
                    active
                      ? "bg-primary text-white shadow-lg shadow-primary/25"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}>
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

      {/* Footer utilisateur */}
      <div className="border-t border-border">
        {!collapsed ? (
          <div className="p-3">
            <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-muted/50">
              <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 shadow ring-2"
                style={{ ringColor: colors.badge }}>
                <img src="/logo.png" alt={user?.full_name} className="w-full h-full object-cover" />
              </div>
              <div className="overflow-hidden flex-1">
                <p className="text-xs font-semibold text-foreground truncate">{user?.full_name || "Utilisateur"}</p>
                <p className="text-[10px] text-muted-foreground truncate">{user?.email}</p>
              </div>
              <button onClick={handleLogout} title="Déconnexion"
                className="p-1 rounded hover:bg-red-50 hover:text-red-500 text-muted-foreground transition-colors">
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <button onClick={handleLogout}
            className="w-full p-3 flex justify-center hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
            title="Déconnexion">
            <LogOut className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Toggle */}
      <button onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 bg-white border border-border rounded-full flex items-center justify-center shadow-md hover:bg-primary hover:text-white hover:border-primary transition-all duration-200 z-10">
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </button>
    </aside>
  );
}