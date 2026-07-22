// ─────────────────────────────────────────────────────────────────────────────
// Taches.jsx — Phase 2 migrée vers dataClient
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { dataClient } from "@/services/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";

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

  const { data: taches = [], isLoading } = useQuery({
    queryKey: ["Tache"],
    queryFn: () => dataClient.entities.Tache.list("-created_at"),
  });

  const save = useMutation({
    mutationFn: (data) =>
      editing ? dataClient.entities.Tache.update(editing.id, data) : dataClient.entities.Tache.create(data),
    onSuccess: () => { qc.invalidateQueries(["Tache"]); setOpen(false); setEditing(null); },
  });

  const del = useMutation({
    mutationFn: (id) => dataClient.entities.Tache.delete(id),
    onSuccess: () => qc.invalidateQueries(["Tache"]),
  });

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

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Tâches" subtitle={`${taches.length} tâche(s)`}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouvelle tâche</Button>} />
      <DataTable columns={columns} data={taches} loading={isLoading} actions={actions} />
      <FormModal open={open} onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier la tâche" : "Nouvelle tâche"}
        fields={formFields} initialData={editing}
        onSubmit={(data) => save.mutate(data)} loading={save.isPending} />
    </div>
  );
}
