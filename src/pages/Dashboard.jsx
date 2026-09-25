import React from "react";
import "./DashboardQuiet.css";
import ElyneaHomePresence from "@/components/ElyneaHomePresence";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckSquare,
  FolderKanban,
  Mail,
  MessageSquare,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { isTaskBlocked, isTaskCompleted } from "@/lib/taskStatus";
import { useDemandes } from "@/lib/useDemandes";
import { isNewDemande } from "@/lib/demandePresentation";

const KPI_ITEMS = [
  { key: "tasks", label: "Tâches à traiter", icon: CheckSquare, tone: "blue" },
  { key: "emails", label: "Emails à traiter", icon: Mail, tone: "rose" },
  { key: "projects", label: "Projets en cours", icon: FolderKanban, tone: "violet" },
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
  const routes = { tasks: '/taches', emails: '/emails', projects: '/projets', requests: '/demandes' };
  return <Link to={routes[item.key]} className="quiet-home-metric">
    <Icon size={16} aria-hidden="true" />
    <span>{item.label}</span><strong>{value}</strong>
    {subtitle && <small>{subtitle}</small>}
  </Link>;
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
  const { data: projets = [], isError: projetsErr } = useQuery({ queryKey: ["projets"], queryFn: () => base44.entities.Projet.list() });
  const { data: taches = [], isError: tachesErr } = useQuery({ queryKey: ["taches"], queryFn: () => base44.entities.Tache.list() });
  const { data: demandes = [], isError: demandesErr } = useDemandes();

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


  const hasAnyError = projetsErr || tachesErr || demandesErr || emailsErr;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir";

  const kpiValues = {
    tasks: tachesActives,
    emails: emailsATraiter,
    projects: projetsEnCours,
    requests: demandesOuvertes,
  };

  const openElynea = (prompt = "") => {
    window.dispatchEvent(new CustomEvent("elynea:open", { detail: { prompt } }));
  };


  const jarvisKpis = KPI_ITEMS;

  return (
    <div className="cockpit-reference-dashboard jarvis-home quiet-home">
      <div className="mx-auto w-full max-w-[1080px] space-y-4">
        <header className="quiet-home-heading">
          <div><p className="quiet-home-eyebrow">VOTRE ESPACE PERSONNEL</p><h1>{greeting}, <span>Julien</span></h1></div>
          <span className="quiet-home-brand">JS-INNOV.IA</span>
        </header>

        <section className="quiet-home-hero" aria-label="Mode Jarvis">
          <p className="quiet-home-eyebrow">MODE JARVIS</p>
          <h2>Que faisons-nous aujourd’hui ?</h2>
          <p className="quiet-home-intro">Une idée, une question, une action. Elynea vous accompagne.</p>
          <ElyneaHomePresence callLabel="Appeler Elynea" />
          <div className="quiet-home-suggestions" aria-label="Suggestions pour Elynea">
            <button type="button" onClick={() => openElynea("Analyse mes priorités du jour et ouvre ce qui demande mon attention.")}>Mes priorités <ArrowRight size={13} /></button>
            <button type="button" onClick={() => openElynea("Ouvre et analyse mes emails à traiter.")}>Mes emails <ArrowRight size={13} /></button>
            <button type="button" onClick={() => openElynea("Montre-moi les projets qui nécessitent une action.")}>Mes projets <ArrowRight size={13} /></button>
          </div>
        </section>

        <nav className="quiet-home-metrics" aria-label="Accès à votre activité">
          {jarvisKpis.map((item) => (
            <KpiCard key={item.key} item={item} value={
              ({tasks: tachesErr, emails: emailsErr, projects: projetsErr, requests: demandesErr})[item.key] ? '—' : kpiValues[item.key]
            } subtitle={item.key === 'tasks' && !tachesErr && tachesEnRetard > 0 ? tachesEnRetard + ' en retard' : undefined} />
          ))}
        </nav>
        {hasAnyError && <p className="quiet-home-notice" role="status">Certaines données sont indisponibles. Les compteurs concernés affichent « — ».</p>}

        <details className="quiet-home-details">
          <summary>Voir mes priorités et projets récents</summary>
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

        </details>
      </div>
    </div>
  );
}
