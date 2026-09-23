import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Target, FolderKanban,
  FileText, Receipt, ChevronDown, Search, X,
  CheckSquare, MessageSquare, Shield,
  Network, Smartphone, LogOut, Crown, Briefcase, User,
  Settings, Mail, Clapperboard, Globe, FolderTree, Boxes,
  PlayCircle, GalleryHorizontalEnd, Send, Gauge, Workflow, Factory, MonitorPlay, Building2, Database, Music2, Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { usePermissions } from "@/lib/usePermissions";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/roles";
import { useDemandes } from "@/lib/useDemandes";
import { isNewDemande } from "@/lib/demandePresentation";
import { isNavigationActive } from "@/lib/navigation";

const OLIVIER_EMAIL = 'olivier.trevis@pv.be';

const useValidationsBadge = () => {
  const { data = [] } = useQuery({
    queryKey: ["validations"],
    queryFn: () => base44.entities.Validation.list(),
    staleTime: 30000,
  });
  return data.filter(v => v.statut === "en_attente").length;
};

const useEmailBadge = (enabled) => {
  const [unread, setUnread] = React.useState(null);
  React.useEffect(() => {
    if (!enabled) { setUnread(null); return; }
    let stopped = false;
    let timer;
    const controller = new AbortController();
    const poll = async () => {
      let retry = true;
      try {
        const response = await fetch('/api/emails?limit=1', { credentials: 'same-origin', signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.success) {
          // Repeated IMAP logins cannot repair rejected credentials.
          retry = ![401, 403].includes(response.status) && !/authenticat|invalid.credentials|login.failed/i.test(data.error || '');
          if (!stopped) setUnread(null);
        } else if (!stopped) setUnread(Number.isFinite(Number(data.unread)) ? Number(data.unread) : null);
      } catch { if (!stopped) setUnread(null); }
      if (!stopped && retry) timer = setTimeout(poll, 120000);
    };
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [enabled]);
  return unread;
};

const useDemandeBadge = () => {
  const { data = [] } = useDemandes();
  return data.filter(isNewDemande).length;
};

const useAgentLocalStatus = () => {
  const [status, setStatus] = React.useState('checking');
  React.useEffect(() => {
    const check = () => {
      fetch('http://127.0.0.1:8787/health', { signal: AbortSignal.timeout(3000) })
        .then(r => setStatus(r.ok ? 'online' : 'offline'))
        .catch(() => setStatus('offline'));
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);
  return status;
};

const ROLE_ICONS = {
  superadmin: Crown,
  admin: Shield,
  collaborateur: Briefcase,
  client: User,
};

export const allNavGroups = [
  {
    label: "Pilotage",
    items: [
      { label: "Accueil", icon: LayoutDashboard, path: "/" },
      { label: "Assurances-Dour", icon: Shield, path: "/assurances", insuranceOnly: true },
    ]
  },
  {
    label: "Applications produits",
    items: [
      { label: "HainoFlow", icon: Workflow, path: "/hainoflow" },
      { label: "Signelya", icon: MonitorPlay, path: "/ecran-geant" },
    ]
  },
  {
    label: "CRM",
    minRole: "collaborateur",
    items: [
      { label: "Clients", icon: Users, path: "/clients", minRole: "collaborateur" },
      { label: "Leads", icon: Target, path: "/leads", minRole: "collaborateur" },
      { label: "Documents", icon: FileText, path: "/documents", minRole: "collaborateur" },
      { label: "Demandes", icon: MessageSquare, path: "/demandes", badge: "demandes" },
    ]
  },
  {
    label: "Projets",
    items: [
      { label: "Projets", icon: FolderKanban, path: "/projets" },
      { label: "Données projets", icon: Database, path: "/donnees-projets" },
      { label: "Tâches", icon: CheckSquare, path: "/taches", minRole: "collaborateur" },
      { label: "VilleConnectOS", icon: Building2, path: "/villeconnect", minRole: "admin" },
    ]
  },
  {
    label: "Finance",
    minRole: "collaborateur",
    items: [
      { label: "Devis", icon: FileText, path: "/devis", minRole: "collaborateur" },
      { label: "Factures", icon: Receipt, path: "/factures", minRole: "admin" },
    ]
  },
  {
    label: "Communication",
    minRole: "admin",
    items: [
      { label: "Campagnes", icon: Megaphone, path: "/campagnes", minRole: "admin" },
      { label: "Emails", icon: Mail, path: "/emails", badge: "emails", minRole: "admin" },
      { label: "Email Core", icon: Send, path: "/emails-core", minRole: "admin" },
      { label: "NOVA — Tri comptable", icon: Receipt, path: "/email-accounting", minRole: "admin" },
    ]
  },
  {
    label: "Studio",
    minRole: "admin",
    items: [
      { label: "Production", icon: Clapperboard, path: "/production", minRole: "admin" },
      { label: "Avatar Factory", icon: Factory, path: "/avatar-factory", minRole: "admin" },
      { label: "Portfolio", icon: GalleryHorizontalEnd, path: "/portfolio", minRole: "admin" },
      { label: "Elynea Motion Studio", icon: Music2, path: "/music-motion", minRole: "admin" },
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
      { label: "Agents IA", icon: Network, path: "/agents-ia" },
      { label: "Mobile Hub", icon: Smartphone, path: "/mobile-hub" },
      { label: "AI Cost Control", icon: Gauge, path: "/ai-cost-control", minRole: "admin" },
      { label: "Utilisateurs & accès", icon: Users, path: "/invitations", minRole: "admin" },
      { label: "Paramètres", icon: Settings, path: "/parametres", minRole: "admin" },
    ]
  },
];

export default function Sidebar({ mobileOpen = false, onCloseMobile }) {
  const [navSearch, setNavSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState({ Pilotage: true, Projets: true, CRM: true });
  const [desktopHovered, setDesktopHovered] = useState(false);
  const location = useLocation();
  React.useEffect(() => {
    setNavSearch("");
    const activeGroup = allNavGroups.find(group => group.items.some(item => isNavigationActive(location.pathname, item.path)));
    if (activeGroup) setExpandedGroups(current => ({ ...current, [activeGroup.label]: true }));
  }, [location.pathname]);
  // Desktop: la navigation reste discrète et se déploie automatiquement au survol.
  // Mobile: l'ouverture reste pilotée par le bouton du TopBar.
  const compact = !mobileOpen && !desktopHovered;
  React.useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = event => { if (event.key === 'Escape') onCloseMobile?.(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen, onCloseMobile]);
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { role, canAccess } = usePermissions();
  const validationCount = useValidationsBadge();
  const emailCount = useEmailBadge(canAccess("/emails"));
  const demandeCount = useDemandeBadge();
  const agentStatus = useAgentLocalStatus();

  const colors = ROLE_COLORS[role] || ROLE_COLORS.client;
  const RoleIcon = ROLE_ICONS[role] || User;
  const insuranceAllowed = role === 'superadmin'
    || String(user?.email || '').toLowerCase() === OLIVIER_EMAIL;

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
      items: group.items.filter(item => item.insuranceOnly ? insuranceAllowed : canAccess(getPath(item)))
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
        data-cockpit-sidebar
        onMouseEnter={() => setDesktopHovered(true)}
        onMouseLeave={() => setDesktopHovered(false)}
        className={cn(
          "relative flex flex-col h-screen bg-white border-r border-border transition-all duration-300 ease-in-out",
          "md:relative md:translate-x-0 md:z-30",
          compact ? "md:w-[72px]" : "md:w-[248px]",
          "fixed md:static z-50 w-[260px] shrink-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div className={cn(
          "flex items-center gap-3 px-4 py-4 border-b border-border",
          compact && "md:justify-center md:px-2"
        )}>
          <div className="flex-shrink-0 w-9 h-9 rounded-xl overflow-hidden shadow-lg">
            <img src="/logo.png" alt="JS-Innov.IA" className="w-full h-full object-cover" />
          </div>
          {!compact && (
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

        {!compact && (
          <div className="mx-3 mt-3 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
            style={{ backgroundColor: colors.badge + "15" }}>
            <RoleIcon className="w-3 h-3 flex-shrink-0" style={{ color: colors.badge }} />
            <span className="text-[10px] font-semibold" style={{ color: colors.badge }}>
              {ROLE_LABELS[role]}
            </span>
          </div>
        )}

        {!compact && (
          <div className="relative mx-3 mt-3">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input aria-label="Trouver un module" placeholder="Trouver un module…" value={navSearch}
              onChange={event => setNavSearch(event.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-muted/40 pl-9 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            {navSearch && <button type="button" aria-label="Effacer la recherche de module" onClick={() => setNavSearch("")} className="absolute right-1 top-1 p-2"><X className="h-4 w-4" /></button>}
          </div>
        )}
        <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
          {navGroups.filter(group => compact || !navSearch.trim() || group.items.some(item => `${group.label} ${item.label}`.toLocaleLowerCase('fr').includes(navSearch.trim().toLocaleLowerCase('fr')))).map((group) => {
            const containsActive = group.items.some(item => isNavigationActive(location.pathname, getPath(item)));
            const expanded = compact || Boolean(navSearch.trim()) || (expandedGroups[group.label] ?? containsActive);
            return (
            <div key={group.label} className="mb-3">
              {!compact && (
                <button type="button" aria-expanded={expanded}
                  onClick={() => setExpandedGroups(current => ({ ...current, [group.label]: !expanded }))}
                  className="flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
                  <span>{group.label}</span><ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !expanded && "-rotate-90")} />
                </button>
              )}
              {expanded && group.items.filter(item => compact || !navSearch.trim() || `${group.label} ${item.label}`.toLocaleLowerCase('fr').includes(navSearch.trim().toLocaleLowerCase('fr'))).map((item) => {
                const itemPath = getPath(item);
                const active = isNavigationActive(location.pathname, itemPath);
                const badge = item.badge ? badgeValues[item.badge] || 0 : 0;
                return (
                  <Link
                    key={itemPath}
                    to={itemPath}
                    aria-label={item.label}
                    aria-current={active ? 'page' : undefined}
                    onClick={handleNavClick}
                    title={compact ? item.label : undefined}
                    className={cn(
                      "sidebar-item mb-0.5 relative min-h-[44px]",
                      compact ? "md:justify-center md:px-0 md:py-2.5" : "",
                      active
                        ? "active"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
                    {!compact && (
                      <>
                        <span className="text-sm font-medium flex-1 truncate">{item.label}</span>
                        {badge > 0 && (
                          <span className="text-[10px] font-bold bg-red-500 text-white rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
                            {badge}
                          </span>
                        )}
                        {item.agentStatus && !compact && (
                          <span className={cn("w-2 h-2 rounded-full flex-shrink-0", agentStatus === "online" ? "bg-emerald-500" : agentStatus === "checking" ? "bg-amber-400 animate-pulse" : "bg-red-500")} title={agentStatus === "online" ? "Agent 8787 connecté" : "Agent 8787 hors ligne"} />
                        )}
                        {item.agentLocal && !compact && (
                          <span className={cn("text-[9px] font-mono", agentStatus === "online" ? "text-emerald-500" : "text-red-400")}>8787</span>
                        )}
                      </>
                    )}
                    {compact && badge > 0 && (
                      <span className="absolute top-1 right-1 text-[9px] font-bold bg-red-500 text-white rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          );})}
          {!compact && navSearch.trim() && !navGroups.some(group => group.items.some(item => `${group.label} ${item.label}`.toLocaleLowerCase('fr').includes(navSearch.trim().toLocaleLowerCase('fr')))) && <p role="status" className="px-3 py-4 text-sm text-muted-foreground">Aucun module trouvé.</p>}
        </nav>

        <div
          className={cn(
            "hidden md:flex min-h-8 items-center justify-center border-t border-border text-[10px] font-medium tracking-wide text-muted-foreground transition-opacity",
            compact ? "opacity-80" : "opacity-50"
          )}
          aria-hidden="true"
        >
          {compact ? "SURVOL" : "MENU"}
        </div>

        {!compact ? (
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
