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
import ClientDashboard from "@/pages/ClientDashboard";
import ClientRecords from "@/pages/ClientRecords";
import Assurances from "@/pages/Assurances";
import Documents from "@/pages/Documents";
import AppsAgents from "@/pages/AppsAgents";
import Production from "@/pages/Production";
import Domaines from "@/pages/Domaines";
import Rangement from "@/pages/Rangement";
import Clients from "@/pages/Clients";
import Leads from "@/pages/Leads";
import Projets from "@/pages/Projets";
import Taches from "@/pages/Taches";
import Demandes from "@/pages/Demandes";
import Services from "@/pages/Services";
import Commercants from "@/pages/Commercants";
import Devis from "@/pages/Devis";
import Factures from "@/pages/Factures";
import HainoFlow from "@/pages/HainoFlow";
import Commissions from "@/pages/Commissions";
import Validations from "@/pages/Validations";
import Logs from "@/pages/Logs";
import Agent from "@/pages/Agent";
import AgentsIA from "@/pages/AgentsIA";
import AICostControl from "@/pages/AICostControl";
import Invitations from "@/pages/Invitations";
import Gouvernance from "@/pages/Gouvernance";
import RoleAwareFloatingAgent from "@/components/RoleAwareFloatingAgent";

// ── Studio Vidéo
import VideoStudio from "@/pages/VideoStudio";
import AIVideoReportGenerator from "@/pages/AIVideoReportGenerator";
import ThumbnailGenerator from "@/pages/ThumbnailGenerator";
import DourCampaignVideo from "@/pages/DourCampaignVideo";
import ExportsLibrary from "@/pages/ExportsLibrary";
import ExportedVideos from "@/pages/ExportedVideos";
import Templates from "@/pages/Templates";
import ProjectCalendar from "@/pages/ProjectCalendar";
import Parametres from "@/pages/Parametres";
import Portfolio from "@/pages/Portfolio";
import Automations from "@/pages/Automations";
import Emails from "@/pages/Emails";
import EmailCore from "@/pages/EmailCore";
import Twilio from "@/pages/Twilio";
import AppErrorBoundary from "@/components/shared/AppErrorBoundary";

const PageBoundary = ({ children }) => <AppErrorBoundary>{children}</AppErrorBoundary>;

const AppRoutes = () => {
  const { user, isAuthenticated, isLoadingAuth, authChecked } = useAuth();
  const isClient = user?.role === 'client';

  if (!authChecked || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0a0a14]">
        <div className="w-8 h-8 border-4 border-[#D4AF37]/20 border-t-[#D4AF37] rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppErrorBoundary><AppLayout /></AppErrorBoundary>}>
          <Route path="/" element={<PageBoundary>{isClient ? <ClientDashboard /> : <Dashboard />}</PageBoundary>} />
          <Route path="/assurances" element={<PageBoundary><Assurances /></PageBoundary>} />
          <Route path="/documents" element={<PageBoundary><Documents /></PageBoundary>} />

          <Route path="/clients" element={<PageBoundary><Clients /></PageBoundary>} />
          <Route path="/leads" element={<PageBoundary><Leads /></PageBoundary>} />

          <Route path="/projets" element={<PageBoundary><Projets /></PageBoundary>} />
          <Route path="/mes-projets" element={<PageBoundary><ClientRecords kind="projects" /></PageBoundary>} />
          <Route path="/taches" element={<PageBoundary><Taches /></PageBoundary>} />
          <Route path="/demandes" element={<PageBoundary><Demandes /></PageBoundary>} />

          <Route path="/devis" element={<PageBoundary><Devis /></PageBoundary>} />
          <Route path="/mes-devis" element={<PageBoundary><ClientRecords kind="quotes" /></PageBoundary>} />
          <Route path="/factures" element={<PageBoundary><Factures /></PageBoundary>} />
          <Route path="/hainoflow" element={<PageBoundary><HainoFlow /></PageBoundary>} />
          <Route path="/mes-factures" element={<PageBoundary><ClientRecords kind="invoices" /></PageBoundary>} />
          <Route path="/commissions" element={<PageBoundary><Commissions /></PageBoundary>} />

          <Route path="/agent" element={isClient ? <Navigate to="/" replace /> : <PageBoundary><Agent /></PageBoundary>} />
          <Route path="/agents-ia" element={isClient ? <Navigate to="/" replace /> : <PageBoundary><AgentsIA /></PageBoundary>} />
          <Route path="/ai-cost-control" element={<PageBoundary><AICostControl /></PageBoundary>} />
          <Route path="/validations" element={<PageBoundary><Validations /></PageBoundary>} />
          <Route path="/logs" element={<PageBoundary><Logs /></PageBoundary>} />
          <Route path="/invitations" element={<PageBoundary><Invitations /></PageBoundary>} />
          <Route path="/gouvernance" element={<PageBoundary><Gouvernance /></PageBoundary>} />
          <Route path="/commercants" element={<PageBoundary><Commercants /></PageBoundary>} />
          <Route path="/services" element={<Services />} />

          <Route path="/video-studio" element={<VideoStudio />} />
          <Route path="/video-studio/new" element={<VideoStudio />} />
          <Route path="/video-studio/:id" element={<VideoStudio />} />
          <Route path="/ai-video" element={<AIVideoReportGenerator />} />
          <Route path="/thumbnail" element={<ThumbnailGenerator />} />
          <Route path="/dour-campaign" element={<DourCampaignVideo />} />
          <Route path="/exports" element={<ExportsLibrary />} />
          <Route path="/exported-videos" element={<ExportedVideos />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/calendar" element={<ProjectCalendar />} />

          <Route path="/portfolio" element={<PageBoundary><Portfolio /></PageBoundary>} />
          <Route path="/automations" element={<PageBoundary><Automations /></PageBoundary>} />

          <Route path="/emails" element={<PageBoundary><Emails /></PageBoundary>} />
          <Route path="/emails-core" element={<PageBoundary><EmailCore /></PageBoundary>} />
          <Route path="/twilio" element={<PageBoundary><Twilio /></PageBoundary>} />
          <Route path="/amails" element={<Navigate to="/emails?folder=sent" replace />} />

          <Route path="/parametres" element={<PageBoundary><Parametres /></PageBoundary>} />
          <Route path="/apps-agents" element={<PageBoundary><AppsAgents /></PageBoundary>} />
          <Route path="/production" element={<PageBoundary><Production /></PageBoundary>} />
          <Route path="/domaines" element={<PageBoundary><Domaines /></PageBoundary>} />
          <Route path="/rangement" element={<PageBoundary><Rangement /></PageBoundary>} />
        </Route>
      </Route>

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
        <RoleAwareFloatingAgent />
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
