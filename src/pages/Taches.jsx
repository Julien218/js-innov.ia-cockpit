import React, { useState, useCallback, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import ErrorState from "@/components/shared/ErrorState";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, RefreshCw } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

import TaskDispatchButton from "@/components/dispatch/TaskDispatchButton";
import TaskDispatchModal from "@/components/dispatch/TaskDispatchModal";
import AgentRunActions from "@/components/dispatch/AgentRunActions";
import AgentRunDetail from "@/components/dispatch/AgentRunDetail";

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

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
  const pollingRef = useRef({});

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

  // ─── Dispatch (async — 202 + runId immédiat) ──────────────────────────────────
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
      return { ...data, httpStatus: res.status };
    },
    onSuccess: (data, { task }) => {
      qc.invalidateQueries({ queryKey: ["Tache"] });
      toast({
        title: data.idempotent ? "Run déjà existant" : "Run créé",
        description: data.idempotent
          ? `Run existant retourné (statut: ${data.status}).`
          : `Traitement asynchrone en cours. Statut: ${data.status}.`,
        variant: "default",
      });
      setDispatchOpen(false);
      setDispatchTask(null);
      // Démarrer le polling pour ce run
      if (data.runId && !TERMINAL_STATUSES.includes(data.status)) {
        startPolling(data.runId, task.id);
      }
    },
    onError: (err) => {
      toast({ title: "Erreur d'envoi", description: String(err.message || err), variant: "destructive" });
    },
  });

  // ─── Relance volontaire ────────────────────────────────────────────────────────
  const retry = useMutation({
    mutationFn: async ({ task, payload }) => {
      const res = await fetch("/api/tasks/" + task.id + "/dispatch-retry", {
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
      toast({ title: "Relance créée", description: `Nouveau run: ${data.runId}. Suivi en cours.` });
      if (data.runId) startPolling(data.runId, task.id);
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

  // ─── Polling — suit le statut d'un run jusqu'à son terme ───────────────────────
  const startPolling = useCallback((runId, taskId) => {
    // Arrêter un polling existant pour ce run
    if (pollingRef.current[runId]) clearInterval(pollingRef.current[runId]);

    const poll = async () => {
      try {
        const res = await fetch("/api/runs/" + runId, { credentials: "include" });
        const data = await res.json();
        if (data.run) {
          // Mettre à jour les runs de la tâche
          setTaskRuns(prev => {
            const runs = prev[taskId] || [];
            const idx = runs.findIndex(r => r.id === runId);
            if (idx >= 0) {
              const updated = [...runs];
              updated[idx] = data.run;
              return { ...prev, [taskId]: updated };
            }
            return { ...prev, [taskId]: [data.run, ...runs] };
          });

          // Arrêter le polling si statut terminal
          if (TERMINAL_STATUSES.includes(data.run.status)) {
            clearInterval(pollingRef.current[runId]);
            delete pollingRef.current[runId];
            qc.invalidateQueries({ queryKey: ["Tache"] });
            toast({
              title: data.run.status === "completed" ? "Tâche terminée" : data.run.status === "failed" ? "Échec du dispatch" : "Run annulé",
              description: data.run.error || `Run ${data.run.id.substring(0, 8)} — ${data.run.status}`,
              variant: data.run.status === "completed" ? "default" : "destructive",
            });
          }
        }
      } catch (e) {
        console.error("Polling error for run", runId, ":", e.message);
      }
    };

    // Polling toutes les 3 secondes
    pollingRef.current[runId] = setInterval(poll, 3000);
    // Premier poll immédiat
    poll();
  }, [qc, toast]);

  // Nettoyer les intervalles au démontage
  useEffect(() => {
    return () => {
      Object.values(pollingRef.current).forEach(clearInterval);
    };
  }, []);

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
        {lastRun && (lastRun.status === 'failed' || lastRun.status === 'cancelled') && (
          <Button size="icon" variant="ghost" className="text-amber-400"
            onClick={() => {
              // Relance volontaire — génère un nouveau clientKey
              const newKey = crypto.randomUUID();
              retry.mutate({
                task: row,
                payload: {
                  clientKey: newKey,
                  agentId: lastRun.agent_id,
                  executionMode: lastRun.execution_mode,
                  instructions: '',
                },
              });
            }}
            title="Relancer l'exécution"
            aria-label="Relancer">
            <RefreshCw className="w-4 h-4" />
          </Button>
        )}
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
