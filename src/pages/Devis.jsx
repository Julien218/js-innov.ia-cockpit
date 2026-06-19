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
  { name: "numero",         label: "N° Devis",       type: "text",   required: true },
  { name: "client_nom",     label: "Client",         type: "text",   required: true },
  { name: "objet",          label: "Objet",          type: "text" },
  { name: "montant_ht",     label: "Montant HT (€)", type: "number" },
  { name: "tva",            label: "TVA (%)",        type: "number" },
  { name: "montant_ttc",    label: "Montant TTC (€)",type: "number" },
  { name: "statut",         label: "Statut",         type: "select",
    options: ["brouillon","envoye","accepte","refuse","expire"] },
  { name: "date_emission",  label: "Date émission",  type: "date" },
  { name: "date_validite",  label: "Valide jusqu'au",type: "date" },
  { name: "notes",          label: "Notes",          type: "textarea" },
];

const columns = [
  { key: "numero",        label: "N° Devis" },
  { key: "client_nom",    label: "Client" },
  { key: "objet",         label: "Objet" },
  { key: "montant_ttc",   label: "Total TTC", render: v => v ? `${Number(v).toLocaleString("fr-BE")} €` : "—" },
  { key: "statut",        label: "Statut",    render: v => <StatusBadge status={v} /> },
  { key: "date_validite", label: "Validité",  render: v => v ? new Date(v).toLocaleDateString("fr-BE") : "—" },
];

export default function Devis() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: devis = [], isLoading } = useQuery({
    queryKey: ["Devis"],
    queryFn: () => base44.entities.Devis.list("-created_at"),
  });

  const save = useMutation({
    mutationFn: (data) =>
      editing ? base44.entities.Devis.update(editing.id, data) : base44.entities.Devis.create(data),
    onSuccess: () => { qc.invalidateQueries(["Devis"]); setOpen(false); setEditing(null); },
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.Devis.delete(id),
    onSuccess: () => qc.invalidateQueries(["Devis"]),
  });

  const actions = (row) => (
    <div className="flex gap-2">
      <Button size="icon" variant="ghost" onClick={() => { setEditing(row); setOpen(true); }}>
        <Pencil className="w-4 h-4" />
      </Button>
      <Button size="icon" variant="ghost" className="text-red-400"
        onClick={() => { if (confirm("Supprimer ce devis ?")) del.mutate(row.id); }}>
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Devis" subtitle={`${devis.length} devis`}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouveau devis</Button>} />
      <DataTable columns={columns} data={devis} loading={isLoading} actions={actions} />
      <FormModal open={open} onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier le devis" : "Nouveau devis"}
        fields={formFields} initialData={editing}
        onSubmit={(data) => save.mutate(data)} loading={save.isPending} />
    </div>
  );
}
