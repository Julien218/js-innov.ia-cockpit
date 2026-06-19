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
  { name: "numero",        label: "N° Facture",      type: "text",   required: true },
  { name: "client_nom",    label: "Client",          type: "text",   required: true },
  { name: "montant_ht",    label: "Montant HT (€)",  type: "number" },
  { name: "tva",           label: "TVA (%)",         type: "number" },
  { name: "montant_ttc",   label: "Montant TTC (€)", type: "number" },
  { name: "statut",        label: "Statut",          type: "select",
    options: ["brouillon","envoyee","payee","en_retard","annulee"] },
  { name: "date_emission", label: "Date émission",   type: "date" },
  { name: "date_echeance", label: "Date échéance",   type: "date" },
  { name: "notes",         label: "Notes",           type: "textarea" },
];

const columns = [
  { key: "numero",        label: "N° Facture" },
  { key: "client_nom",    label: "Client" },
  { key: "montant_ttc",   label: "Total TTC",  render: v => v ? `${Number(v).toLocaleString("fr-BE")} €` : "—" },
  { key: "statut",        label: "Statut",     render: v => <StatusBadge status={v} /> },
  { key: "date_echeance", label: "Échéance",   render: v => v ? new Date(v).toLocaleDateString("fr-BE") : "—" },
];

export default function Factures() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: factures = [], isLoading } = useQuery({
    queryKey: ["Facture"],
    queryFn: () => base44.entities.Facture.list("-created_at"),
  });

  const save = useMutation({
    mutationFn: (data) =>
      editing ? base44.entities.Facture.update(editing.id, data) : base44.entities.Facture.create(data),
    onSuccess: () => { qc.invalidateQueries(["Facture"]); setOpen(false); setEditing(null); },
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.Facture.delete(id),
    onSuccess: () => qc.invalidateQueries(["Facture"]),
  });

  const actions = (row) => (
    <div className="flex gap-2">
      <Button size="icon" variant="ghost" onClick={() => { setEditing(row); setOpen(true); }}>
        <Pencil className="w-4 h-4" />
      </Button>
      <Button size="icon" variant="ghost" className="text-red-400"
        onClick={() => { if (confirm("Supprimer cette facture ?")) del.mutate(row.id); }}>
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Factures" subtitle={`${factures.length} facture(s)`}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouvelle facture</Button>} />
      <DataTable columns={columns} data={factures} loading={isLoading} actions={actions} />
      <FormModal open={open} onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier la facture" : "Nouvelle facture"}
        fields={formFields} initialData={editing}
        onSubmit={(data) => save.mutate(data)} loading={save.isPending} />
    </div>
  );
}
