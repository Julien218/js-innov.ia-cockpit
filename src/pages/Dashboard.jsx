import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  CheckSquare,
  FileText,
  FolderKanban,
  Mail,
  MessageSquare,
  Search,
  Shield,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { isTaskBlocked, isTaskCompleted } from "@/lib/taskStatus";
import { useDemandes } from "@/lib/useDemandes";
import { isNewDemande } from "@/lib/demandePresentation";
import { OFFICIAL_ELYNEA_AVATAR } from "@/components/ElyneaBrandScope";

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

const PIPELINE = [
  { key: "nouveau", label: "Nouveaux" },
  { key: "contacte", label: "En contact" },
  { key: "proposition", label: "Proposition" },
  { key: "negociation", label: "Négociation" },
  { key: "gagne", label: "Gagnés" },
];

function timeLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return format(date, "dd/MM · HH:mm", { locale: fr });
}

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
    <div className={cn("cockpit-reference-kpi", `cockpit-kpi-${item.tone}`)}>
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

  const { data: notifications = [] } = useQuery({
    queryKey: ["dashboard-notifications"],
    queryFn: async () => {
      const response = await fetch("/api/data/Notifications?limit=8", { credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return [];
      return Array.isArray(data.events) ? data.events : [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const caTotal = factures.filter((f) => f.statut === "payee").reduce((sum, f) => sum + Number(f.montant_ttc || 0), 0);
  const commTotal = commissions.filter((c) => c.statut === "payee").reduce((sum, c) => sum + Number(c.montant || c.montant_commission || 0), 0);
  const leadsActifs = leads.filter((lead) => !["gagne", "perdu"].includes(lead.statut)).length;
  const projetsEnCours = projets.filter((project) => project.statut === "en_cours").length;
  const tachesEnRetard = taches.filter((task) => task.date_echeance && new Date(task.date_echeance) < new Date() && !isTaskCompleted(task)).length;
  const tachesActives = taches.filter((task) => !isTaskCompleted(task)).length;
  const demandesOuvertes = demandes.filter(isNewDemande).length;
  const emailsATraiter = Number(emailOverview.unread || 0);
  const emailsRecents = emailOverview.emails.filter((email) => !email.seen).slice(0, 5);

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

  const pipelineCounts = PIPELINE.map((stage) => ({
    ...stage,
    value: leads.filter((lead) => lead.statut === stage.key).length,
  }));
  const pipelineMax = Math.max(1, ...pipelineCounts.map((item) => item.value));

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

  const quickActions = [
    { label: "Nouveau client", to: "/clients", icon: Users },
    { label: "Nouveau projet", to: "/projets", icon: FolderKanban },
    { label: "Ajouter une tâche", to: "/taches", icon: CheckSquare },
    { label: "Créer un devis", to: "/devis", icon: FileText },
  ];

  return (
    <div className="cockpit-reference-dashboard">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-4">
          <section className="cockpit-reference-greeting">
            <div>
              <h1 className="text-2xl font-bold text-white drop-shadow-sm sm:text-3xl">
                {greeting}, <span className="text-amber-300">Julien</span> 👋
              </h1>
              <p className="mt-1 text-sm text-white/80">Voici votre activité du jour. Les priorités restent visibles en un coup d’œil.</p>
            </div>
            <div className="hidden rounded-2xl border border-amber-300/40 bg-slate-950/35 px-5 py-3 text-right text-sm italic text-white/90 backdrop-blur-xl lg:block">
              « Des idées d’aujourd’hui,<br />des solutions de demain. »
              <span className="mt-1 block text-[10px] not-italic text-amber-200">JS-Innov.IA</span>
            </div>
          </section>

          {hasAnyError && (
            <div className="rounded-xl border border-amber-300/35 bg-amber-50/85 px-4 py-3 text-sm text-amber-800 shadow-lg backdrop-blur-xl">
              Certaines données métier n’ont pas pu être chargées. Les compteurs concernés peuvent être incomplets.
            </div>
          )}

          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            {KPI_ITEMS.map((item) => (
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

          <section className="grid gap-3 lg:grid-cols-[1.45fr_.9fr_1.2fr]">
            <div className="cockpit-reference-panel cockpit-electric-frame">
              <PanelHeader icon={Mail} title="Emails à traiter" action="Voir tous" to="/emails" />
              <div className="divide-y divide-slate-900/5">
                {emailsErr ? (
                  <div className="px-4 py-6 text-sm text-slate-500">La messagerie n’est pas disponible pour le moment.</div>
                ) : emailsRecents.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-slate-500">Aucun email non lu à traiter.</div>
                ) : (
                  emailsRecents.map((email) => (
                    <Link key={email.uid || `${email.from}-${email.date}-${email.subject}`} to="/emails" className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/45">
                      <span className="h-8 w-8 shrink-0 rounded-full bg-slate-200/80 text-center text-[11px] font-bold leading-8 text-slate-600">
                        {String(email.from || "?").replace(/^["']|["']$/g, "").charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold">{email.from || "Expéditeur inconnu"}</span>
                        <span className="block truncate text-[11px] text-slate-500">{email.subject || "(sans objet)"}</span>
                      </span>
                      <span className="text-[10px] text-slate-500">{timeLabel(email.date)}</span>
                    </Link>
                  ))
                )}
              </div>
            </div>

            <div className="cockpit-reference-panel cockpit-electric-frame">
              <PanelHeader icon={Zap} title="Actions rapides" />
              <div className="grid grid-cols-2 gap-2 p-3">
                {quickActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Link key={action.label} to={action.to} className="cockpit-reference-quick-action">
                      <Icon className="h-5 w-5 text-blue-600" />
                      <span>{action.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="cockpit-reference-panel cockpit-electric-frame">
              <PanelHeader icon={FolderKanban} title="Projets récents" action="Voir tous" to="/projets" />
              <div className="divide-y divide-slate-900/5">
                {recentProjects.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-slate-500">Aucun projet récent.</div>
                ) : (
                  recentProjects.map((project) => (
                    <Link key={project.id} to="/projets" className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/45">
                      <span className="cockpit-reference-project-mark">{projectTitle(project).charAt(0).toUpperCase()}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold">{projectTitle(project)}</span>
                        <span className="block truncate text-[10px] text-slate-500">{projectClient(project) || "Projet JS-Innov.IA"}</span>
                      </span>
                      <span className="rounded-full bg-blue-500/10 px-2 py-1 text-[9px] font-semibold text-blue-700">
                        {project.statut || "actif"}
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </section>

          <section className="grid gap-3 lg:grid-cols-[1.2fr_.95fr_.9fr]">
            <div className="cockpit-reference-panel cockpit-electric-frame">
              <PanelHeader icon={CheckSquare} title="Tâches prioritaires" action={`Voir toutes (${tachesActives})`} to="/taches" />
              <div className="divide-y divide-slate-900/5">
                {tachesUrgentes.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-slate-500">Aucune tâche prioritaire.</div>
                ) : (
                  tachesUrgentes.map((task) => (
                    <Link key={task.id} to="/taches" className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/45">
                      <span className="h-4 w-4 rounded border border-slate-400/60 bg-white/50" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{task.titre || task.title || "Tâche"}</span>
                        <span className="block truncate text-[10px] text-slate-500">{task.projet_nom || task.client_nom || "Cockpit"}</span>
                      </span>
                      <span className={cn("rounded-full border px-2 py-1 text-[9px] font-semibold", priorityTone(task))}>
                        {isTaskBlocked(task) ? "Bloquée" : task.priorite || "Normale"}
                      </span>
                      <span className="text-[10px] text-slate-500">{task.date_echeance ? format(new Date(task.date_echeance), "dd/MM") : ""}</span>
                    </Link>
                  ))
                )}
              </div>
            </div>

            <div className="cockpit-reference-panel cockpit-electric-frame">
              <PanelHeader icon={Activity} title="Activité & Notifications" />
              <div className="divide-y divide-slate-900/5">
                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-slate-500">Aucune nouvelle activité.</div>
                ) : (
                  notifications.slice(0, 5).map((event) => (
                    <div key={event.id || `${event.title}-${event.created_at}`} className="flex items-start gap-3 px-4 py-2.5">
                      <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", event.severity === "critical" ? "bg-red-500" : event.severity === "warning" ? "bg-amber-500" : "bg-emerald-500")} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold">{event.title || "Activité Cockpit"}</p>
                        <p className="line-clamp-1 text-[10px] text-slate-500">{event.body || event.event_type || "Mise à jour"}</p>
                      </div>
                      <span className="text-[9px] text-slate-500">{timeLabel(event.created_at)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="cockpit-reference-panel cockpit-electric-frame">
              <PanelHeader icon={Target} title="Pipeline leads" action="Voir le pipeline" to="/leads" />
              <div className="space-y-3 p-4">
                {pipelineCounts.map((stage) => (
                  <div key={stage.key}>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="font-medium text-slate-600">{stage.label}</span>
                      <span className="font-bold text-slate-800">{stage.value}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/80">
                      <div className="h-full rounded-full bg-gradient-to-r from-blue-500 via-violet-500 to-amber-400" style={{ width: `${Math.max(stage.value ? 12 : 0, Math.round((stage.value / pipelineMax) * 100))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <aside className="cockpit-reference-elynea cockpit-electric-frame xl:sticky xl:top-4 xl:self-start">
          <div className="relative overflow-hidden rounded-[inherit]">
            <div className="cockpit-reference-elynea-portrait">
              <img src={OFFICIAL_ELYNEA_AVATAR} alt="Elynea" className="h-full w-full object-cover" />
              <span className="absolute right-4 top-4 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-950/60" />
            </div>
            <div className="p-4 text-white">
              <h2 className="text-xl font-bold">Elynea</h2>
              <p className="text-xs text-white/65">Votre assistante IA</p>

              <div className="mt-4 rounded-xl bg-white/90 p-3 text-slate-900 shadow-lg">
                <p className="text-sm font-semibold">Bonjour Julien ! 👋</p>
                <p className="mt-1 text-xs text-slate-600">Comment puis-je vous aider aujourd’hui ?</p>
              </div>

              <div className="mt-3 space-y-2">
                <button type="button" onClick={() => openElynea("Analyse mon activité du jour et indique-moi les priorités.")} className="cockpit-reference-elynea-action">
                  <CheckSquare className="h-4 w-4" /> Analyser mon activité
                </button>
                <button type="button" onClick={() => openElynea("Aide-moi à rédiger un email professionnel.")} className="cockpit-reference-elynea-action">
                  <Mail className="h-4 w-4" /> Rédiger un email
                </button>
                <button type="button" onClick={() => openElynea("Aide-moi à préparer un devis à partir du contexte disponible.")} className="cockpit-reference-elynea-action">
                  <FileText className="h-4 w-4" /> Préparer un devis
                </button>
                <button type="button" onClick={() => openElynea("Je veux rechercher une information dans mon environnement de travail.")} className="cockpit-reference-elynea-action">
                  <Search className="h-4 w-4" /> Rechercher une information
                </button>
              </div>

              <button type="button" onClick={() => openElynea("")} className="mt-3 flex w-full items-center justify-between rounded-xl bg-white px-3 py-2.5 text-left text-xs font-medium text-slate-500 shadow-lg">
                Posez-moi une question…
                <ArrowRight className="h-4 w-4 text-slate-900" />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
