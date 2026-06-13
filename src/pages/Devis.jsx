import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";

const formFields = [
  { key: "numero", label: "Numéro de devis", required: true, placeholder: "DEV-001" },
  { key: "client_nom", label: "Nom du client" },
  { key: "objet", label: "Objet", required: true },
  { key: "montant_ht", label: "Montant HT (€)", type: "number" },
  { key: "tva", label: "TVA (%)", type: "number", placeholder: "20" },
  { key: "montant_ttc", label: "Montant TTC (€)", type: "number" },
  { key: "statut", label: "Statut", type: "select", options: [
    { value: "brouillon", label: "Brouillon" },
    { value: "envoye", label: "Envoyé" },
    { value: "accepte", label: "Accepté" },
    { value: "refuse", label: "Refusé" },
    { value: "expire", label: "Expiré" },
  ]},
  { key: "date_validite", label: "Date de validité", type: "date" },
  { key: "notes", label: "Notes", type: "textarea" },
];

export default function Devis() {
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingId, setEditingId] = useState(null);
  const queryClient = useQueryClient();

  const { data: devis = [], isLoading } = useQuery({
    queryKey: ["devis"],
    queryFn: () => base44.entities.Devis.list("-created_at"),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Devis.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["devis"] }); closeModal(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Devis.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["devis"] }); closeModal(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Devis.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["devis"] }),
  });

  const closeModal = () => { setModalOpen(false); setFormData({}); setEditingId(null); };

  const handleEdit = (d) => {
    setFormData(d);
    setEditingId(d.id);
    setModalOpen(true);
  };

  const handleSubmit = () => {
    if (editingId) updateMutation.mutate({ id: editingId, data: formData });
    else createMutation.mutate(formData);
  };

  const columns = [
    { key: "numero", label: "N°", render: (r) => <span className="font-mono text-xs font-semibold">{r.numero}</span> },
    { key: "client_nom", label: "Client" },
    { key: "objet", label: "Objet", render: (r) => <span className="font-medium">{r.objet}</span> },
    { key: "montant_ttc", label: "Montant TTC", render: (r) => r.montant_ttc ? `${r.montant_ttc.toLocaleString("fr-FR")} €` : "-" },
    { key: "date_validite", label: "Validité", render: (r) => r.date_validite ? format(new Date(r.date_validite), "dd/MM/yyyy") : "-" },
    { key: "statut", label: "Statut", render: (r) => <StatusBadge status={r.statut} /> },
    { key: "actions", label: "", render: (r) => (
      <div className="flex gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleEdit(r); }}>
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(r.id); }}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    )},
  ];

  return (
    <div>
      <PageHeader title="Devis" subtitle={`${devis.length} devis`} onAdd={() => setModalOpen(true)} addLabel="Nouveau devis" />
      <DataTable columns={columns} data={devis} isLoading={isLoading} emptyMessage="Aucun devis" />
      <FormModal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? "Modifier le devis" : "Nouveau devis"}
        fields={formFields}
        data={formData}
        onChange={setFormData}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}