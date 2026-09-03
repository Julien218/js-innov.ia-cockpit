import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Camera, ChevronLeft, ChevronRight, LogOut, MonitorPlay, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import { usePermissions } from "@/lib/usePermissions";
import { useCommerceEntitlements } from "@/lib/useCommerceEntitlements";
import SignelyaWordmark from "@/components/brand/SignelyaWordmark";

const NAV_ITEMS = [
  { label: "Écran géant", icon: MonitorPlay, path: "/ecran-geant", module: "digital_signage" },
  { label: "Vidéosurveillance", icon: Camera, path: "/videosurveillance", module: "videosurveillance" },
];

export default function Sidebar({ mobileOpen = false, onCloseMobile }) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { role, canAccess } = usePermissions();
  const { hasModule, isLoading } = useCommerceEntitlements();
  const items = NAV_ITEMS.filter(item => canAccess(item.path) && (role !== "client" || (!isLoading && hasModule(item.module))));
  const handleLogout = async () => { await logout(); navigate("/login", { replace: true }); };

  return <>
    {mobileOpen && <div className="fixed inset-0 z-40 bg-[#030711]/75 backdrop-blur-sm md:hidden" onClick={onCloseMobile} />}
    <aside className={cn(
      "relative flex h-[100dvh] min-h-[100dvh] shrink-0 flex-col border-r border-cyan-400/15 bg-[linear-gradient(180deg,#050817_0%,#090E24_52%,#060916_100%)] text-white transition-all duration-300",
      collapsed ? "md:w-[76px]" : "md:w-[248px]",
      "fixed left-0 top-0 z-50 w-[min(86vw,320px)] max-w-[calc(100vw-env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:static md:z-30 md:w-auto md:max-w-none md:translate-x-0 md:p-0",
      mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
    )}>
      <div className={cn("flex min-w-0 items-center gap-3 border-b border-white/10 px-4 py-4", collapsed && "md:justify-center md:px-2")}>
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-2xl border border-cyan-300/30 bg-black/30 shadow-[0_0_28px_rgba(0,212,255,0.22)]">
          <img src="/signelya-app-icon-approved.png" alt="SIGNELYA" className="h-full w-full object-contain" />
        </div>
        {!collapsed && <div className="min-w-0 flex-1 overflow-hidden"><SignelyaWordmark className="text-base font-extrabold tracking-[0.11em] sm:text-lg sm:tracking-[0.13em]" /><p className="mt-0.5 truncate text-[10px] font-medium tracking-[0.12em] text-white/55 sm:tracking-[0.16em]">by JS‑Innov.IA</p></div>}
        <button onClick={onCloseMobile} className="ml-auto shrink-0 rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white md:hidden" aria-label="Fermer le menu"><X className="h-5 w-5" /></button>
      </div>
      {!collapsed && <div className="mx-3 mt-4 rounded-2xl border border-cyan-400/15 bg-white/[0.04] px-3 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">Cockpit affichage</p><p className="mt-1 text-xs text-white/45">Vos écrans prennent vie.</p></div>}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-4">
        {!collapsed && <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">Services</p>}
        {items.map(item => {
          const active = location.pathname === item.path || location.pathname.startsWith(item.path + "/");
          return <Link key={item.path} to={item.path} onClick={onCloseMobile} title={collapsed ? item.label : undefined} className={cn("mb-2 flex min-h-12 items-center gap-3 rounded-xl px-3 py-2.5 transition-all", collapsed && "md:justify-center md:px-0", active ? "bg-[linear-gradient(135deg,#0066FF,#8A2BE2)] text-white shadow-[0_8px_26px_rgba(0,102,255,0.28)]" : "text-white/62 hover:bg-white/[0.07] hover:text-white")}>
            <item.icon className="h-5 w-5 shrink-0" />{!collapsed && <span className="truncate text-sm font-semibold">{item.label}</span>}
          </Link>;
        })}
      </nav>
      <button onClick={() => setCollapsed(value => !value)} className="hidden items-center justify-center border-t border-white/10 py-2.5 text-white/45 hover:bg-white/[0.05] hover:text-white md:flex" aria-label={collapsed ? "Déployer le menu" : "Réduire le menu"}>{collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}</button>
      <div className="border-t border-white/10 p-3">
        {!collapsed && <p className="mb-2 truncate px-2 text-xs text-white/45">{user?.email}</p>}
        <button onClick={handleLogout} className={cn("flex w-full items-center gap-2 rounded-xl p-2 text-xs text-white/55 hover:bg-white/[0.07] hover:text-white", collapsed && "justify-center")} title="Déconnexion"><LogOut className="h-4 w-4" />{!collapsed && "Déconnexion"}</button>
      </div>
    </aside>
  </>;
}
