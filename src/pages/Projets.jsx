import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import ErrorState from "@/components/shared/ErrorState";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";

const formFields = [
  { name: "nom",             label: "Nom du projet",     type: "text",   required: true },
  { name: "client_nom",      label: "Client",            type: "text",   required: true },
  { name: "description",     label: "Description",       type: "textarea" },
  { name: "statut",          label: "Statut",            type: "select",
    options: ["en_attente","en_cours","pause","termine","annule"] },
  { name: "budget",          label: "Budget (€)",        type: "number" },
  { name: "date_debut",      label: "Date début",        type: "date" },
  { name: "date_fin_prevue", label: "Date fin prévue",   type: "date" },
  { name: "notes",           label: "Notes",             type: "textarea" },
];

const columns = [
  { key: "nom",             label: "Projet" },
  { key: "client_nom",      label: "Client" },
  { key: "statut",          label: "Statut",   render: v => <StatusBadge status={v} /> },
  { key: "budget",          label: "Budget",   render: v => v ? `${v.toLocaleString("fr-BE")} €` : "—" },
  { key: "date_fin_prevue", label: "Fin prévue", render: v => v ? new Date(v).toLocaleDateString("fr-BE") : "—" },
];

export default function Projets() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: projets = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["Projet"],
    queryFn: () => base44.entities.Projet.list("-created_at"),
  });

  const save = useMutation({
    mutationFn: (data) =>
      editing ? base44.entities.Projet.update(editing.id, data) : base44.entities.Projet.create(data),
    onSuccess: () => { qc.invalidateQueries(["Projet"]); setOpen(false); setEditing(null); },
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.Projet.delete(id),
    onSuccess: () => qc.invalidateQueries(["Projet"]),
  });

  const actions = (row) => (
    <div className="flex gap-2">
      <Button size="icon" variant="ghost" onClick={() => { setEditing(row); setOpen(true); }}>
        <Pencil className="w-4 h-4" />
      </Button>
      <Button size="icon" variant="ghost" className="text-red-400"
        onClick={() => { if (confirm("Supprimer ce projet ?")) del.mutate(row.id); }}>
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );

  if (isError) {
    return (
      <div className="p-6">
        <ErrorState
          title="Impossible de charger les données"
          message={error?.message || "Erreur de connexion au serveur backend. Vérifiez que le service jsinnovia-agent est disponible."}
          onRetry={refetch}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Projets" subtitle={`${projets.length} projet(s)`}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouveau projet</Button>} />
      <DataTable columns={columns} data={projets} loading={isLoading} actions={actions} />
      <FormModal open={open} onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier le projet" : "Nouveau projet"}
        fields={formFields} initialData={editing}
        onSubmit={(data) => save.mutate(data)} loading={save.isPending} />
    </div>
  );
}
