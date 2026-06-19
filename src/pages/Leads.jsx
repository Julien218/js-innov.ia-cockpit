import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";

const formFields = [
  { name: "nom",        label: "Nom",        type: "text",   required: true },
  { name: "prenom",     label: "Prénom",      type: "text" },
  { name: "email",      label: "Email",       type: "email",  required: true },
  { name: "telephone",  label: "Téléphone",   type: "text" },
  { name: "entreprise", label: "Entreprise",  type: "text" },
  { name: "source",     label: "Source",      type: "select",
    options: ["site_web","chatbot","formulaire","recommandation","linkedin","autre"] },
  { name: "statut",     label: "Statut",      type: "select",
    options: ["nouveau","contacte","qualifie","proposition","gagne","perdu"] },
  { name: "notes",      label: "Notes",       type: "textarea" },
];

const columns = [
  { key: "nom",        label: "Nom",         render: (v, row) => `${v || ""} ${row.prenom || ""}`.trim() },
  { key: "email",      label: "Email" },
  { key: "entreprise", label: "Entreprise" },
  { key: "source",     label: "Source",      render: v => <span className="capitalize">{v}</span> },
  { key: "statut",     label: "Statut",      render: v => <StatusBadge status={v} /> },
  { key: "created_at", label: "Créé le",     render: v => v ? new Date(v).toLocaleDateString("fr-BE") : "—" },
];

export default function Leads() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["Lead"],
    queryFn: () => base44.entities.Lead.list("-created_at"),
  });

  const save = useMutation({
    mutationFn: (data) =>
      editing ? base44.entities.Lead.update(editing.id, data) : base44.entities.Lead.create(data),
    onSuccess: () => { qc.invalidateQueries(["Lead"]); setOpen(false); setEditing(null); },
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.Lead.delete(id),
    onSuccess: () => qc.invalidateQueries(["Lead"]),
  });

  const actions = (row) => (
    <div className="flex gap-2">
      <Button size="icon" variant="ghost" onClick={() => { setEditing(row); setOpen(true); }}>
        <Pencil className="w-4 h-4" />
      </Button>
      <Button size="icon" variant="ghost" className="text-red-400"
        onClick={() => { if (confirm("Supprimer ce lead ?")) del.mutate(row.id); }}>
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Leads" subtitle={`${leads.length} lead(s) au total`}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouveau lead</Button>} />
      <DataTable columns={columns} data={leads} loading={isLoading} actions={actions} />
      <FormModal open={open} onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier le lead" : "Nouveau lead"}
        fields={formFields} initialData={editing}
        onSubmit={(data) => save.mutate(data)} loading={save.isPending} />
    </div>
  );
}
