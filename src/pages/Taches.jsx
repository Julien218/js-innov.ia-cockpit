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
import { isHistoricalDuplicate, isStaleActiveRun, isTaskBlocked, isTaskCompleted, isTaskInProgress, runOperationalStatus, taskBlockerMessage, taskRequiresInput } from "@/lib/taskStatus";
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
    <div className="flex max-w-sm items-center gap-2 whitespace-normal">
      <span className="break-words">{value}</span>
      {row.duplicate_count > 1 && (
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600" title={`${row.duplicate_count} enregistrements regroupés${row.archived_duplicate_count ? ` · ${row.archived_duplicate_count} historique(s)` : ""}`}>
          ×{row.duplicate_count}
        </span>
      )}
    </div>
  ) },
  { key: "projet_nom", label: "Contexte", render: (value, row) => (
    <div className="text-xs"><p>{value || row.client_nom || "—"}</p>{value && row.client_nom && <p className="text-muted-foreground">{row.client_nom}</p>}</div>
  ) },
  { key: "priorite",      label: "Priorité",  render: v => <StatusBadge status={v} /> },
  { key: "statut",        label: "Statut",    render: (v, row) => <StatusBadge status={row.operational_status || v} /> },
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

  const { data: runs = [], isError: runsUnavailable } = useQuery({
    queryKey: ["task-execution-runs"],
    queryFn: async () => {
      const response = await fetch("/api/task-autopilot/runs", { credentials: "same-origin" });
      if (!response.ok) throw new Error("État des exécutions indisponible");
      return response.json();
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
  const awaitingInput = Array.isArray(autopilotResult.awaiting_input) ? autopilotResult.awaiting_input : [];
  const actualBlockers = Array.isArray(autopilotResult.blocked) ? autopilotResult.blocked : [];
  const queuedExecutions = Array.isArray(autopilotResult.queued) ? autopilotResult.queued : [];
  const waitingTaskIds = useMemo(() => new Set(awaitingAuthorization.map((item) => String(item.task_id))), [awaitingAuthorization]);
  const displayRows = useMemo(() => {
    const latest = new Map();
    const isPreferredActiveRun = run => ["pending", "queued", "dispatching", "dispatched", "running", "awaiting_approval", "awaiting_review"].includes(run.status)
      && !isStaleActiveRun(run);
    for (const run of [...runs].sort((a, b) => Number(isPreferredActiveRun(b)) - Number(isPreferredActiveRun(a)) || String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")))) {
      if (!latest.has(String(run.task_id))) latest.set(String(run.task_id), run);
    }
    const withRuns = rows.map((row) => {
      const run = latest.get(String(row.id));
      let operationalStatus = null;
      if (isHistoricalDuplicate(row)) operationalStatus = "ARCHIVED_DUPLICATE";
      else if (isTaskCompleted(row) && !isPreferredActiveRun(run)) operationalStatus = "DONE";
      else operationalStatus = runOperationalStatus(run);
      if (!operationalStatus && taskRequiresInput(row, run)) operationalStatus = "WAITING_INPUT";
      return { ...row, operational_status: operationalStatus, _latest_run: run || null };
    });
    const groupedRows = groupDuplicates ? groupTasks(withRuns) : withRuns;
    return groupedRows.map((row) => {
      if (row.operational_status === "DONE" || row.operational_status === "ARCHIVED_DUPLICATE") return row;

      const operationalCopies = (row.duplicate_tasks?.length ? row.duplicate_tasks : [row])
        .filter((task) => !isHistoricalDuplicate(task));
      const ids = operationalCopies.map((task) => String(task.id)).filter(Boolean);
      const blocker = actualBlockers.find(item => [item.task_id, ...(item.duplicate_ids || [])].some(id => ids.includes(String(id))));
      const hasRealBlocker = Boolean(blocker);
      if (blocker?.operational_status) return { ...row, operational_status: blocker.operational_status };
      if (!row.operational_status && row.duplicate_tasks) {
        const execution = row.duplicate_tasks.find(task => !isHistoricalDuplicate(task) && task.operational_status);
        if (execution) return { ...row, operational_status: execution.operational_status };
      }
      const waiting = ids.some((id) => waitingTaskIds.has(id));
      return waiting && !hasRealBlocker && !row.operational_status
        ? { ...row, statut: "en_attente", operational_status: "WAITING_AUTHORIZATION" }
        : row;
    });
  }, [rows, runs, groupDuplicates, waitingTaskIds, actualBlockers]);
  const isLate = (task) => task?.date_echeance && new Date(task.date_echeance) < new Date() && !isTaskCompleted(task);

  const operationalRows = useMemo(
    () => displayRows.filter((task) => task.operational_status !== "ARCHIVED_DUPLICATE" && !isHistoricalDuplicate(task)),
    [displayRows],
  );

  const counters = useMemo(() => ({
    actives: operationalRows.filter((task) => !isTaskCompleted(task)).length,
    en_cours: operationalRows.filter((task) => isTaskInProgress(task)).length,
    bloquees: operationalRows.filter(isTaskBlocked).length,
    retard: operationalRows.filter(isLate).length,
    terminees: operationalRows.filter(isTaskCompleted).length,
    historique: displayRows.filter((task) => task.operational_status === "ARCHIVED_DUPLICATE" || isHistoricalDuplicate(task)).length,
  }), [displayRows, operationalRows]);

  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    const priorityRank = { urgente: 0, haute: 1, normale: 2, basse: 3 };
    return displayRows
      .filter((task) => {
        const archivedDuplicate = task.operational_status === "ARCHIVED_DUPLICATE" || isHistoricalDuplicate(task);
        if (statusFilter !== "toutes" && archivedDuplicate) return false;
        if (statusFilter === "actives" && isTaskCompleted(task)) return false;
        if (statusFilter === "bloquees" && !isTaskBlocked(task)) return false;
        if (statusFilter === "retard" && !isLate(task)) return false;
        if (statusFilter === "en_cours" && !isTaskInProgress(task)) return false;
        if (statusFilter === "terminees" && !isTaskCompleted(task)) return false;
        if (!term) return true;
        return [task._search_text, task.titre, task.description, task.client_nom, task.projet_nom]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      })
      .sort((a, b) => {
        const stateA = isTaskBlocked(a) ? 0 : isLate(a) ? 1 : isTaskInProgress(a) ? 2 : isTaskCompleted(a) ? 4 : 3;
        const stateB = isTaskBlocked(b) ? 0 : isLate(b) ? 1 : isTaskInProgress(b) ? 2 : isTaskCompleted(b) ? 4 : 3;
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
      <Button size="icon" variant="ghost" aria-label={`Modifier ${row.titre || 'la tâche'}`} title="Modifier la tâche" onClick={() => { setEditing(row); setOpen(true); }}>
        <Pencil className="w-4 h-4" />
      </Button>
      <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-red-600" aria-label={`Supprimer ${row.titre || 'la tâche'}`} title="Supprimer la tâche"
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
    <div className="space-y-4">
      <PageHeader title="Tâches" subtitle={`${filteredTasks.length} tâche(s) affichée(s) · ${rows.length} enregistrement(s) conservé(s)`}
        search={search} onSearch={(value) => { setSearch(value); setVisibleCount(25); }}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouvelle tâche</Button>} />

      {runsUnavailable && <p role="alert" className="text-sm text-amber-600">Les états Elynea ne peuvent pas être actualisés. Les tâches et leurs historiques restent conservés.</p>}
      <details className="rounded-xl border border-border/70 bg-card p-4" aria-label="Pilotage des exécutions Elynea">
        <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-primary">
          Pilotage Elynea <span className="ml-2 font-normal text-muted-foreground">{autopilotStatus?.last_result ? `${awaitingAuthorization.length} autorisation(s) · ${awaitingInput.length} information(s) · ${queuedExecutions.length} en cours · ${actualBlockers.length} blocage(s)` : 'État en cours de vérification'} — détails et actions</span>
        </summary>
        <div className="mt-4 border-t border-border pt-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-semibold">Pilotage Elynea</p>
                <p className="text-xs text-muted-foreground">Elynea sépare les autorisations, les informations manquantes et les pannes techniques.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-amber-500/10 px-2.5 py-1 font-medium text-amber-600">{awaitingAuthorization.length} en attente d’autorisation</span>
              <span className="rounded-full bg-violet-500/10 px-2.5 py-1 font-medium text-violet-600">{awaitingInput.length} information(s) requise(s)</span>
              <span className="rounded-full bg-blue-500/10 px-2.5 py-1 font-medium text-blue-600">{queuedExecutions.length} en traitement</span>
              <span className="rounded-full bg-red-500/10 px-2.5 py-1 font-medium text-red-600">{actualBlockers.length} blocage(s) réel(s)</span>
            </div>
            {actualBlockers.slice(0, 3).map((item) => (
              <p key={`${item.task_id}-${item.reason}`} className="text-xs text-red-500">
                {item.title || item.task_id} — {taskBlockerMessage(item.reason)}
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
                const approved = confirm("Autoriser Elynea à exécuter les tâches supportées en attente ? Cela peut mettre à jour les fiches métier et demander aux agents responsables de modifier uniquement leurs sites. Aucune suppression ni facturation ne sera effectuée.");
                if (approved) runAutopilot.mutate({ allowWrites: true });
              }}
            >
              <Play className="mr-2 h-4 w-4" /> Exécuter avec Elynea
            </Button>
          </div>
        </div>
        </div>
      </details>

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
          Priorité aux blocages réels et aux échéances. Les doublons historiques restent conservés mais sont exclus de « À traiter ».
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
        <div className="lg:hidden divide-y divide-border" aria-label="Liste des tâches">
          {isLoading ? <p role="status" className="p-4 text-sm text-muted-foreground">Chargement des tâches…</p> : filteredTasks.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Aucune tâche ne correspond à ces filtres</p> : filteredTasks.slice(0, visibleCount).map(row => (
            <article key={row.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="min-w-0 break-words text-sm font-semibold">{row.titre || 'Tâche sans titre'}</h2>
                <Button size="icon" variant="ghost" className="shrink-0" aria-label={`Modifier ${row.titre || 'la tâche'}`} onClick={() => { setEditing(row); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
              </div>
              <div className="flex flex-wrap items-center gap-2"><StatusBadge status={row.operational_status || row.statut} /><StatusBadge status={row.priorite} />{row.duplicate_count > 1 && <span className="text-xs text-muted-foreground">{row.duplicate_count} enregistrements regroupés</span>}</div>
              {(row.projet_nom || row.client_nom || row.date_echeance) && <p className="text-xs text-muted-foreground">{[row.projet_nom, row.client_nom, row.date_echeance && `Échéance : ${new Date(row.date_echeance).toLocaleDateString('fr-BE')}`].filter(Boolean).join(' · ')}</p>}
              <details><summary className="cursor-pointer text-xs text-muted-foreground">Détails et actions</summary><div className="mt-2 space-y-2"><p className="whitespace-pre-wrap break-words text-sm">{row.description || 'Aucune description.'}</p>{actions(row)}</div></details>
            </article>
          ))}
        </div>
        <div className="hidden lg:block">
        <DataTable
          columns={columns}
          data={filteredTasks.slice(0, visibleCount)}
          loading={isLoading}
          actions={actions}
          emptyMessage="Aucune tâche ne correspond à ces filtres"
        />
        </div>
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
