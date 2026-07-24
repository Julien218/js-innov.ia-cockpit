import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Target, FolderKanban,
  FileText, Receipt, ChevronLeft, ChevronRight, X,
  CheckSquare, MessageSquare, Shield,
  Bot, Network, LogOut, Crown, Briefcase, User,
  Settings, Mail, Clapperboard, Globe, FolderTree, Boxes,
  PlayCircle, GalleryHorizontalEnd,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { usePermissions } from "@/lib/usePermissions";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/roles";
import { AGENT_KEY } from '@/config/agent';

const useValidationsBadge = () => {
  const { data = [] } = useQuery({
    queryKey: ["validations"],
    queryFn: () => base44.entities.Validation.list(),
    staleTime: 30000,
  });
  return data.filter(v => v.statut === "en_attente").length;
};

const useEmailBadge = () => {
  const [unread, setUnread] = React.useState(0);
  const apiKey = AGENT_KEY;
  React.useEffect(() => {
    if (!apiKey) return;
    const poll = () => {
      fetch('/api/emails?limit=1', { headers: { 'x-agent-key': apiKey } })
        .then(r => r.ok ? r.json() : { unread: 0 })
        .then(d => setUnread(d.unread || 0))
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 120000);
    return () => clearInterval(interval);
  }, [apiKey]);
  return unread;
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

// ─── MENU PRINCIPAL v2 — 16 items ───────────────────────────────────────────
const allNavGroups = [
  {
    label: "Pilotage",
    items: [
      { label: "Accueil", icon: LayoutDashboard, path: "/" },
    ]
  },
  {
    label: "CRM",
    minRole: "collaborateur",
    items: [
      { label: "Clients", icon: Users, path: "/clients", minRole: "collaborateur" },
      { label: "Leads", icon: Target, path: "/leads", minRole: "collaborateur" },
      { label: "Demandes", icon: MessageSquare, path: "/demandes", badge: "demandes" },
    ]
  },
  {
    label: "Projets",
    items: [
      { label: "Projets", icon: FolderKanban, path: "/projets" },
      { label: "Tâches", icon: CheckSquare, path: "/taches", minRole: "collaborateur" },
    ]
  },
  {
    label: "Finance",
    minRole: "admin",
    items: [
      { label: "Devis", icon: FileText, path: "/devis" },
      { label: "Factures", icon: Receipt, path: "/factures" },
    ]
  },
  {
    label: "Communication",
    minRole: "admin",
    items: [
      { label: "Emails", icon: Mail, path: "/emails", badge: "emails", minRole: "admin" },
    ]
  },
  {
    label: "Studio",
    minRole: "admin",
    items: [
      { label: "Production", icon: Clapperboard, path: "/production", minRole: "admin" },
      { label: "Portfolio", icon: GalleryHorizontalEnd, path: "/portfolio", minRole: "admin" },
    ]
  },
  {
    label: "Écosystème",
    minRole: "admin",
    items: [
      { label: "Apps & Agents", icon: Boxes, path: "/apps-agents", minRole: "admin" },
      { label: "Automatisations", icon: PlayCircle, path: "/automations", minRole: "admin" },
      { label: "Domaines", icon: Globe, path: "/domaines", minRole: "admin" },
      { label: "Rangement", icon: FolderTree, path: "/rangement", minRole: "admin" },
    ]
  },
  {
    label: "IA & Système",
    items: [
      { label: "Julien AI", icon: Bot, path: "/agent", minRole: "collaborateur" },
      { label: "Agents IA", icon: Network, path: "/agents-ia" },
      { label: "Paramètres", icon: Settings, path: "/parametres", minRole: "admin" },
    ]
  },
];

export default function Sidebar({ mobileOpen = false, onCloseMobile }) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { role, isSuperAdmin, isAdmin, canAccess } = usePermissions();
  const validationCount = useValidationsBadge();
  const emailCount = useEmailBadge();
  const demandeCount = useDemandeBadge();

  const colors = ROLE_COLORS[role] || ROLE_COLORS.client;
  const RoleIcon = ROLE_ICONS[role] || User;

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const getPath = (item) => {
    if (role === "client") {
      if (item.path === "/projets") return "/mes-projets";
      if (item.path === "/devis") return "/mes-devis";
      if (item.path === "/factures") return "/mes-factures";
    }
    return item.path;
  };

  const badgeValues = { validations: validationCount, emails: emailCount, demandes: demandeCount };

  const navGroups = allNavGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item => canAccess(getPath(item)))
    }))
    .filter(group => group.items.length > 0);

  const handleNavClick = () => {
    if (mobileOpen && onCloseMobile) onCloseMobile();
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40 animate-in fade-in duration-200"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={cn(
          "relative flex flex-col h-screen bg-white border-r border-border transition-all duration-300 ease-in-out",
          "md:relative md:translate-x-0 md:z-30",
          collapsed ? "md:w-[68px]" : "md:w-[240px]",
          "fixed md:static z-50 w-[260px] shrink-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className={cn(
          "flex items-center gap-3 px-4 py-4 border-b border-border",
          collapsed && "md:justify-center md:px-2"
        )}>
          <div className="flex-shrink-0 w-9 h-9 rounded-xl overflow-hidden shadow-lg">
            <img src="/logo.png" alt="JS-Innov.IA" className="w-full h-full object-cover" />
          </div>
          {!collapsed && (
            <div className="overflow-hidden flex-1">
              <p className="text-sm font-bold text-foreground leading-tight" style={{fontFamily: "'Space Grotesk', sans-serif"}}>JS-Innov.IA</p>
              <p className="text-[10px] text-muted-foreground font-medium tracking-wide">COCKPIT</p>
            </div>
          )}
          <button
            onClick={onCloseMobile}
            className="md:hidden p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
            aria-label="Fermer le menu"
          >
            <X className="w-5 h-5" />
          </button>
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
                const itemPath = getPath(item);
                const active = location.pathname === itemPath ||
                  (itemPath !== "/" && location.pathname.startsWith(itemPath));
                const badge = item.badge ? badgeValues[item.badge] || 0 : 0;
                return (
                  <Link
                    key={itemPath}
                    to={itemPath}
                    onClick={handleNavClick}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "sidebar-item mb-0.5 relative min-h-[44px]",
                      collapsed ? "md:justify-center md:px-0 md:py-2.5" : "",
                      active
                        ? "bg-primary text-white shadow-lg shadow-primary/25"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="text-sm font-medium flex-1 truncate">{item.label}</span>
                        {badge > 0 && (
                          <span className="text-[10px] font-bold bg-red-500 text-white rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
                            {badge}
                          </span>
                        )}
                      </>
                    )}
                    {collapsed && badge > 0 && (
                      <span className="absolute top-1 right-1 text-[9px] font-bold bg-red-500 text-white rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Collapse toggle desktop */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:flex items-center justify-center py-2 border-t border-border text-muted-foreground hover:bg-muted"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>

        {/* User footer */}
        {!collapsed ? (
          <div className="border-t border-border p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                {user?.email?.[0]?.toUpperCase() || "J"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{user?.email || "Julien"}</p>
                <p className="text-[10px] text-muted-foreground">{ROLE_LABELS[role]}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut className="w-3.5 h-3.5" />
              Déconnexion
            </button>
          </div>
        ) : (
          <div className="border-t border-border py-2 flex flex-col items-center gap-1">
            <button onClick={handleLogout} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted" title="Déconnexion">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
