import React, { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { useAuth } from "@/lib/AuthContext";

const OLIVIER_EMAIL = 'olivier.trevis@pv.be';

export default function AppLayout() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { user } = useAuth();
  const location = useLocation();
  const showInsurance = user?.role === 'superadmin'
    || String(user?.email || '').toLowerCase() === OLIVIER_EMAIL;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <TopBar onOpenMobileMenu={() => setMobileSidebarOpen(true)} />
        {showInsurance && (
          <div className="border-b border-border bg-white px-3 py-2 sm:px-6">
            <Link
              to="/assurances"
              className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                location.pathname === '/assurances'
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-primary/10 text-primary hover:bg-primary/15'
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              Assurances — Producteur 0969
            </Link>
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-3 sm:p-6 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
