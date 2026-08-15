import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Building2, CircleDollarSign, FolderKanban, RefreshCw, Server, Sparkles } from 'lucide-react';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function eurMinor(value) {
  return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' }).format(Number(value || 0) / 100);
}

function usd(value) {
  return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'USD', maximumFractionDigits: 3 }).format(Number(value || 0));
}

async function fetchJson(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  return data;
}

export default function ProjectCosts() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [notice, setNotice] = useState('');

  const { data: projects = [] } = useQuery({
    queryKey: ['Projet', 'cost-tracking'],
    queryFn: () => base44.entities.Projet.list('-created_at'),
  });

  const summaryQuery = useQuery({
    queryKey: ['project-costs', month],
    queryFn: () => fetchJson(`/api/project-costs/summary?month=${encodeURIComponent(month)}`),
    refetchInterval: 60000,
  });

  const activate = useMutation({
    mutationFn: ({ project, billingMode }) => fetchJson('/api/project-costs/scopes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner_type: project.client_id ? 'client' : 'internal',
        client_id: project.client_id || null,
        client_name: project.client_nom || null,
        project_id: project.id,
        project_name: project.nom,
        billing_mode: project.client_id ? billingMode : 'track_only',
      }),
    }),
    onSuccess: () => {
      setNotice('Suivi du projet activé.');
      qc.invalidateQueries({ queryKey: ['project-costs'] });
    },
    onError: (error) => setNotice(error.message),
  });

  const trackedByProject = useMemo(() => {
    const map = new Map();
    for (const item of summaryQuery.data?.items || []) map.set(item.project_id, item);
    return map;
  }, [summaryQuery.data]);

  const totals = summaryQuery.data?.totals || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><FolderKanban className="w-5 h-5" /></div>
            <div>
              <h1 className="text-2xl font-bold">Coûts par projet</h1>
              <p className="text-sm text-muted-foreground">IA, Railway et autres services attribués à chaque projet client ou interne JS-Innov.IA.</p>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 px-3 rounded-xl border border-border bg-background text-sm" />
          <Button variant="outline" onClick={() => summaryQuery.refetch()}><RefreshCw className={`w-4 h-4 mr-2 ${summaryQuery.isFetching ? 'animate-spin' : ''}`} />Actualiser</Button>
        </div>
      </div>

      {notice && <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">{notice}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground uppercase">Total suivi</p><p className="text-2xl font-bold mt-1">{eurMinor(totals.eur_minor)}</p><p className="text-xs text-muted-foreground">{usd(totals.usd)} côté fournisseurs USD</p></div>
        <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground uppercase">Projets internes</p><p className="text-2xl font-bold mt-1">{eurMinor(totals.internal_eur_minor)}</p><p className="text-xs text-muted-foreground">Suivi uniquement — aucune facture</p></div>
        <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground uppercase">Projets clients</p><p className="text-2xl font-bold mt-1">{eurMinor(totals.client_eur_minor)}</p><p className="text-xs text-muted-foreground">Facturables uniquement après validation</p></div>
      </div>

      <div className="space-y-3">
        {(Array.isArray(projects) ? projects : []).map((project) => {
          const tracked = trackedByProject.get(project.id);
          const isClient = Boolean(project.client_id);
          return (
            <div key={project.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {isClient ? <Building2 className="w-4 h-4 text-primary" /> : <Sparkles className="w-4 h-4 text-primary" />}
                    <h2 className="font-semibold truncate">{project.nom}</h2>
                    <span className="text-[10px] uppercase rounded-full bg-muted px-2 py-1 text-muted-foreground">{isClient ? 'Client' : 'Interne'}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{project.client_nom || 'JS-Innov.IA'} · {project.statut || 'sans statut'}</p>
                </div>

                {!tracked ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => activate.mutate({ project, billingMode: 'track_only' })}>Suivre les coûts</Button>
                    {isClient && <Button size="sm" onClick={() => activate.mutate({ project, billingMode: 'draft_for_approval' })}>Suivi + facture brouillon</Button>}
                  </div>
                ) : (
                  <div className="text-right">
                    <p className="text-xl font-bold">{eurMinor(tracked.total_eur_minor)}</p>
                    <p className="text-xs text-muted-foreground">{tracked.ai_requests || 0} appels IA · {tracked.billing_mode === 'draft_for_approval' ? 'facture avec validation' : 'suivi uniquement'}</p>
                  </div>
                )}
              </div>

              {tracked && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  {(tracked.providers || []).map((provider) => (
                    <div key={provider.provider} className="rounded-xl border border-border/70 bg-muted/30 p-3">
                      <div className="flex items-center justify-between gap-2"><span className="font-medium text-sm capitalize">{provider.provider}</span>{provider.provider === 'railway' ? <Server className="w-4 h-4 text-muted-foreground" /> : <CircleDollarSign className="w-4 h-4 text-muted-foreground" />}</div>
                      <p className="text-lg font-semibold mt-1">{eurMinor(provider.cost_eur_minor)}</p>
                      <p className="text-[11px] text-muted-foreground">{usd(provider.cost_usd)} · {(provider.sources || []).join(', ')}</p>
                    </div>
                  ))}
                  {(tracked.providers || []).length === 0 && <p className="text-sm text-muted-foreground col-span-full">Aucun coût enregistré pour ce mois.</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}