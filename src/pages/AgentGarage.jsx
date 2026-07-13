import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Boxes, RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

const STATUS_LABELS = {
  draft: "Brouillon",
  testing: "Test",
  active: "Actif",
  suspended: "Suspendu",
  archived: "Archivé",
};

const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-700",
  testing: "bg-amber-100 text-amber-800",
  active: "bg-emerald-100 text-emerald-800",
  suspended: "bg-orange-100 text-orange-800",
  archived: "bg-gray-100 text-gray-600",
};

async function fetchRegistry(user) {
  const response = await fetch("/api/agent-garage", {
    headers: {
      "x-cockpit-session": user?.sessionToken || "",
      "x-cockpit-user": user?.id || "",
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Impossible de charger le garage d’agents.");
  return payload;
}

export default function AgentGarage() {
  const { user } = useAuth();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["agent-garage", user?.id],
    queryFn: () => fetchRegistry(user),
    enabled: Boolean(user?.id && user?.sessionToken),
    staleTime: 30000,
  });

  const agents = data?.agents || [];
  const active = agents.filter((agent) => agent.status === "active").length;
  const highRisk = agents.filter((agent) => ["high", "critical"].includes(agent.riskLevel)).length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#001a3d] flex items-center justify-center">
            <Boxes className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Garage d’agents</h1>
            <p className="text-sm text-muted-foreground">Registre central synchronisé avec GitHub</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          Synchroniser
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Agents enregistrés" value={agents.length} icon={Bot} />
        <Stat label="Agents actifs" value={active} icon={ShieldCheck} />
        <Stat label="Risque élevé" value={highRisk} icon={AlertTriangle} />
      </div>

      {isLoading && (
        <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted-foreground">
          Chargement du registre…
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Connexion impossible :</strong> {error.message}
        </div>
      )}

      {!isLoading && !error && agents.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-white p-8 text-center text-sm text-muted-foreground">
          Aucun agent n’est encore enregistré dans le dépôt central.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {agents.map((agent) => (
          <article key={agent.id} className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-semibold text-foreground">{agent.name}</h2>
                  <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${STATUS_STYLES[agent.status] || STATUS_STYLES.draft}`}>
                    {STATUS_LABELS[agent.status] || agent.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{agent.métier}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <Bot className="w-5 h-5 text-primary" />
              </div>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <Info label="Version" value={agent.version} />
              <Info label="Risque" value={agent.riskLevel} />
              <Info label="Modèle" value={agent.template} />
              <Info label="Identifiant" value={agent.id} mono />
            </dl>

            <div className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground">
              Configuration : <code className="break-all">{agent.configPath}</code>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function Info({ label, value, mono = false }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-foreground truncate ${mono ? "font-mono text-xs" : "font-medium"}`}>{value || "—"}</dd>
    </div>
  );
}
