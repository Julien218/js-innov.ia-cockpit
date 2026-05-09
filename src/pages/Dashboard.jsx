import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Users, Target, FolderKanban, FileText, Receipt, Shield, TrendingUp, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import StatCard from "@/components/shared/StatCard";
import StatusBadge from "@/components/shared/StatusBadge";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell } from "recharts";

const COLORS = ["hsl(221,83%,53%)", "hsl(262,83%,58%)", "hsl(142,71%,45%)", "hsl(38,92%,50%)", "hsl(0,84%,60%)"];

export default function Dashboard() {
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => base44.entities.Client.list() });
  const { data: leads = [] } = useQuery({ queryKey: ["leads"], queryFn: () => base44.entities.Lead.list() });
  const { data: projets = [] } = useQuery({ queryKey: ["projets"], queryFn: () => base44.entities.Projet.list() });
  const { data: devis = [] } = useQuery({ queryKey: ["devis"], queryFn: () => base44.entities.Devis.list() });
  const { data: factures = [] } = useQuery({ queryKey: ["factures"], queryFn: () => base44.entities.Facture.list() });
  const { data: commissions = [] } = useQuery({ queryKey: ["commissions"], queryFn: () => base44.entities.Commission.list() });

  const caTotal = factures.filter(f => f.statut === "payee").reduce((s, f) => s + (f.montant_ttc || 0), 0);
  const commTotal = commissions.filter(c => c.statut === "percue").reduce((s, c) => s + (c.montant_commission || 0), 0);
  const leadsActifs = leads.filter(l => !["gagne", "perdu"].includes(l.statut)).length;
  const projetsEnCours = projets.filter(p => p.statut === "en_cours").length;

  const leadsByStatus = ["nouveau", "contacte", "qualifie", "proposition", "gagne", "perdu"].map(s => ({
    name: s.charAt(0).toUpperCase() + s.slice(1).replace("_", " "),
    value: leads.filter(l => l.statut === s).length,
  }));

  const recentLeads = [...leads].sort((a, b) => new Date(b.created_date) - new Date(a.created_date)).slice(0, 5);

  const monthlyRevenue = factures.filter(f => f.statut === "payee").reduce((acc, f) => {
    const month = f.date_paiement ? format(new Date(f.date_paiement), "MMM", { locale: fr }) : "N/A";
    const existing = acc.find(a => a.name === month);
    if (existing) existing.value += f.montant_ttc || 0;
    else acc.push({ name: month, value: f.montant_ttc || 0 });
    return acc;
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground mt-1">Vue d'ensemble de votre activité</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="Clients" value={clients.length} icon={Users} color="primary" />
        <StatCard title="Leads actifs" value={leadsActifs} icon={Target} color="accent" />
        <StatCard title="Projets en cours" value={projetsEnCours} icon={FolderKanban} color="warning" />
        <StatCard title="Devis" value={devis.length} icon={FileText} color="primary" />
        <StatCard title="CA encaissé" value={`${caTotal.toLocaleString("fr-FR")} €`} icon={TrendingUp} color="success" />
        <StatCard title="Commissions" value={`${commTotal.toLocaleString("fr-FR")} €`} icon={Shield} color="accent" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Chiffre d'affaires</h3>
          <div className="h-56">
            {monthlyRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyRevenue}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => `${v.toLocaleString("fr-FR")} €`} />
                  <Bar dataKey="value" fill="hsl(221,83%,53%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Aucune donnée</div>
            )}
          </div>
        </div>

        {/* Leads Pipeline */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Pipeline leads</h3>
          <div className="h-56">
            {leads.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={leadsByStatus.filter(l => l.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={45} strokeWidth={2}>
                    {leadsByStatus.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Aucun lead</div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Leads */}
      <div className="bg-card rounded-xl border border-border">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-sm font-semibold">Derniers leads</h3>
          <Link to="/leads" className="text-xs text-primary hover:underline flex items-center gap-1">
            Voir tout <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="divide-y divide-border">
          {recentLeads.length === 0 && (
            <p className="text-center py-8 text-muted-foreground text-sm">Aucun lead</p>
          )}
          {recentLeads.map((lead) => (
            <div key={lead.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-sm font-medium">{lead.prenom} {lead.nom}</p>
                <p className="text-xs text-muted-foreground">{lead.entreprise || lead.email}</p>
              </div>
              <div className="flex items-center gap-3">
                {lead.valeur_estimee > 0 && (
                  <span className="text-sm font-semibold">{lead.valeur_estimee?.toLocaleString("fr-FR")} €</span>
                )}
                <StatusBadge status={lead.statut} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}