import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import {
  Users, Target, FolderKanban, FileText, Receipt,
  Shield, TrendingUp, ArrowRight, CheckSquare, MessageSquare, Clock, AlertCircle,
  PlayCircle, Plus, Sparkles, Mail
} from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import StatCard from "@/components/shared/StatCard";
import StatusBadge from "@/components/shared/StatusBadge";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell, CartesianGrid
} from "recharts";
import { cn } from "@/lib/utils";
import { isTaskBlocked, isTaskCompleted } from "@/lib/taskStatus";
import { useDemandes } from "@/lib/useDemandes";
import { isNewDemande } from "@/lib/demandePresentation";

const COLORS = ["hsl(217,91%,50%)", "hsl(258,90%,62%)", "hsl(142,71%,45%)", "hsl(38,92%,50%)", "hsl(0,84%,60%)"];

export default function Dashboard() {
  const { data: clients = [], isError: clientsErr } = useQuery({ queryKey: ["clients"], queryFn: () => base44.entities.Client.list() });
  const { data: leads = [], isError: leadsErr } = useQuery({ queryKey: ["leads"], queryFn: () => base44.entities.Lead.list() });
  const { data: projets = [], isError: projetsErr } = useQuery({ queryKey: ["projets"], queryFn: () => base44.entities.Projet.list() });
  const { data: taches = [], isError: tachesErr } = useQuery({ queryKey: ["taches"], queryFn: () => base44.entities.Tache.list() });
  const { data: demandes = [], isError: demandesErr } = useDemandes();
  const { data: devis = [], isError: devisErr } = useQuery({ queryKey: ["devis"], queryFn: () => base44.entities.Devis.list() });
  const { data: factures = [], isError: facturesErr } = useQuery({ queryKey: ["factures"], queryFn: () => base44.entities.Facture.list() });
  const { data: commissions = [], isError: commissionsErr } = useQuery({ queryKey: ["commissions"], queryFn: () => base44.entities.Commission.list() });
  const { data: emailOverview = { emails: [] }, isError: emailsErr } = useQuery({
    queryKey: ["dashboard-email-overview"],
    queryFn: async () => {
      const response = await fetch('/api/emails?limit=8', { credentials: 'same-origin' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || `Emails indisponibles (HTTP ${response.status})`);
      const emails = Array.isArray(data.emails) ? data.emails : [];
      const unreadFromApi = Number(data.unread);
      return {
        emails,
        unread: Number.isFinite(unreadFromApi) ? unreadFromApi : emails.filter(email => !email.seen).length,
      };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });


  const hasAnyError = clientsErr || leadsErr || projetsErr || tachesErr || demandesErr || devisErr || facturesErr || commissionsErr;

  const caTotal = factures.filter(f => f.statut === "payee").reduce((s, f) => s + (f.montant_ttc || 0), 0);
  const caEnAttente = factures.filter(f => ["envoyee", "en_retard"].includes(f.statut)).reduce((s, f) => s + (f.montant_ttc || 0), 0);
  const commTotal = commissions.filter(c => c.statut === "payee").reduce((s, c) => s + (c.montant || c.montant_commission || 0), 0);
  const leadsActifs = leads.filter(l => !["gagne", "perdu"].includes(l.statut)).length;
  const projetsEnCours = projets.filter(p => p.statut === "en_cours").length;
  const tachesEnRetard = taches.filter(t => t.date_echeance && new Date(t.date_echeance) < new Date() && !isTaskCompleted(t)).length;
  const tachesBloquees = taches.filter(isTaskBlocked).length;
  const tachesActives = taches.filter(t => !isTaskCompleted(t)).length;
  const demandesOuvertes = demandes.filter(isNewDemande).length;
  const emailsATraiter = Number.isFinite(Number(emailOverview.unread))
    ? Number(emailOverview.unread)
    : emailOverview.emails.filter(email => !email.seen).length;
  const emailsRecents = emailOverview.emails.filter(email => !email.seen).slice(0, 5);

  const leadsByStatus = [
    { name: "Nouveau", value: leads.filter(l => l.statut === "nouveau").length },
    { name: "Contacté", value: leads.filter(l => l.statut === "contacte").length },
    { name: "Qualifié", value: leads.filter(l => l.statut === "qualifie").length },
    { name: "Proposition", value: leads.filter(l => l.statut === "proposition").length },
    { name: "Gagné", value: leads.filter(l => l.statut === "gagne").length },
    { name: "Perdu", value: leads.filter(l => l.statut === "perdu").length },
  ].filter(l => l.value > 0);

  const monthlyRevenue = factures.filter(f => f.statut === "payee").reduce((acc, f) => {
    const month = f.date_paiement ? format(new Date(f.date_paiement), "MMM yy", { locale: fr }) : "N/A";
    const existing = acc.find(a => a.name === month);
    if (existing) existing.value += f.montant_ttc || 0;
    else acc.push({ name: month, value: f.montant_ttc || 0 });
    return acc;
  }, []);

  const recentLeads = [...leads].sort((a, b) => new Date(b.created_at || b.created_date || 0).getTime() - new Date(a.created_at || a.created_date || 0).getTime()).slice(0, 5);
  const tachesUrgentes = taches
    .filter(t => (t.priorite === "urgente" || t.priorite === "haute" || isTaskBlocked(t)) && !isTaskCompleted(t))
    .sort((a, b) => Number(isTaskBlocked(b)) - Number(isTaskBlocked(a)))
    .slice(0, 4);
  const heure = new Date().getHours();
  const salut = heure < 12 ? "Bonjour" : heure < 18 ? "Bon après-midi" : "Bonsoir";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{fontFamily: "'Space Grotesk', sans-serif"}}>
            {salut}, <span className="gradient-text">Julien</span> 👋
          </h1>
          <p className="text-sm text-muted-foreground mt-1 capitalize">
            {format(new Date(), "EEEE d MMMM yyyy", { locale: fr })}
          </p>
        </div>
        {(tachesEnRetard > 0 || demandesOuvertes > 0) && (
          <div className="flex gap-2">
            {tachesEnRetard > 0 && (
              <div className="flex items-center gap-1.5 bg-red-500/10 text-red-600 text-xs font-medium px-3 py-1.5 rounded-xl border border-red-500/20">
                <AlertCircle className="w-3.5 h-3.5" />
                {tachesEnRetard} tâche{tachesEnRetard > 1 ? "s" : ""} en retard
              </div>
            )}
            {demandesOuvertes > 0 && (
              <div className="flex items-center gap-1.5 bg-amber-500/10 text-amber-600 text-xs font-medium px-3 py-1.5 rounded-xl border border-amber-500/20">
                <MessageSquare className="w-3.5 h-3.5" />
                {demandesOuvertes} demande{demandesOuvertes > 1 ? "s" : ""} ouverte{demandesOuvertes > 1 ? "s" : ""}
              </div>
            )}
          </div>
        )}
      </div>

      {hasAnyError && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm text-amber-600 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>Certaines données n'ont pas pu être chargées. Les compteurs peuvent être incomplets.</span>
        </div>
      )}

      {/* Centre de travail quotidien */}
      <section className="workspace-hero cockpit-electric-frame">
        <div className="relative z-10 flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Centre de pilotage
            </div>
            <h2 className="text-xl font-semibold sm:text-2xl">À traiter maintenant</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Commence par les blocages et retards, puis reprends la production. Les informations secondaires restent accessibles plus bas.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/taches" className="premium-button h-10 gap-2 px-4 text-sm">
                <CheckSquare className="h-4 w-4" /> Ouvrir le travail du jour
              </Link>
              <Link to="/production" className="workspace-secondary-action">
                <PlayCircle className="h-4 w-4" /> Reprendre la production
              </Link>
              <Link to="/clients" className="workspace-secondary-action">
                <Plus className="h-4 w-4" /> Nouveau client
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:min-w-[640px]">
            <Link to="/taches" className="workspace-focus-card workspace-focus-danger">
              <span className="workspace-focus-value">{tachesBloquees}</span>
              <span className="workspace-focus-label">bloquées</span>
            </Link>
            <Link to="/taches" className="workspace-focus-card workspace-focus-warning">
              <span className="workspace-focus-value">{tachesEnRetard}</span>
              <span className="workspace-focus-label">en retard</span>
            </Link>
            <Link to="/taches" className="workspace-focus-card">
              <span className="workspace-focus-value">{tachesActives}</span>
              <span className="workspace-focus-label">à traiter</span>
            </Link>
            <Link to="/demandes" className="workspace-focus-card">
              <span className="workspace-focus-value">{demandesOuvertes}</span>
              <span className="workspace-focus-label">demandes</span>
            </Link>
            <Link to="/emails" className="workspace-focus-card">
              <span className="workspace-focus-value">{emailsATraiter}</span>
              <span className="workspace-focus-label">emails à traiter</span>
            </Link>
          </div>
        </div>
      </section>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10 gap-3">
        <div className="col-span-2">
          <StatCard title="CA encaissé" value={`${caTotal.toLocaleString("fr-FR")} €`} icon={TrendingUp} color="success" subtitle={caEnAttente > 0 ? `+ ${caEnAttente.toLocaleString("fr-FR")} € en attente` : undefined} />
        </div>
        <div className="col-span-2">
          <StatCard title="Commissions" value={`${commTotal.toLocaleString("fr-FR")} €`} icon={Shield} color="accent" />
        </div>
        <StatCard title="Clients" value={clients.length} icon={Users} color="primary" />
        <StatCard title="Leads actifs" value={leadsActifs} icon={Target} color="warning" />
        <StatCard title="Projets" value={projetsEnCours} icon={FolderKanban} color="primary" subtitle="en cours" />
        <StatCard title="Devis" value={devis.filter(d => d.statut === "envoye").length} icon={FileText} color="accent" subtitle="envoyés" />
        <StatCard title="Emails" value={emailsATraiter} icon={Mail} color={emailsATraiter > 0 ? "warning" : "primary"} subtitle="à traiter" />
        <StatCard title="Tâches" value={tachesActives} icon={CheckSquare} color={tachesEnRetard > 0 ? "destructive" : "primary"} subtitle={tachesEnRetard > 0 ? `${tachesEnRetard} en retard` : "actives"} />
      </div>


      {/* Recap emails a traiter */}
      <section className="cockpit-float-panel cockpit-electric-frame">
        <div className="flex items-center justify-between gap-3 border-b border-slate-900/5 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="cockpit-icon-chip"><Mail className="h-4 w-4" /></span>
            <div>
              <h3 className="text-sm font-semibold" style={{fontFamily: "'Space Grotesk', sans-serif"}}>Emails à traiter</h3>
              <p className="text-[11px] text-muted-foreground">
                {emailsErr ? "La boîte mail n’est pas disponible pour le moment." : emailsATraiter > 0 ? `${emailsATraiter} message${emailsATraiter > 1 ? "s" : ""} non lu${emailsATraiter > 1 ? "s" : ""}` : "Aucun email en attente."}
              </p>
            </div>
          </div>
          <Link to="/emails" className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
            Ouvrir la messagerie <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="divide-y divide-slate-900/5">
          {emailsErr ? (
            <div className="px-5 py-4 text-sm text-muted-foreground">Impossible de charger le récapitulatif email.</div>
          ) : emailsRecents.length === 0 ? (
            <div className="px-5 py-4 text-sm text-muted-foreground">Tout est traité dans la boîte de réception.</div>
          ) : emailsRecents.map((email) => (
            <Link key={email.uid || `${email.from}-${email.date}-${email.subject}`} to="/emails" className="flex items-center gap-3 px-5 py-3 transition hover:bg-white/30">
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,.35)]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{email.subject || "(sans objet)"}</p>
                <p className="truncate text-xs text-muted-foreground">{email.from || "Expéditeur inconnu"}</p>
              </div>
              <span className="text-[10px] text-muted-foreground">{email.date && Number.isFinite(new Date(email.date).getTime()) ? format(new Date(email.date), "dd/MM HH:mm") : ""}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Revenue Chart */}
        <div className="cockpit-float-panel cockpit-electric-frame lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{fontFamily: "'Space Grotesk', sans-serif"}}>Chiffre d'affaires</h3>
            <Link to="/factures" className="text-xs text-primary hover:underline flex items-center gap-1">
              Voir factures <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="h-52">
            {monthlyRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyRevenue} barCategoryGap="35%">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,13%,91%)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(220,9%,46%)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(220,9%,46%)" }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => [`${v.toLocaleString("fr-FR")} €`, "CA"]} contentStyle={{ borderRadius: "12px", border: "1px solid hsl(220,13%,88%)", fontSize: "12px" }} />
                  <Bar dataKey="value" fill="hsl(217,91%,50%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                <Receipt className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">Aucune facture payée</p>
              </div>
            )}
          </div>
        </div>

        {/* Leads Pipeline */}
        <div className="cockpit-float-panel cockpit-electric-frame p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{fontFamily: "'Space Grotesk', sans-serif"}}>Pipeline leads</h3>
            <Link to="/leads" className="text-xs text-primary hover:underline flex items-center gap-1">
              Voir tout <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="h-52">
            {leads.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={leadsByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} innerRadius={40} strokeWidth={2} stroke="white">
                    {leadsByStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: "12px", fontSize: "12px" }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                <Target className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">Aucun lead</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent Leads */}
        {recentLeads.length > 0 && <div className="cockpit-float-panel cockpit-electric-frame">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold" style={{fontFamily: "'Space Grotesk', sans-serif"}}>Derniers leads</h3>
            <Link to="/leads" className="text-xs text-primary hover:underline flex items-center gap-1">Voir tout <ArrowRight className="w-3 h-3" /></Link>
          </div>
          <div className="divide-y divide-border">
            {recentLeads.map((lead) => (
              <div key={lead.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">
                    {(lead.prenom || lead.nom || "?").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{lead.prenom} {lead.nom}</p>
                    <p className="text-xs text-muted-foreground">{lead.entreprise || lead.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {lead.valeur_estimee > 0 && <span className="text-sm font-semibold text-foreground">{lead.valeur_estimee?.toLocaleString("fr-FR")} €</span>}
                  <StatusBadge status={lead.statut} />
                </div>
              </div>
            ))}
          </div>
        </div>}

        {/* Tâches urgentes */}
        <div className={cn("cockpit-float-panel cockpit-electric-frame", recentLeads.length === 0 && "lg:col-span-2")}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold" style={{fontFamily: "'Space Grotesk', sans-serif"}}>Tâches prioritaires</h3>
            <Link to="/taches" className="text-xs text-primary hover:underline flex items-center gap-1">Voir tout <ArrowRight className="w-3 h-3" /></Link>
          </div>
          <div className="divide-y divide-border">
            {tachesUrgentes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <CheckSquare className="w-7 h-7 mb-2 opacity-30" />
                <p className="text-sm">Aucune tâche urgente</p>
              </div>
            ) : tachesUrgentes.map((t) => {
              const retard = t.date_echeance && new Date(t.date_echeance) < new Date();
              return (
                <div key={t.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3">
                    {retard ? <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" /> : <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />}
                    <div>
                      <p className="text-sm font-medium">{t.titre}</p>
                      <p className="text-xs text-muted-foreground">{t.projet_nom || t.client_nom || "—"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.date_echeance && (
                      <span className={cn("text-xs", retard ? "text-red-500 font-medium" : "text-muted-foreground")}>
                        {format(new Date(t.date_echeance), "dd/MM")}
                      </span>
                    )}
                    <StatusBadge status={t.priorite} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
