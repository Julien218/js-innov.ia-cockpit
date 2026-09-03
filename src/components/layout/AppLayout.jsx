import React, { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

export default function AppLayout() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] w-full max-w-full overflow-hidden bg-[radial-gradient(circle_at_top_right,rgba(138,43,226,0.08),transparent_32%),#F6F8FC]">
      <Sidebar
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar onOpenMobileMenu={() => setMobileSidebarOpen(true)} />
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6 sm:pb-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
