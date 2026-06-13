import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import { CheckCircle2, AlertCircle, AlertTriangle, Activity } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

const moduleColors = {
  leads: "bg-blue-500/10 text-blue-600",
  clients: "bg-emerald-500/10 text-emerald-600",
  projets: "bg-indigo-500/10 text-indigo-600",
  devis: "bg-amber-500/10 text-amber-600",
  factures: "bg-purple-500/10 text-purple-600",
  commissions: "bg-pink-500/10 text-pink-600",
  taches: "bg-orange-500/10 text-orange-600",
  demandes: "bg-cyan-500/10 text-cyan-600",
  validations: "bg-primary/10 text-primary",
  agents: "bg-violet-500/10 text-violet-600",
  autre: "bg-slate-500/10 text-slate-600",
};

const statutIcon = {
  succes: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
  erreur: <AlertCircle className="w-3.5 h-3.5 text-red-500" />,
  warning: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />,
};

export default function Logs() {
  const [search, setSearch] = useState("");
  const [filterModule, setFilterModule] = useState("tous");

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["logs"],
    queryFn: () => base44.entities.LogAction.list("-created_at"),
  });

  const modules = ["tous", ...new Set(logs.map(l => l.module).filter(Boolean))];

  const filtered = useMemo(() =>
    logs.filter(l =>
      (filterModule === "tous" || l.module === filterModule) &&
      (!search || l.action?.toLowerCase().includes(search.toLowerCase()) || l.entite_nom?.toLowerCase().includes(search.toLowerCase()))
    ), [logs, search, filterModule]
  );

  return (
    <div>
      <PageHeader
        title="Journal d'activité"
        subtitle={`${logs.length} entrées`}
        search={search}
        onSearch={setSearch}
        actions={
          <div className="flex gap-1 bg-muted rounded-lg p-0.5 flex-wrap">
            {modules.slice(0, 6).map(m => (
              <button key={m} onClick={() => setFilterModule(m)}
                className={cn("px-3 py-1.5 text-xs rounded-md font-medium transition-all capitalize",
                  filterModule === m ? "bg-white shadow text-foreground" : "text-muted-foreground")}>
                {m === "tous" ? "Tous" : m}
              </button>
            ))}
          </div>
        }
      />

      {isLoading ? (
        <div className="space-y-2">{Array(8).fill(0).map((_, i) => <div key={i} className="h-14 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-16 text-center">
          <Activity className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-30" />
          <p className="text-muted-foreground text-sm">Aucun log</p>
        </div>
      ) : (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="divide-y divide-border">
            {filtered.map((log) => (
              <div key={log.id} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/30 transition-colors">
                <div className="flex-shrink-0">{statutIcon[log.statut] || statutIcon.succes}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground truncate">{log.action}</p>
                    {log.entite_nom && <span className="text-xs text-muted-foreground">· {log.entite_nom}</span>}
                  </div>
                  {log.details && <p className="text-xs text-muted-foreground truncate">{log.details}</p>}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {log.module && (
                    <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-lg capitalize", moduleColors[log.module] || moduleColors.autre)}>
                      {log.module}
                    </span>
                  )}
                  {log.effectue_par && <span className="text-xs text-muted-foreground hidden sm:block">{log.effectue_par}</span>}
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(log.created_date), "dd/MM HH:mm", { locale: fr })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
