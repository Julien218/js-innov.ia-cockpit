import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import ErrorState from "@/components/shared/ErrorState";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, CircleDot, Clock3, Pencil, Trash2 } from "lucide-react";
import { isTaskBlocked, isTaskCompleted, normalizeTaskStatus } from "@/lib/taskStatus";

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
  { key: "titre",         label: "Tâche" },
  { key: "client_nom",    label: "Client" },
  { key: "projet_nom",    label: "Projet" },
  { key: "priorite",      label: "Priorité",  render: v => <StatusBadge status={v} /> },
  { key: "statut",        label: "Statut",    render: v => <StatusBadge status={v} /> },
  { key: "date_echeance", label: "Échéance",  render: v => v ? new Date(v).toLocaleDateString("fr-BE") : "—" },
];

export default function Taches() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("actives");
  const [visibleCount, setVisibleCount] = useState(25);

  const { data: taches = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["Tache"],
    queryFn: () => base44.entities.Tache.list("-created_at"),
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
  const isLate = (task) => task?.date_echeance && new Date(task.date_echeance) < new Date() && !isTaskCompleted(task);

  const counters = useMemo(() => ({
    actives: rows.filter((task) => !isTaskCompleted(task)).length,
    en_cours: rows.filter((task) => normalizeTaskStatus(task.statut ?? task.status) === "en_cours").length,
    bloquees: rows.filter(isTaskBlocked).length,
    retard: rows.filter(isLate).length,
    terminees: rows.filter(isTaskCompleted).length,
  }), [rows]);

  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    const priorityRank = { urgente: 0, haute: 1, normale: 2, basse: 3 };
    return rows
      .filter((task) => {
        if (statusFilter === "actives" && isTaskCompleted(task)) return false;
        if (statusFilter === "bloquees" && !isTaskBlocked(task)) return false;
        if (statusFilter === "retard" && !isLate(task)) return false;
        if (statusFilter === "en_cours" && normalizeTaskStatus(task.statut ?? task.status) !== "en_cours") return false;
        if (statusFilter === "terminees" && !isTaskCompleted(task)) return false;
        if (!term) return true;
        return [task.titre, task.description, task.client_nom, task.projet_nom]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      })
      .sort((a, b) => {
        const stateA = isTaskBlocked(a) ? 0 : isLate(a) ? 1 : normalizeTaskStatus(a.statut ?? a.status) === "en_cours" ? 2 : isTaskCompleted(a) ? 4 : 3;
        const stateB = isTaskBlocked(b) ? 0 : isLate(b) ? 1 : normalizeTaskStatus(b.statut ?? b.status) === "en_cours" ? 2 : isTaskCompleted(b) ? 4 : 3;
        if (stateA !== stateB) return stateA - stateB;
        return (priorityRank[a.priorite] ?? 9) - (priorityRank[b.priorite] ?? 9);
      });
  }, [rows, search, statusFilter]);

  const filters = [
    { id: "actives", label: "À traiter", count: counters.actives, icon: CircleDot },
    { id: "en_cours", label: "En cours", count: counters.en_cours, icon: Clock3 },
    { id: "bloquees", label: "Bloquées", count: counters.bloquees, icon: AlertTriangle },
    { id: "retard", label: "En retard", count: counters.retard, icon: AlertTriangle },
    { id: "terminees", label: "Terminées", count: counters.terminees, icon: CheckCircle2 },
    { id: "toutes", label: "Toutes", count: rows.length, icon: CircleDot },
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
      <PageHeader title="Tâches" subtitle={`${filteredTasks.length} résultat(s) · ${counters.actives} à traiter`}
        search={search} onSearch={(value) => { setSearch(value); setVisibleCount(25); }}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouvelle tâche</Button>} />

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
          Les tâches bloquées, en retard et urgentes sont affichées en premier.
        </p>
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
