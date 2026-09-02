import React from "react";
import { Menu } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

export default function TopBar({ onOpenMobileMenu }) {
  const { user } = useAuth();
  const initial = user?.full_name?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || "S";
  return <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-cyan-400/10 bg-[#050817]/95 px-3 text-white shadow-lg shadow-black/10 backdrop-blur-xl sm:px-5">
    <button onClick={onOpenMobileMenu} className="rounded-xl p-2 text-white/75 hover:bg-white/10 hover:text-white md:hidden" aria-label="Ouvrir le menu"><Menu className="h-5 w-5" /></button>
    <div className="hidden md:block"><p className="text-sm font-semibold text-white/90">Pilotage SIGNELYA</p><p className="text-xs text-white/40">Écran géant & vidéosurveillance</p></div>
    <div className="ml-auto flex items-center gap-3"><span className="hidden text-xs text-white/45 sm:block">{user?.email}</span><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,#00D4FF,#8A2BE2,#FF00CC)] text-xs font-bold text-white shadow-[0_0_20px_rgba(0,212,255,0.28)]">{initial}</div></div>
  </header>;
}
