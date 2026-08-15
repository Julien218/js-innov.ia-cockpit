import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, FileText, Receipt, Landmark, Network, BellRing, Calculator, Archive, ArrowRight } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const money = (value) => new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value || 0));

async function loadSummary() {
  const response = await fetch('/api/hainoflow/summary', { credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

const modules = [
  { title: 'Clients conformes', text: 'Coordonnées légales, TVA et anomalies', icon: Users, path: '/clients', key: 'clients' },
  { title: 'Devis', text: 'Création, PDF, suivi et conversion', icon: FileText, path: '/devis', key: 'devis' },
  { title: 'Factures', text: 'Archivage Dropbox, envois et paiements', icon: Receipt, path: '/factures', key: 'factures' },
  { title: 'Documents', text: 'Coffre documentaire et versions officielles', icon: Archive, path: '/documents', key: 'pdfDropbox' },
  { title: 'Paiements', text: 'Stripe et rapprochement automatique', icon: Landmark, key: 'paiements' },
  { title: 'Peppol', text: 'UBL structuré et e-facturation belge', icon: Network, key: 'peppol' },
  { title: 'Relances', text: 'Rappels intelligents et traçabilité', icon: BellRing, key: 'relances' },
  { title: 'Comptable', text: 'Exports et accès dédié au comptable', icon: Calculator, key: 'comptable' },
];

export default function HainoFlow() {
  const { data, isLoading, error } = useQuery({ queryKey: ['hainoflow-summary'], queryFn: loadSummary, staleTime: 30000 });
  const metrics = data?.metrics || {};
  return (
    <div className="space-y-6">
      <PageHeader title="HainoFlow" subtitle={`by JS-Innov.IA · ${data?.organisation || 'connexion en cours'}`} />
      <div className="rounded-2xl border border-blue-200 bg-gradient-to-r from-slate-950 via-blue-950 to-indigo-950 p-6 text-white shadow-xl">
        <p className="text-xs uppercase tracking-[0.3em] text-blue-200">Facturation intelligente multi-client</p>
        <h2 className="mt-2 text-2xl font-bold">Un seul moteur pour JS-Innov.IA et chaque futur client</h2>
        <p className="mt-2 max-w-3xl text-sm text-blue-100">Chaque organisation dispose de ses propres clients, devis, factures, documents et accès. Les données ne sont jamais mélangées.</p>
      </div>
      {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error.message}</div>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ['Clients', metrics.clients], ['Devis', metrics.devis], ['Factures', metrics.factures],
          ['Impayées', metrics.impayees], ['CA encaissé TTC', money(metrics.chiffreAffairesTtc)],
        ].map(([label, value]) => <Card key={label}><CardContent className="p-5"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold">{isLoading ? '…' : value ?? 0}</p></CardContent></Card>)}
      </div>
      {Number(metrics.clientsACompleter || 0) > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>{metrics.clientsACompleter} client(s)</strong> doivent encore compléter ou faire vérifier leurs informations légales.</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {modules.map((module) => {
          const status = data?.modules?.[module.key] || 'preparation';
          const Icon = module.icon;
          return <Card key={module.key} className="flex flex-col"><CardHeader><div className="flex items-center justify-between"><Icon className="h-6 w-6 text-primary" /><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{status === 'active' ? 'Actif' : 'Préparation'}</span></div><CardTitle className="text-base">{module.title}</CardTitle></CardHeader><CardContent className="flex flex-1 flex-col justify-between gap-4"><p className="text-sm text-muted-foreground">{module.text}</p>{module.path ? <Button asChild variant="outline" className="justify-between"><Link to={module.path}>Ouvrir <ArrowRight className="h-4 w-4" /></Link></Button> : <span className="text-xs text-muted-foreground">Activation après configuration du fournisseur</span>}</CardContent></Card>;
        })}
      </div>
    </div>
  );
}

