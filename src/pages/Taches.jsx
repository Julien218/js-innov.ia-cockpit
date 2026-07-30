import React, { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import ErrorState from "@/components/shared/ErrorState";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

// Composants de dispatch
import TaskDispatchButton from "@/components/dispatch/TaskDispatchButton";
import TaskDispatchModal from "@/components/dispatch/TaskDispatchModal";
import AgentRunActions from "@/components/dispatch/AgentRunActions";
import AgentRunDetail from "@/components/dispatch/AgentRunDetail";

const formFields = [
  { name: "titre",         label: "Titre",         type: "text",   required: true },
  { name: "description",   label: "Description",   type: "textarea" },
  { name: "client_nom",    label: "Client",        type: "text" },
  { name: "projet_nom",    label: "Projet",        type: "text" },
  { name: "statut",        label: "Statut",        type: "select", options: ["a_faire","en_cours","en_attente","termine","annule"] },
  { name: "priorite",      label: "Priorité",      type: "select", options: ["basse","normale","haute","urgente"] },
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
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchTask, setDispatchTask] = useState(null);
  const [detailRunId, setDetailRunId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [taskRuns, setTaskRuns] = useState({});

  const { data: taches = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["Tache"],
    queryFn: () => base44.entities.Tache.list("-created_at"),
  });

  // ─── CRUD mutations ──────────────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: (data) => editing ? base44.entities.Tache.update(editing.id, data) : base44.entities.Tache.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["Tache"] }); setOpen(false); setEditing(null); },
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.Tache.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["Tache"] }),
  });

  // ─── Dispatch mutation (appel backend réel) ──────────────────────────────────
  const dispatch = useMutation({
    mutationFn: async ({ task, payload }) => {
      const res = await fetch("/api/tasks/" + task.id + "/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
      return data;
    },
    onSuccess: (data, { task }) => {
      qc.invalidateQueries({ queryKey: ["Tache"] });
      toast({
        title: data.idempotent ? "Déjà en cours" : (data.success ? "Tâche envoyée" : "Échec d'envoi"),
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
      setDispatchOpen(false);
      setDispatchTask(null);
      fetchRunsForTask(task.id);
    },
    onError: (err) => {
      toast({ title: "Erreur d'envoi", description: String(err.message || err), variant: "destructive" });
    },
  });

  // ─── Cancel / Approve / Reject ────────────────────────────────────────────────
  const cancelRun = useMutation({
    mutationFn: async (runId) => {
      const res = await fetch("/api/runs/" + runId + "/cancel", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
      return data;
    },
    onSuccess: () => { toast({ title: "Exécution annulée" }); setDetailOpen(false); qc.invalidateQueries({ queryKey: ["Tache"] }); },
  });

  const approveRun = useMutation({
    mutationFn: async (runId) => {
      const res = await fetch("/api/runs/" + runId + "/approve", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
      return data;
    },
    onSuccess: () => { toast({ title: "Exécution approuvée" }); setDetailOpen(false); },
  });

  const rejectRun = useMutation({
    mutationFn: async (runId) => {
      const res = await fetch("/api/runs/" + runId + "/reject", {
        method: "POST", credentials: "include",
        body: JSON.stringify({ reason: "Rejeté depuis le cockpit" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
      return data;
    },
    onSuccess: () => { toast({ title: "Exécution rejetée" }); setDetailOpen(false); },
  });

  // ─── Fetch runs for task ──────────────────────────────────────────────────────
  const fetchRunsForTask = useCallback(async (taskId) => {
    try {
      const res = await fetch("/api/tasks/" + taskId + "/runs", { credentials: "include" });
      const data = await res.json();
      if (data.runs) setTaskRuns(prev => ({ ...prev, [taskId]: data.runs }));
    } catch (e) { console.error("Erreur fetch runs:", e); }
  }, []);

  // ─── Row actions ──────────────────────────────────────────────────────────────
  const actions = (row) => {
    const runs = taskRuns[row.id] || [];
    const lastRun = runs[0];
    return (
      <div className="flex items-center gap-1">
        <AgentRunActions lastRun={lastRun} onViewRun={(id) => { setDetailRunId(id); setDetailOpen(true); }} />
        <TaskDispatchButton
          task={row}
          isDispatching={dispatch.isPending && dispatchTask?.id === row.id}
          onDispatch={() => { setDispatchTask(row); setDispatchOpen(true); fetchRunsForTask(row.id); }}
        />
        <Button size="icon" variant="ghost" onClick={() => { setEditing(row); setOpen(true); }}>
          <Pencil className="w-4 h-4" />
        </Button>
        <Button size="icon" variant="ghost" className="text-red-400"
          onClick={() => { if (confirm("Supprimer cette tâche ?")) del.mutate(row.id); }}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    );
  };

  if (isError) {
    return (
      <div className="space-y-4">
        <ErrorState title="Impossible de charger les données"
          message={error?.message || "Erreur de connexion au serveur."} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tâches"
        subtitle={(Array.isArray(taches) ? taches.length : 0) + " tâche(s)"}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouvelle tâche</Button>}
      />

      <DataTable columns={columns} data={Array.isArray(taches) ? taches : []} loading={isLoading} actions={actions} />

      <FormModal open={open} onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier la tâche" : "Nouvelle tâche"}
        fields={formFields} initialData={editing}
        onSubmit={(data) => save.mutate(data)} loading={save.isPending} />

      <TaskDispatchModal
        open={dispatchOpen}
        isDispatching={dispatch.isPending}
        onClose={() => { setDispatchOpen(false); setDispatchTask(null); }}
        task={dispatchTask}
        onConfirm={(payload) => {
          if (!dispatchTask) return;
          if (!confirm("Confirmer l'envoi de cette tâche à l'agent ?")) return;
          dispatch.mutate({ task: dispatchTask, payload });
        }}
      />

      <AgentRunDetail
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        runId={detailRunId}
        onApprove={(runId) => approveRun.mutate(runId)}
        onReject={(runId) => rejectRun.mutate(runId)}
        onCancel={(runId) => cancelRun.mutate(runId)}
      />
    </div>
  );
}
