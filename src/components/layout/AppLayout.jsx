import React, { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import ElyneaAudioDockSynced from "@/components/audio/ElyneaAudioDockSynced";
import "@/premium-overrides.css";

export default function AppLayout() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const location = useLocation();
  const isMailRoute = location.pathname.startsWith('/emails');

  return (
    <div className={`cockpit-shell premium-shell ${isMailRoute ? 'premium-mail-route' : ''} flex h-screen overflow-hidden bg-transparent text-foreground`}>
      <Sidebar
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div className="flex flex-col flex-1 overflow-hidden min-w-0 relative">
        <div className="cockpit-ambient pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute -top-28 right-[8%] w-80 h-80 rounded-full bg-sky-300/20 blur-3xl" />
          <div className="absolute top-[28%] -right-32 w-96 h-96 rounded-full bg-amber-300/15 blur-3xl" />
          <div className="absolute bottom-[-10rem] left-[18%] w-[30rem] h-[30rem] rounded-full bg-blue-300/10 blur-3xl" />
        </div>

        <TopBar onOpenMobileMenu={() => setMobileSidebarOpen(true)} />

        <main className="cockpit-main relative z-10 flex-1 overflow-y-auto p-3 sm:p-5 lg:p-6 pb-[calc(env(safe-area-inset-bottom)+6rem)]">
          <Outlet />
        </main>

        {/* Player unique et persistant : le layout ne se démonte pas lors d'un changement de page. */}
        <ElyneaAudioDockSynced />
      </div>
    </div>
  );
}
