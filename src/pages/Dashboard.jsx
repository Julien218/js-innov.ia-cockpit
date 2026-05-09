import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import {
  Users, Target, FolderKanban, FileText, Receipt,
  Shield, TrendingUp, ArrowRight, CheckSquare, MessageSquare, Clock, AlertCircle
} from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import StatCard from "@/components/shared/StatCard";
import StatusBadge from "@/components/shared/StatusBadge";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid
} from "recharts";
import { cn } from "@/lib/utils";

const COLORS = ["hsl(217,91%,50%)", "hsl(258,90%,62%)", "hsl(142,71%,45%)", "hsl(38,92%,50%)", "hsl(0,84%,60%)"];

export default function Dashboard() {
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => base44.entities.Client.list() });
  const { data: leads = [] } = useQuery({ queryKey: ["leads"], queryFn: () => base44.entities.Lead.list() });
  const { data: projets = [] } = useQuery({ queryKey: ["projets"], queryFn: () => base44.entities.Projet.list() });
  const { data: taches = [] } = useQuery({ queryKey: ["taches"], queryFn: () => base44.entities.Tache.list() });
  const { data: demandes = [] } = useQuery({ queryKey: ["demandes"], queryFn: () => base44.entities.Demande.list() });
  const { data: devis = [] } = useQuery({ queryKey: ["devis"], queryFn: () => base44.entities.Devis.list() });
  const { data: factures = [] } = useQuery({ queryKey: ["factures"], queryFn: () => base44.entities.Facture.list() });
  const { data: commissions = [] } = useQuery({ queryKey: ["commissions"], queryFn: () => base44.entities.Commission.list() });

  const caTotal = factures.filter(f => f.statut === "payee").reduce((s, f) => s + (f.montant_ttc || 0), 0);
  const caEnAttente = factures.filter(f => ["envoyee", "en_retard"].includes(f.statut)).reduce((s, f) => s + (f.montant_ttc || 0), 0);
  const commTotal = commissions.filter(c => c.statut === "percue").reduce((s, c) => s + (c.montant_commission || 0), 0);
  const leadsActifs = leads.filter(l => !["gagne", "perdu"].includes(l.statut)).length;
  const projetsEnCours = projets.filter(p => p.statut === "en_cours").length;
  const tachesEnRetard = taches.filter(t => t.date_echeance && new Date(t.date_echeance) < new Date() && t.statut !== "terminee").length;
  const demandesOuvertes = demandes.filter(d => d.statut === "ouverte").length;

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

  const recentLeads = [...leads].sort((a, b) => new Date(b.created_date) - new Date(a.created_date)).slice(0, 5);
  const tachesUrgentes = taches.filter(t => (t.priorite === "urgente" || t.priorite === "haute") && t.statut !== "terminee").slice(0, 4);
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
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
        <StatCard title="Tâches" value={taches.filter(t => t.statut !== "terminee").length} icon={CheckSquare} color={tachesEnRetard > 0 ? "destructive" : "primary"} subtitle={tachesEnRetard > 0 ? `${tachesEnRetard} en retard` : "actives"} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Revenue Chart */}
        <div className="lg:col-span-2 bg-card rounded-2xl border border-border p-5">
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
        <div className="bg-card rounded-2xl border border-border p-5">
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
        <div className="bg-card rounded-2xl border border-border">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold" style={{fontFamily: "'Space Grotesk', sans-serif"}}>Derniers leads</h3>
            <Link to="/leads" className="text-xs text-primary hover:underline flex items-center gap-1">Voir tout <ArrowRight className="w-3 h-3" /></Link>
          </div>
          <div className="divide-y divide-border">
            {recentLeads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <Target className="w-7 h-7 mb-2 opacity-30" />
                <p className="text-sm">Aucun lead</p>
              </div>
            ) : recentLeads.map((lead) => (
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
        </div>

        {/* Tâches urgentes */}
        <div className="bg-card rounded-2xl border border-border">
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
