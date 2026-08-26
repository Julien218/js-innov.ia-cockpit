import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Building2,
  ExternalLink,
  Github,
  Globe2,
  RefreshCw,
  Server,
  Smartphone,
  Users,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";

const FALLBACK = {
  site: "https://villeconnectos.com/",
  app: "https://app.villeconnectos.com/",
  github: "https://github.com/Julien218/villeconnect",
  railway: "https://railway.com/project/12d50906-8d50-40fd-902d-76c37bd651eb",
};

function StatusPill({ healthy, loading }) {
  const text = loading ? "Vérification…" : healthy ? "Opérationnel" : "À contrôler";
  const classes = loading
    ? "bg-amber-100 text-amber-800"
    : healthy
      ? "bg-emerald-100 text-emerald-800"
      : "bg-red-100 text-red-800";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classes}`}>{text}</span>;
}

function ServiceCard({ icon: Icon, title, description, healthy, loading, value, url, action }) {
  return (
    <article className="rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Icon className="h-5 w-5" /></div>
        <StatusPill healthy={healthy} loading={loading} />
      </div>
      <h2 className="mt-4 text-base font-bold">{title}</h2>
      <p className="mt-1 min-h-10 text-sm text-muted-foreground">{description}</p>
      {value !== undefined && value !== null && <p className="mt-3 text-2xl font-bold text-primary">{value}</p>}
      {url && (
        <Button asChild variant="outline" className="mt-4 w-full">
          <a href={url} target="_blank" rel="noopener noreferrer">
            {action || "Ouvrir"}<ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </Button>
      )}
    </article>
  );
}

export default function VilleConnect() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/villeconnect/status", { credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      setStatus(payload);
    } catch {
      setStatus({ healthy: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const interval = window.setInterval(loadStatus, 30000);
    return () => window.clearInterval(interval);
  }, [loadStatus]);

  const checkedAt = useMemo(() => {
    if (!status?.checked_at) return "Pas encore contrôlé";
    return new Intl.DateTimeFormat("fr-BE", { dateStyle: "short", timeStyle: "medium" }).format(new Date(status.checked_at));
  }, [status?.checked_at]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <PageHeader
        title="VilleConnectOS"
        subtitle="Pilotage central du site public, de l’application DourConnect et de l’API métier"
      />

      <section className="overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-[#100626] via-[#18143b] to-[#072f46] p-6 text-white shadow-lg">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-violet-200"><Building2 className="h-5 w-5" /><span className="text-sm font-semibold">Projet interne JS-Innov.IA</span></div>
            <h1 className="mt-2 text-2xl font-bold md:text-3xl">Un seul projet, trois surfaces reliées</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">Le site présente VilleConnectOS, l’application DourConnect sert les utilisateurs et l’API Railway porte les données. Ce module contrôle leur disponibilité depuis votre Cockpit.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill healthy={status?.healthy} loading={loading} />
            <Button variant="secondary" onClick={loadStatus} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualiser
            </Button>
          </div>
        </div>
        <p className="mt-4 text-xs text-slate-400">Dernier contrôle : {checkedAt}</p>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ServiceCard icon={Globe2} title="Site public" description="Vitrine et inscriptions VilleConnectOS" healthy={status?.site?.healthy} loading={loading} url={status?.site?.url || FALLBACK.site} action="Voir le site" />
        <ServiceCard icon={Smartphone} title="Application DourConnect" description="Application web actuellement en construction et déjà accessible" healthy={status?.application?.healthy} loading={loading} url={status?.application?.url || FALLBACK.app} action="Ouvrir l’application" />
        <ServiceCard icon={Server} title="API Railway" description={`Service ${status?.api?.service || "VilleConnect"}`} healthy={status?.api?.healthy} loading={loading} value={status?.api?.version ? `v${status.api.version}` : "—"} />
        <ServiceCard icon={Users} title="Liste d’attente" description="Inscriptions reçues par l’API VilleConnect" healthy={status?.waitlist?.healthy} loading={loading} value={status?.waitlist?.count ?? "—"} />
      </div>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Connexion du projet</h2></div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {["Site public", "API Railway", "Application DourConnect", "Cockpit JS-Innov.IA"].map((label, index) => (
            <div key={label} className="relative rounded-xl border border-border bg-muted/30 p-4 text-center text-sm font-semibold">
              <span className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">{index + 1}</span>
              <p>{label}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild variant="outline"><a href={status?.github?.url || FALLBACK.github} target="_blank" rel="noopener noreferrer"><Github className="mr-2 h-4 w-4" />Dépôt GitHub<ExternalLink className="ml-2 h-4 w-4" /></a></Button>
          <Button asChild variant="outline"><a href={status?.railway?.url || FALLBACK.railway} target="_blank" rel="noopener noreferrer"><Server className="mr-2 h-4 w-4" />Service Railway<ExternalLink className="ml-2 h-4 w-4" /></a></Button>
        </div>
      </section>

      {!loading && !status?.healthy && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Un composant ne répond pas correctement. Le Cockpit ne le déclare pas opérationnel sans preuve et continuera le contrôle automatiquement.</div>
      )}
    </div>
  );
}
