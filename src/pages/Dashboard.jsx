import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckSquare,
  FolderKanban,
  Mail,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { isTaskBlocked, isTaskCompleted } from "@/lib/taskStatus";
import { useDemandes } from "@/lib/useDemandes";
import { isNewDemande } from "@/lib/demandePresentation";

const KPI_ITEMS = [
  { key: "tasks", label: "Tâches à traiter", icon: CheckSquare, tone: "blue" },
  { key: "emails", label: "Emails à traiter", icon: Mail, tone: "rose" },
  { key: "clients", label: "Clients actifs", icon: Users, tone: "green" },
  { key: "projects", label: "Projets en cours", icon: FolderKanban, tone: "violet" },
  { key: "commissions", label: "Commissions", icon: Shield, tone: "amber" },
  { key: "revenue", label: "CA encaissé", icon: TrendingUp, tone: "cyan" },
  { key: "leads", label: "Leads actifs", icon: Target, tone: "orange" },
  { key: "requests", label: "Demandes", icon: MessageSquare, tone: "slate" },
];

function projectTitle(project) {
  return project.nom || project.titre || project.name || project.title || "Projet sans titre";
}

function projectClient(project) {
  return project.client_nom || project.clientName || project.client?.nom || "";
}

function priorityTone(task) {
  if (isTaskBlocked(task)) return "bg-red-500/10 text-red-600 border-red-500/20";
  if (task.priorite === "urgente" || task.priorite === "haute") return "bg-red-500/10 text-red-600 border-red-500/20";
  if (task.priorite === "moyenne") return "bg-amber-500/10 text-amber-700 border-amber-500/20";
  return "bg-blue-500/10 text-blue-600 border-blue-500/20";
}

function KpiCard({ item, value, subtitle }) {
  const Icon = item.icon;
  return (
    <div className={cn("cockpit-reference-kpi cockpit-electric-frame", `cockpit-kpi-${item.tone}`)}>
      <span className="cockpit-reference-kpi-icon"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <p className="text-xl font-bold leading-none">{value}</p>
        <p className="mt-1 truncate text-[11px] font-medium text-slate-600">{item.label}</p>
        {subtitle && <p className="mt-1 truncate text-[10px] text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
}

function PanelHeader({ icon: Icon, title, action, to }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-900/5 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="cockpit-reference-section-icon"><Icon className="h-4 w-4" /></span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {to && (
        <Link to={to} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700">
          {action || "Voir tout"} <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { data: clients = [], isError: clientsErr } = useQuery({ queryKey: ["clients"], queryFn: () => base44.entities.Client.list() });
  const { data: leads = [], isError: leadsErr } = useQuery({ queryKey: ["leads"], queryFn: () => base44.entities.Lead.list() });
  const { data: projets = [], isError: projetsErr } = useQuery({ queryKey: ["projets"], queryFn: () => base44.entities.Projet.list() });
  const { data: taches = [], isError: tachesErr } = useQuery({ queryKey: ["taches"], queryFn: () => base44.entities.Tache.list() });
  const { data: demandes = [], isError: demandesErr } = useDemandes();
  const { data: factures = [], isError: facturesErr } = useQuery({ queryKey: ["factures"], queryFn: () => base44.entities.Facture.list() });
  const { data: commissions = [], isError: commissionsErr } = useQuery({ queryKey: ["commissions"], queryFn: () => base44.entities.Commission.list() });

  const { data: emailOverview = { emails: [], unread: 0 }, isError: emailsErr } = useQuery({
    queryKey: ["dashboard-email-overview"],
    queryFn: async () => {
      const response = await fetch("/api/emails?limit=8", { credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || `Emails indisponibles (HTTP ${response.status})`);
      const emails = Array.isArray(data.emails) ? data.emails : [];
      const unread = Number(data.unread);
      return {
        emails,
        unread: Number.isFinite(unread) ? unread : emails.filter((email) => !email.seen).length,
      };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });


  const caTotal = factures.filter((f) => f.statut === "payee").reduce((sum, f) => sum + Number(f.montant_ttc || 0), 0);
  const commTotal = commissions.filter((c) => c.statut === "payee").reduce((sum, c) => sum + Number(c.montant || c.montant_commission || 0), 0);
  const leadsActifs = leads.filter((lead) => !["gagne", "perdu"].includes(lead.statut)).length;
  const projetsEnCours = projets.filter((project) => project.statut === "en_cours").length;
  const tachesEnRetard = taches.filter((task) => task.date_echeance && new Date(task.date_echeance) < new Date() && !isTaskCompleted(task)).length;
  const tachesActives = taches.filter((task) => !isTaskCompleted(task)).length;
  const demandesOuvertes = demandes.filter(isNewDemande).length;
  const emailsATraiter = Number(emailOverview.unread || 0);

  const recentProjects = [...projets]
    .sort((a, b) => new Date(b.updated_at || b.created_at || b.created_date || 0) - new Date(a.updated_at || a.created_at || a.created_date || 0))
    .slice(0, 4);

  const tachesUrgentes = [...taches]
    .filter((task) => !isTaskCompleted(task))
    .sort((a, b) => {
      const blocked = Number(isTaskBlocked(b)) - Number(isTaskBlocked(a));
      if (blocked) return blocked;
      return new Date(a.date_echeance || "2999-12-31") - new Date(b.date_echeance || "2999-12-31");
    })
    .slice(0, 5);


  const hasAnyError = clientsErr || leadsErr || projetsErr || tachesErr || demandesErr || facturesErr || commissionsErr;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir";

  const kpiValues = {
    tasks: tachesActives,
    emails: emailsATraiter,
    clients: clients.length,
    projects: projetsEnCours,
    commissions: `${commTotal.toLocaleString("fr-BE")} €`,
    revenue: `${caTotal.toLocaleString("fr-BE")} €`,
    leads: leadsActifs,
    requests: demandesOuvertes,
  };

  const openElynea = (prompt = "") => {
    window.dispatchEvent(new CustomEvent("elynea:open", { detail: { prompt } }));
  };


  const jarvisKpis = KPI_ITEMS.filter((item) => ["tasks", "emails", "projects", "requests"].includes(item.key));

  return (
    <div className="cockpit-reference-dashboard jarvis-home">
      <div className="mx-auto w-full max-w-[1480px] space-y-4">
        <section className="cockpit-reference-greeting jarvis-home-greeting">
          <div>
            <h1 className="text-2xl font-bold text-white drop-shadow-sm sm:text-3xl">
              {greeting}, <span className="text-amber-300">Julien</span> 👋
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-white/70">
              L’accueil reste volontairement léger : Elynea orchestre et ouvre les outils dont vous avez besoin.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openElynea("")}
            className="jarvis-home-call inline-flex items-center gap-2 rounded-xl border border-amber-300/40 bg-slate-950/35 px-4 py-2.5 text-sm font-semibold text-white shadow-lg backdrop-blur-xl"
          >
            <Sparkles className="h-4 w-4 text-amber-300" />
            Appeler Elynea
          </button>
        </section>

        {hasAnyError && (
          <div className="rounded-xl border border-amber-300/25 bg-slate-950/45 px-4 py-3 text-sm text-amber-100 shadow-lg backdrop-blur-xl">
            Certaines données métier n’ont pas pu être chargées. Les compteurs concernés peuvent être incomplets.
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {jarvisKpis.map((item) => (
            <KpiCard
              key={item.key}
              item={item}
              value={kpiValues[item.key]}
              subtitle={
                item.key === "tasks" && tachesEnRetard > 0 ? `${tachesEnRetard} en retard`
                  : item.key === "emails" && emailsErr ? "Messagerie indisponible"
                  : item.key === "projects" ? "en cours"
                  : undefined
              }
            />
          ))}
        </section>

        <section className="jarvis-home-command cockpit-electric-frame">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/80">Mode Jarvis</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Dites simplement ce que vous voulez faire.</h2>
            <p className="mt-1 text-sm text-white/55">Elynea recherche, ouvre le bon module et exécute le flux autorisé sans transformer l’accueil en tableau de bord surchargé.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => openElynea("Analyse mes priorités du jour et ouvre ce qui demande mon attention.")} className="jarvis-home-chip">
              Mes priorités
            </button>
            <button type="button" onClick={() => openElynea("Ouvre et analyse mes emails à traiter.")} className="jarvis-home-chip">
              Mes emails
            </button>
            <button type="button" onClick={() => openElynea("Montre-moi les projets qui nécessitent une action.")} className="jarvis-home-chip">
              Mes projets
            </button>
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-2">
          <div className="cockpit-reference-panel cockpit-electric-frame">
            <PanelHeader icon={CheckSquare} title="Priorités" action={`Voir toutes (${tachesActives})`} to="/taches" />
            <div className="divide-y divide-white/5">
              {tachesUrgentes.length === 0 ? (
                <div className="px-4 py-8 text-sm text-white/50">Aucune tâche prioritaire.</div>
              ) : (
                tachesUrgentes.slice(0, 4).map((task) => (
                  <Link key={task.id} to="/taches" className="jarvis-home-row">
                    <span className="h-4 w-4 rounded border border-white/25 bg-white/5" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-white/90">{task.titre || task.title || "Tâche"}</span>
                      <span className="block truncate text-[10px] text-white/45">{task.projet_nom || task.client_nom || "Cockpit"}</span>
                    </span>
                    <span className={cn("rounded-full border px-2 py-1 text-[9px] font-semibold", priorityTone(task))}>
                      {isTaskBlocked(task) ? "Bloquée" : task.priorite || "Normale"}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>

          <div className="cockpit-reference-panel cockpit-electric-frame">
            <PanelHeader icon={FolderKanban} title="Projets récents" action="Voir tous" to="/projets" />
            <div className="divide-y divide-white/5">
              {recentProjects.length === 0 ? (
                <div className="px-4 py-8 text-sm text-white/50">Aucun projet récent.</div>
              ) : (
                recentProjects.slice(0, 4).map((project) => (
                  <Link key={project.id} to="/projets" className="jarvis-home-row">
                    <span className="cockpit-reference-project-mark">{projectTitle(project).charAt(0).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-white/90">{projectTitle(project)}</span>
                      <span className="block truncate text-[10px] text-white/45">{projectClient(project) || "Projet JS-Innov.IA"}</span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-white/35" />
                  </Link>
                ))
              )}
            </div>
          </div>
        </section>

        <div className="grid gap-2 sm:grid-cols-2">
          <Link to="/emails" className="jarvis-home-secondary">
            <Mail className="h-4 w-4" />
            <span>{emailsATraiter} email{emailsATraiter > 1 ? "s" : ""} à traiter</span>
          </Link>
          <Link to="/demandes" className="jarvis-home-secondary">
            <MessageSquare className="h-4 w-4" />
            <span>{demandesOuvertes} demande{demandesOuvertes > 1 ? "s" : ""} ouverte{demandesOuvertes > 1 ? "s" : ""}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
