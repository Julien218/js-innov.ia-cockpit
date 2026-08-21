import React, { useMemo, useState } from "react";
import PageHeader from "@/components/shared/PageHeader";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
  XCircle,
} from "lucide-react";

// Inventaire métier uniquement. Les statuts techniques ne sont plus codés en dur :
// ils proviennent de /api/domain-ops/analyze au moment du contrôle.
const DOMAINS = [
  { name: "jsinnovia.com", dest: "Base44", app: "JS-INNOV.IA", email: "IONOS", agent: "JsInnov-Agent" },
  { name: "cockpit.jsinnovia.com", dest: "Railway", app: "cockpit-v3", email: "—", agent: "JsInnov-Agent" },
  { name: "jsinnovia.store", dest: "IONOS / web", app: "JS-INNOV.IA", email: "IONOS", agent: "JsInnov-Agent" },
  { name: "assurances-dour.be", dest: "Base44", app: "assurances-dour.be", email: "IONOS", agent: "JsInnov-Agent" },
  { name: "letourdedour.com", dest: "Base44", app: "Multi site", email: "—", agent: "Site Olivier landing Page" },
  { name: "oliviertrevis.be", dest: "Base44", app: "Multi site", email: "—", agent: "Site Olivier landing Page" },
  { name: "synergiedour.be", dest: "Base44", app: "SynergieDour.be", email: "—", agent: "Synergie Dour Assistant" },
  { name: "missetmisterdour.be", dest: "Base44", app: "Miss DOUR", email: "—", agent: "Agent Miss & Mister Dour" },
  { name: "fashionistartdour.be", dest: "Base44", app: "Fashionist'ART", email: "—", agent: "Agent Fashionistart" },
];

async function api(path, body) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.payload = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

function StatusPill({ state, goodLabel, badLabel, unknownLabel = "Non analysé" }) {
  if (state === true) {
    return <span className="inline-flex items-center gap-1 text-emerald-600 text-xs"><CheckCircle2 className="w-3.5 h-3.5" />{goodLabel}</span>;
  }
  if (state === false) {
    return <span className="inline-flex items-center gap-1 text-red-600 text-xs"><XCircle className="w-3.5 h-3.5" />{badLabel}</span>;
  }
  return <span className="inline-flex items-center gap-1 text-muted-foreground text-xs"><AlertCircle className="w-3.5 h-3.5" />{unknownLabel}</span>;
}

function SeoPill({ score }) {
  if (!Number.isFinite(score)) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={cn(
      "inline-flex px-2 py-1 rounded-full text-[11px] font-semibold",
      score >= 85 ? "bg-emerald-500/10 text-emerald-600" :
      score >= 60 ? "bg-amber-500/10 text-amber-600" : "bg-red-500/10 text-red-600"
    )}>
      {score}/100
    </span>
  );
}

function ActionButton({ onClick, busy, icon: Icon, children, variant = "default", disabled = false }) {
  const variants = {
    default: "border-border hover:border-primary/40 text-foreground",
    repair: "border-amber-500/30 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10",
    seo: "border-violet-500/30 bg-violet-500/5 text-violet-700 hover:bg-violet-500/10",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={cn("h-8 px-2.5 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-50", variants[variant])}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
      {children}
    </button>
  );
}

export default function Domaines() {
  const [search, setSearch] = useState("");
  const [diagnostics, setDiagnostics] = useState({});
  const [loading, setLoading] = useState({});
  const [selectedDomain, setSelectedDomain] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [operationResult, setOperationResult] = useState(null);
  const [banner, setBanner] = useState(null);

  const filtered = useMemo(() => {
    if (!search) return DOMAINS;
    const value = search.toLowerCase();
    return DOMAINS.filter((domain) =>
      domain.name.includes(value)
      || domain.app.toLowerCase().includes(value)
      || domain.agent.toLowerCase().includes(value)
      || domain.dest.toLowerCase().includes(value)
    );
  }, [search]);

  const stats = useMemo(() => {
    const values = Object.values(diagnostics);
    return {
      total: DOMAINS.length,
      analyzed: values.length,
      healthy: values.filter((item) => item?.healthy).length,
      critical: values.filter((item) => item?.issues?.some((issue) => issue.severity === "critical")).length,
    };
  }, [diagnostics]);

  const setBusy = (domain, key, value) => {
    setLoading((previous) => ({ ...previous, [`${domain}:${key}`]: value }));
  };

  const analyze = async (domain, openDetails = true) => {
    setBusy(domain, "analyze", true);
    setBanner(null);
    try {
      const result = await api("/api/domain-ops/analyze", { domain });
      setDiagnostics((previous) => ({ ...previous, [domain]: result }));
      if (openDetails) setSelectedDomain(domain);
      return result;
    } catch (error) {
      setBanner({ type: "error", text: `${domain} : ${error.message}` });
      return null;
    } finally {
      setBusy(domain, "analyze", false);
    }
  };

  const analyzeAll = async () => {
    setBanner({ type: "info", text: "Analyse live de tous les domaines en cours…" });
    for (let index = 0; index < DOMAINS.length; index += 3) {
      await Promise.all(DOMAINS.slice(index, index + 3).map((domain) => analyze(domain.name, false)));
    }
    setBanner({ type: "success", text: "Analyse live terminée. Les statuts affichés proviennent des mesures actuelles." });
  };

  const prepareAction = async (domain, kind) => {
    setBusy(domain, kind, true);
    setBanner(null);
    setOperationResult(null);
    try {
      const prepared = await api("/api/domain-ops/prepare-repair", { domain, kind });
      setDiagnostics((previous) => ({ ...previous, [domain]: prepared.before }));
      setSelectedDomain(domain);
      setConfirmation(prepared);
    } catch (error) {
      setBanner({ type: "error", text: `${domain} : ${error.message}` });
    } finally {
      setBusy(domain, kind, false);
    }
  };

  const confirmAction = async () => {
    if (!confirmation?.confirmation?.token) return;
    const domain = confirmation.domain;
    setBusy(domain, "confirm", true);
    setBanner(null);
    try {
      const result = await api("/api/domain-ops/repair", { token: confirmation.confirmation.token });
      setOperationResult(result);
      if (result.after) setDiagnostics((previous) => ({ ...previous, [domain]: result.after }));
      setConfirmation(null);
      setBanner({
        type: result.verified ? "success" : "warning",
        text: result.verified
          ? `${domain} : correction appliquée et vérifiée automatiquement.`
          : `${domain} : intervention lancée mais amélioration non vérifiée. La tâche reste bloquée pour contrôle.`,
      });
    } catch (error) {
      const payload = error.payload || {};
      if (payload.after) setDiagnostics((previous) => ({ ...previous, [domain]: payload.after }));
      setOperationResult(payload);
      setConfirmation(null);
      setBanner({ type: "error", text: `${domain} : ${error.message}` });
    } finally {
      setBusy(domain, "confirm", false);
    }
  };

  const selected = selectedDomain ? diagnostics[selectedDomain] : null;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Domaines"
        subtitle="Monitoring live · diagnostic IA · réparation confirmée · SEO automatique"
      />

      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Domaines</p>
            <p className="text-xl font-bold mt-1">{stats.total}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Analysés live</p>
            <p className="text-xl font-bold mt-1">{stats.analyzed}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Sains</p>
            <p className="text-xl font-bold mt-1 text-emerald-600">{stats.healthy}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] uppercase text-muted-foreground">Critiques</p>
            <p className="text-xl font-bold mt-1 text-red-600">{stats.critical}</p>
          </div>
        </div>
        <button
          onClick={analyzeAll}
          className="h-10 px-4 rounded-xl border border-border bg-card hover:border-primary/40 text-sm font-medium inline-flex items-center justify-center gap-2"
        >
          <RefreshCw className="w-4 h-4" /> Analyser tous
        </button>
      </div>

      {banner && (
        <div className={cn(
          "rounded-xl border px-4 py-3 text-sm",
          banner.type === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" :
          banner.type === "error" ? "border-red-500/30 bg-red-500/10 text-red-700" :
          banner.type === "warning" ? "border-amber-500/30 bg-amber-500/10 text-amber-700" :
          "border-blue-500/30 bg-blue-500/10 text-blue-700"
        )}>
          {banner.text}
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Rechercher domaine, app ou agent métier…"
          className="flex-1 bg-transparent outline-none text-sm"
        />
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden overflow-x-auto">
        <table className="min-w-[1180px] w-full">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {['Domaine', 'HTTP', 'WWW', 'TLS', 'SEO', 'Agent métier', 'Dernier contrôle', 'Actions IA'].map((label) => (
                <th key={label} className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-2.5 px-3">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((domain) => {
              const status = diagnostics[domain.name];
              const http = status?.http?.apex;
              const www = status?.http?.www;
              const tls = status?.tls;
              const isAnalyzing = loading[`${domain.name}:analyze`];
              return (
                <tr key={domain.name} className="border-b border-border hover:bg-muted/20 align-top">
                  <td className="py-3 px-3">
                    <button onClick={() => status && setSelectedDomain(domain.name)} className="text-left flex items-start gap-2">
                      <Globe className="w-4 h-4 mt-0.5 text-muted-foreground" />
                      <span>
                        <span className="block text-sm font-semibold">{domain.name}</span>
                        <span className="block text-[10px] text-muted-foreground">{domain.app} · {domain.dest}</span>
                      </span>
                    </button>
                  </td>
                  <td className="py-3 px-3">
                    <StatusPill
                      state={status ? Boolean(http?.ok) : null}
                      goodLabel={`${http?.status || 200} · ${http?.response_ms || 0} ms`}
                      badLabel={http?.error || `${http?.status || 0}`}
                    />
                  </td>
                  <td className="py-3 px-3">
                    <StatusPill state={status ? Boolean(www?.ok) : null} goodLabel={`${www?.status || 200}`} badLabel={www?.error || `${www?.status || 0}`} />
                  </td>
                  <td className="py-3 px-3">
                    <StatusPill
                      state={status ? Boolean(tls?.ok) : null}
                      goodLabel={Number.isFinite(tls?.days_remaining) ? `${tls.days_remaining} j` : 'OK'}
                      badLabel={tls?.error || 'TLS invalide'}
                    />
                  </td>
                  <td className="py-3 px-3"><SeoPill score={status?.seo?.score} /></td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5 text-xs">
                      <Bot className="w-3.5 h-3.5 text-violet-500" />
                      <span className="font-medium">{status?.agent_hint || domain.agent}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-xs text-muted-foreground">
                    {status?.checked_at ? (
                      <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{new Date(status.checked_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</span>
                    ) : '—'}
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex flex-wrap gap-1.5">
                      <ActionButton onClick={() => analyze(domain.name)} busy={isAnalyzing} icon={Activity}>Analyser</ActionButton>
                      <ActionButton onClick={() => prepareAction(domain.name, 'repair')} busy={loading[`${domain.name}:repair`]} icon={Wrench} variant="repair">Réparer IA</ActionButton>
                      <ActionButton onClick={() => prepareAction(domain.name, 'seo')} busy={loading[`${domain.name}:seo`]} icon={Sparkles} variant="seo">SEO auto</ActionButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Diagnostic live — {selected.domain}</p>
              <p className="text-xs text-muted-foreground">Agent : {selected.agent_hint} · contrôle {new Date(selected.checked_at).toLocaleString('fr-BE')}</p>
            </div>
            <button onClick={() => setSelectedDomain(null)} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-4 grid lg:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border p-3">
              <div className="flex items-center gap-2 mb-2"><Activity className="w-4 h-4" /><p className="text-sm font-semibold">Incidents</p></div>
              {selected.issues?.length ? (
                <div className="space-y-2">
                  {selected.issues.map((issue) => (
                    <div key={issue.code} className={cn("text-xs rounded-lg px-2.5 py-2 border", issue.severity === 'critical' ? "border-red-500/30 bg-red-500/5 text-red-700" : "border-amber-500/30 bg-amber-500/5 text-amber-700")}>
                      {issue.label}
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-emerald-600">Aucune anomalie détectée par les contrôles actuels.</p>}
            </div>

            <div className="rounded-xl border border-border p-3">
              <div className="flex items-center gap-2 mb-2"><ShieldCheck className="w-4 h-4" /><p className="text-sm font-semibold">Infrastructure</p></div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p>HTTP apex : <span className="text-foreground">{selected.http?.apex?.status || 0}</span></p>
                <p>Temps réponse : <span className="text-foreground">{selected.http?.apex?.response_ms ?? '—'} ms</span></p>
                <p>URL finale : <span className="text-foreground break-all">{selected.http?.apex?.final_url || '—'}</span></p>
                <p>TLS : <span className="text-foreground">{selected.tls?.ok ? `OK · ${selected.tls.days_remaining ?? '—'} jours` : selected.tls?.error || 'invalide'}</span></p>
                <p>DNS A : <span className="text-foreground">{selected.dns?.apex?.a?.join(', ') || '—'}</span></p>
                <p>DNS CNAME : <span className="text-foreground">{selected.dns?.apex?.cname?.join(', ') || '—'}</span></p>
              </div>
            </div>

            <div className="rounded-xl border border-border p-3">
              <div className="flex items-center gap-2 mb-2"><Sparkles className="w-4 h-4" /><p className="text-sm font-semibold">SEO · {selected.seo?.score ?? 0}/100</p></div>
              {selected.seo?.recommendations?.length ? (
                <ul className="space-y-1.5 text-xs text-muted-foreground list-disc pl-4">
                  {selected.seo.recommendations.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                </ul>
              ) : <p className="text-xs text-emerald-600">Aucune recommandation SEO technique prioritaire.</p>}
            </div>
          </div>
        </div>
      )}

      {operationResult && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-semibold mb-2">Dernière intervention IA</p>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Domaine : <span className="text-foreground">{operationResult.domain || '—'}</span></p>
            <p>Tâche : <span className="text-foreground">{operationResult.task?.titre || operationResult.task?.id || '—'}</span></p>
            <p>Agent : <span className="text-foreground">{operationResult.agent?.name || '—'}</span></p>
            <p>Vérification : <span className={operationResult.verified ? "text-emerald-600" : "text-amber-600"}>{operationResult.verified ? 'amélioration mesurée' : 'non vérifiée / bloquée'}</span></p>
          </div>
        </div>
      )}

      {confirmation && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-background shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <p className="text-sm font-semibold">Confirmation obligatoire</p>
              <p className="text-xs text-muted-foreground mt-1">{confirmation.confirmation.summary}</p>
            </div>
            <div className="p-5 space-y-3">
              <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs space-y-1">
                <p><strong>Domaine :</strong> {confirmation.domain}</p>
                <p><strong>Action :</strong> {confirmation.kind === 'seo' ? 'SEO automatique' : 'Réparation IA'}</p>
                <p><strong>Agent :</strong> {confirmation.agent?.name || 'aucun agent compatible'}</p>
                <p><strong>Incidents détectés :</strong> {confirmation.before?.issues?.length || 0}</p>
                <p><strong>Score SEO :</strong> {confirmation.before?.seo?.score ?? '—'}/100</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Après confirmation, une tâche est créée, l’agent métier du site est appelé, puis le Cockpit refait l’analyse. La tâche n’est clôturée que si l’amélioration est réellement mesurée.
              </p>
            </div>
            <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
              <button onClick={() => setConfirmation(null)} className="h-9 px-3 rounded-lg border border-border text-sm">Annuler</button>
              <button
                onClick={confirmAction}
                disabled={loading[`${confirmation.domain}:confirm`]}
                className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
              >
                {loading[`${confirmation.domain}:confirm`] ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirmer et lancer
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-muted-foreground">
        Les analyses DNS/HTTP/TLS/SEO sont en lecture seule. Toute réparation ou optimisation qui peut modifier un site exige un jeton de confirmation serveur à usage unique, crée une tâche et est recontrôlée automatiquement après intervention.
      </div>
    </div>
  );
}
