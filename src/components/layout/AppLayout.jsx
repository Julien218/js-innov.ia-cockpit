import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";

const pageTitles = {
  "/": "Tableau de bord",
  "/clients": "Clients",
  "/leads": "Leads",
  "/projets": "Projets",
  "/devis": "Devis",
  "/factures": "Factures",
  "/commissions": "Commissions assurance",
};

export default function AppLayout() {
  const location = useLocation();
  const title = pageTitles[location.pathname] || "JS-Innov.IA";

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="ml-[72px] md:ml-[260px] transition-all duration-300">
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}