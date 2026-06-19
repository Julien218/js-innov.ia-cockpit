import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';

// Routes publiques
import Login from "@/pages/Login";
import Register from "@/pages/Register";

// Layout & guard
import AppLayout from "@/components/layout/AppLayout";
import ProtectedRoute from "@/components/ProtectedRoute";

// Pages
import Dashboard from "@/pages/Dashboard";
import Clients from "@/pages/Clients";
import Leads from "@/pages/Leads";
import Projets from "@/pages/Projets";
import Taches from "@/pages/Taches";
import Demandes from "@/pages/Demandes";
import Services from "@/pages/Services";
import Commercants from "@/pages/Commercants";
import Devis from "@/pages/Devis";
import Factures from "@/pages/Factures";
import Commissions from "@/pages/Commissions";
import Validations from "@/pages/Validations";
import Logs from "@/pages/Logs";
import Agent from "@/pages/Agent";
import AgentsIA from "@/pages/AgentsIA";
import Invitations from "@/pages/Invitations";
import Parametres from "@/pages/Parametres";

const AppRoutes = () => {
  const { isAuthenticated, isLoadingAuth, authChecked } = useAuth();

  if (!authChecked || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0a0a14]">
        <div className="w-8 h-8 border-4 border-[#D4AF37]/20 border-t-[#D4AF37] rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <Routes>
      {/* ─── Routes publiques ─────────────────────────── */}
      <Route path="/login" element={
        isAuthenticated ? <Navigate to="/" replace /> : <Login />
      } />
      <Route path="/register" element={<Register />} />

      {/* ─── Routes protégées ─────────────────────────── */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />

          {/* CRM */}
          <Route path="/clients" element={<Clients />} />
          <Route path="/leads" element={<Leads />} />

          {/* Opérations */}
          <Route path="/projets" element={<Projets />} />
          <Route path="/mes-projets" element={<Projets />} />
          <Route path="/taches" element={<Taches />} />
          <Route path="/demandes" element={<Demandes />} />

          {/* Finance */}
          <Route path="/devis" element={<Devis />} />
          <Route path="/mes-devis" element={<Devis />} />
          <Route path="/factures" element={<Factures />} />
          <Route path="/mes-factures" element={<Factures />} />
          <Route path="/commissions" element={<Commissions />} />

          {/* IA & Contrôle */}
          <Route path="/agent" element={<Agent />} />
          <Route path="/agents-ia" element={<AgentsIA />} />
          <Route path="/validations" element={<Validations />} />
          <Route path="/logs" element={<Logs />} />

          {/* Équipe */}
          <Route path="/invitations" element={<Invitations />} />

          {/* VilleConnect */}
          <Route path="/commercants" element={<Commercants />} />

          {/* Catalogue */}
          <Route path="/services" element={<Services />} />

          {/* Paramètres */}
          <Route path="/parametres" element={<Parametres />} />
        </Route>
      </Route>

      {/* ─── 404 ──────────────────────────────────────── */}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AppRoutes />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
