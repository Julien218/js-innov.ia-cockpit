import React from "react";
import { Bell, Search, HelpCircle, Menu, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function TopBar({ onOpenMobileMenu }) {
  const { user } = useAuth();
  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <header className="h-14 border-b flex items-center justify-between px-3 sm:px-5 gap-2 sm:gap-4 sticky top-0 z-20 shrink-0">
      <button
        onClick={onOpenMobileMenu}
        className="md:hidden p-2 -ml-1 rounded-xl hover:bg-white/5 text-foreground transition-colors"
        aria-label="Ouvrir le menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      <div className="hidden md:flex items-center gap-2 min-w-[170px]">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.65)]" />
        <p className="text-[11px] text-muted-foreground capitalize tracking-wide">{today}</p>
      </div>

      <div className="flex-1 max-w-md relative group">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
        <Input
          placeholder="Rechercher dans le Cockpit…"
          className="pl-9 pr-9 h-9 text-xs bg-white/[0.035] border border-white/[0.065] rounded-xl focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:border-primary/25 placeholder:text-muted-foreground/60"
        />
        <Sparkles className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary/45" />
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/5 relative">
          <Bell className="w-4 h-4" />
          <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-primary rounded-full shadow-[0_0_10px_rgba(212,175,55,0.75)]" />
        </Button>
        <Button variant="ghost" size="icon" className="hidden sm:flex h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/5">
          <HelpCircle className="w-4 h-4" />
        </Button>
        <div className="relative ml-1">
          <div className="w-8 h-8 rounded-xl gradient-primary p-[1px] shadow-[0_8px_24px_rgba(212,175,55,0.16)]">
            <div className="w-full h-full rounded-[11px] bg-[#0b0d12] flex items-center justify-center text-primary text-xs font-bold">
              {user?.full_name?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || "J"}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
