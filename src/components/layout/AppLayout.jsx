import React, { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import "@/premium-overrides.css";

export default function AppLayout() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const location = useLocation();
  const isMailRoute = location.pathname.startsWith('/emails');

  return (
    <div className={`premium-shell ${isMailRoute ? 'premium-mail-route' : ''} flex h-screen overflow-hidden bg-background text-foreground`}>
      <Sidebar
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div className="flex flex-col flex-1 overflow-hidden min-w-0 relative">
        <div className="pointer-events-none absolute inset-0 opacity-80" aria-hidden="true">
          <div className="absolute -top-28 right-[8%] w-80 h-80 rounded-full bg-primary/[0.045] blur-3xl" />
          <div className="absolute top-[28%] -right-32 w-96 h-96 rounded-full bg-accent/[0.035] blur-3xl" />
        </div>
        <TopBar onOpenMobileMenu={() => setMobileSidebarOpen(true)} />
        <main className="relative z-10 flex-1 overflow-y-auto p-3 sm:p-5 lg:p-6 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
