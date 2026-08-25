import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import ErrorState from "@/components/shared/ErrorState";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { AlertTriangle, CheckCircle2, CircleDot, Clock3, Loader2, Pencil, Play, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { isTaskBlocked, isTaskCompleted, normalizeTaskStatus } from "@/lib/taskStatus";
import { groupTasks } from "@/lib/taskGrouping";

const formFields = [
  { name: "titre",         label: "Titre",         type: "text",   required: true },
  { name: "description",   label: "Description",   type: "textarea" },
  { name: "client_nom",    label: "Client",        type: "text" },
  { name: "projet_nom",    label: "Projet",        type: "text" },
  { name: "statut",        label: "Statut",        type: "select",
    options: ["a_faire","en_cours","en_attente","termine","annule"] },
  { name: "priorite",      label: "Priorité",      type: "select",
    options: ["basse","normale","haute","urgente"] },
  { name: "date_echeance", label: "Échéance",      type: "date" },
  { name: "notes",         label: "Notes",         type: "textarea" },
];

const columns = [
  { key: "titre",         label: "Tâche", render: (value, row) => (
    <div className="flex items-center gap-2">
      <span>{value}</span>
      {row.duplicate_count > 1 && (
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600" title={`${row.duplicate_count} enregistrements regroupés`}>
          ×{row.duplicate_count}
        </span>
      )}
    </div>
  ) },
  { key: "client_nom",    label: "Client" },
  { key: "projet_nom",    label: "Projet" },
  { key: "priorite",      label: "Priorité",  render: v => <StatusBadge status={v} /> },
  { key: "statut",        label: "Statut",    render: v => <StatusBadge status={v} /> },
  { key: "date_echeance", label: "Échéance",  render: v => v ? new Date(v).toLocaleDateString("fr-BE") : "—" },
];

export default function Taches() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("actives");
  const [visibleCount, setVisibleCount] = useState(25);
  const [groupDuplicates, setGroupDuplicates] = useState(true);

  const { data: taches = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["Tache"],
    queryFn: () => base44.entities.Tache.list("-created_at"),
  });

  const { data: autopilotStatus, refetch: refetchAutopilot } = useQuery({
    queryKey: ["task-autopilot-status"],
    queryFn: async () => {
      const response = await fetch("/api/task-autopilot/status", { credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "État NOVA indisponible");
      return data;
    },
    refetchInterval: 30_000,
  });

  const runAutopilot = useMutation({
    mutationFn: async ({ allowWrites }) => {
      const response = await fetch("/api/task-autopilot/run", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allow_writes: allowWrites }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Exécution NOVA impossible");
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["Tache"] });
      refetchAutopilot();
      const result = data || {};
      toast({
        title: "NOVA a terminé le passage",
        description: `${result.executed?.length || 0} terminée(s), ${result.queued?.length || 0} en traitement, ${result.blocked?.length || 0} blocage(s) réel(s).`,
      });
    },
    onError: (mutationError) => toast({ title: "Exécution NOVA impossible", description: mutationError.message, variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: (data) =>
      editing ? base44.entities.Tache.update(editing.id, data) : base44.entities.Tache.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["Tache"] }); setOpen(false); setEditing(null); },
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.Tache.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["Tache"] }),
  });

  const rows = Array.isArray(taches) ? taches : [];
  const autopilotResult = autopilotStatus?.last_result || {};
  const awaitingAuthorization = Array.isArray(autopilotResult.awaiting_authorization) ? autopilotResult.awaiting_authorization : [];
  const actualBlockers = Array.isArray(autopilotResult.blocked) ? autopilotResult.blocked : [];
  const queuedExecutions = Array.isArray(autopilotResult.queued) ? autopilotResult.queued : [];
  const waitingTaskIds = useMemo(() => new Set(awaitingAuthorization.map((item) => String(item.task_id))), [awaitingAuthorization]);
  const blockedTaskIds = useMemo(() => new Set(actualBlockers.map((item) => String(item.task_id))), [actualBlockers]);
  const displayRows = useMemo(() => {
    const groupedRows = groupDuplicates ? groupTasks(rows) : rows;
    return groupedRows.map((row) => {
      const ids = (row.duplicate_ids?.length ? row.duplicate_ids : [row.id]).map(String);
      const hasRealBlocker = ids.some((id) => blockedTaskIds.has(id));
      const waiting = ids.some((id) => waitingTaskIds.has(id));
      return waiting && !hasRealBlocker
        ? { ...row, statut: "en_attente", operational_status: "en_attente_autorisation" }
        : row;
    });
  }, [rows, groupDuplicates, waitingTaskIds, blockedTaskIds]);
  const isLate = (task) => task?.date_echeance && new Date(task.date_echeance) < new Date() && !isTaskCompleted(task);

  const counters = useMemo(() => ({
    actives: displayRows.filter((task) => !isTaskCompleted(task)).length,
    en_cours: displayRows.filter((task) => normalizeTaskStatus(task.statut ?? task.status) === "en_cours").length,
    bloquees: displayRows.filter(isTaskBlocked).length,
    retard: displayRows.filter(isLate).length,
    terminees: displayRows.filter(isTaskCompleted).length,
  }), [displayRows]);

  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    const priorityRank = { urgente: 0, haute: 1, normale: 2, basse: 3 };
    return displayRows
      .filter((task) => {
        if (statusFilter === "actives" && isTaskCompleted(task)) return false;
        if (statusFilter === "bloquees" && !isTaskBlocked(task)) return false;
        if (statusFilter === "retard" && !isLate(task)) return false;
        if (statusFilter === "en_cours" && normalizeTaskStatus(task.statut ?? task.status) !== "en_cours") return false;
        if (statusFilter === "terminees" && !isTaskCompleted(task)) return false;
        if (!term) return true;
        return [task._search_text, task.titre, task.description, task.client_nom, task.projet_nom]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      })
      .sort((a, b) => {
        const stateA = isTaskBlocked(a) ? 0 : isLate(a) ? 1 : normalizeTaskStatus(a.statut ?? a.status) === "en_cours" ? 2 : isTaskCompleted(a) ? 4 : 3;
        const stateB = isTaskBlocked(b) ? 0 : isLate(b) ? 1 : normalizeTaskStatus(b.statut ?? b.status) === "en_cours" ? 2 : isTaskCompleted(b) ? 4 : 3;
        if (stateA !== stateB) return stateA - stateB;
        return (priorityRank[a.priorite] ?? 9) - (priorityRank[b.priorite] ?? 9);
      });
  }, [displayRows, search, statusFilter]);

  const filters = [
    { id: "actives", label: "À traiter", count: counters.actives, icon: CircleDot },
    { id: "en_cours", label: "En cours", count: counters.en_cours, icon: Clock3 },
    { id: "bloquees", label: "Bloquées", count: counters.bloquees, icon: AlertTriangle },
    { id: "retard", label: "En retard", count: counters.retard, icon: AlertTriangle },
    { id: "terminees", label: "Terminées", count: counters.terminees, icon: CheckCircle2 },
    { id: "toutes", label: "Toutes", count: displayRows.length, icon: CircleDot },
  ];

  const actions = (row) => (
    <div className="flex gap-2">
      <Button size="icon" variant="ghost" onClick={() => { setEditing(row); setOpen(true); }}>
        <Pencil className="w-4 h-4" />
      </Button>
      <Button size="icon" variant="ghost" className="text-red-400"
        onClick={() => { if (confirm("Supprimer cette tâche ?")) del.mutate(row.id); }}>
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );

  if (isError) {
    return (
      <div className="space-y-4">
        <ErrorState
          title="Impossible de charger les données"
          message={error?.message || "Erreur de connexion au serveur."}
          onRetry={refetch}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Tâches" subtitle={`${filteredTasks.length} tâche(s) affichée(s) · ${rows.length} enregistrement(s) conservé(s)`}
        search={search} onSearch={(value) => { setSearch(value); setVisibleCount(25); }}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouvelle tâche</Button>} />

      <section className="rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm" aria-label="Pilotage des exécutions NOVA">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-semibold">Pilotage NOVA</p>
                <p className="text-xs text-muted-foreground">Les attentes d’autorisation sont séparées des pannes techniques.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-amber-500/10 px-2.5 py-1 font-medium text-amber-600">{awaitingAuthorization.length} en attente d’autorisation</span>
              <span className="rounded-full bg-blue-500/10 px-2.5 py-1 font-medium text-blue-600">{queuedExecutions.length} en traitement</span>
              <span className="rounded-full bg-red-500/10 px-2.5 py-1 font-medium text-red-600">{actualBlockers.length} blocage(s) réel(s)</span>
            </div>
            {actualBlockers.slice(0, 3).map((item) => (
              <p key={`${item.task_id}-${item.reason}`} className="text-xs text-red-500">
                {item.title || item.task_id} — {item.reason || "exécuteur indisponible"}
              </p>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={runAutopilot.isPending}
              onClick={() => runAutopilot.mutate({ allowWrites: false })}
            >
              {runAutopilot.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Relancer les diagnostics
            </Button>
            <Button
              type="button"
              disabled={runAutopilot.isPending || awaitingAuthorization.length === 0}
              onClick={() => {
                const approved = confirm("Autoriser NOVA à exécuter les tâches supportées en attente ? Cela peut mettre à jour les fiches métier et demander aux agents responsables de modifier uniquement leurs sites. Aucune suppression ni facturation ne sera effectuée.");
                if (approved) runAutopilot.mutate({ allowWrites: true });
              }}
            >
              <Play className="mr-2 h-4 w-4" /> Exécuter les tâches autorisées
            </Button>
          </div>
        </div>
      </section>

      <section className="workspace-toolbar" aria-label="Filtres des tâches">
        <div className="flex flex-wrap gap-2">
          {filters.map((filter) => {
            const Icon = filter.icon;
            const selected = statusFilter === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                aria-pressed={selected}
                onClick={() => { setStatusFilter(filter.id); setVisibleCount(25); }}
                className={`filter-chip ${selected ? "filter-chip-active" : ""}`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{filter.label}</span>
                <span className="filter-chip-count">{filter.count}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Les tâches bloquées, en retard et urgentes sont affichées en premier. Aucun doublon n’est supprimé.
        </p>
        <Button
          type="button"
          size="sm"
          variant={groupDuplicates ? "default" : "outline"}
          onClick={() => { setGroupDuplicates((value) => !value); setVisibleCount(25); }}
          className="shrink-0"
        >
          {groupDuplicates ? "Doublons regroupés" : "Regrouper les doublons"}
        </Button>
      </section>

      <div className="data-surface">
        <DataTable
          columns={columns}
          data={filteredTasks.slice(0, visibleCount)}
          loading={isLoading}
          actions={actions}
          emptyMessage="Aucune tâche ne correspond à ces filtres"
        />
        {filteredTasks.length > visibleCount && (
          <div className="flex items-center justify-between border-t border-border/70 px-4 py-3">
            <span className="text-xs text-muted-foreground">{visibleCount} sur {filteredTasks.length} affichées</span>
            <Button size="sm" variant="outline" onClick={() => setVisibleCount((count) => count + 25)}>
              Afficher 25 de plus
            </Button>
          </div>
        )}
      </div>
      <FormModal open={open} onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier la tâche" : "Nouvelle tâche"}
        fields={formFields} initialData={editing}
        onSubmit={(data) => save.mutate(data)} loading={save.isPending} />
    </div>
  );
}
