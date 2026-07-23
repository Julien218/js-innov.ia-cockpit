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
  { name: "nom",          label: "Nom",         type: "text",  required: true },
  { name: "prenom",       label: "Prénom",       type: "text" },
  { name: "email",        label: "Email",        type: "email", required: true },
  { name: "telephone",    label: "Téléphone",    type: "text" },
  { name: "entreprise",   label: "Entreprise",   type: "text" },
  { name: "adresse",      label: "Adresse",      type: "text" },
  { name: "ville",        label: "Ville",        type: "text" },
  { name: "code_postal",  label: "Code postal",  type: "text" },
  { name: "statut",       label: "Statut",       type: "select",
    options: ["actif","inactif","prospect","archive"] },
  { name: "notes",        label: "Notes",        type: "textarea" },
];

const columns = [
  { key: "nom",        label: "Nom",         render: (v, row) => `${v || ""} ${row.prenom || ""}`.trim() },
  { key: "email",      label: "Email" },
  { key: "entreprise", label: "Entreprise" },
  { key: "ville",      label: "Ville" },
  { key: "statut",     label: "Statut",  render: v => <StatusBadge status={v} /> },
  { key: "created_at", label: "Créé le", render: v => v ? new Date(v).toLocaleDateString("fr-BE") : "—" },
];

export default function Clients() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: clients = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["Client"],
    queryFn: () => base44.entities.Client.list("-created_at"),
  });

  const save = useMutation({
    mutationFn: (data) =>
      editing ? base44.entities.Client.update(editing.id, data) : base44.entities.Client.create(data),
    onSuccess: () => { qc.invalidateQueries(["Client"]); setOpen(false); setEditing(null); },
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.Client.delete(id),
    onSuccess: () => qc.invalidateQueries(["Client"]),
  });

  const actions = (row) => (
    <div className="flex gap-2">
      <Button size="icon" variant="ghost" onClick={() => { setEditing(row); setOpen(true); }}>
        <Pencil className="w-4 h-4" />
      </Button>
      <Button size="icon" variant="ghost" className="text-red-400"
        onClick={() => { if (confirm("Supprimer ce client ?")) del.mutate(row.id); }}>
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
      <PageHeader title="Clients" subtitle={`${clients.length} client(s)`}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouveau client</Button>} />
      <DataTable columns={columns} data={clients} loading={isLoading} actions={actions} />
      <FormModal open={open} onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier le client" : "Nouveau client"}
        fields={formFields} initialData={editing}
        onSubmit={(data) => save.mutate(data)} loading={save.isPending} />
    </div>
  );
}
