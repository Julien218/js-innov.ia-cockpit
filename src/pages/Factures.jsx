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
  { key: "numero", label: "Numéro de facture", required: true, placeholder: "FAC-001" },
  { key: "client_nom", label: "Nom du client" },
  { key: "objet", label: "Objet", required: true },
  { key: "montant_ht", label: "Montant HT (€)", type: "number" },
  { key: "tva", label: "TVA (%)", type: "number", placeholder: "20" },
  { key: "montant_ttc", label: "Montant TTC (€)", type: "number" },
  { key: "statut", label: "Statut", type: "select", options: [
    { value: "brouillon", label: "Brouillon" },
    { value: "envoyee", label: "Envoyée" },
    { value: "payee", label: "Payée" },
    { value: "en_retard", label: "En retard" },
    { value: "annulee", label: "Annulée" },
  ]},
  { key: "date_echeance", label: "Date d'échéance", type: "date" },
  { key: "date_paiement", label: "Date de paiement", type: "date" },
  { key: "mode_paiement", label: "Mode de paiement", type: "select", options: [
    { value: "virement", label: "Virement" },
    { value: "cheque", label: "Chèque" },
    { value: "carte", label: "Carte bancaire" },
    { value: "especes", label: "Espèces" },
    { value: "prelevement", label: "Prélèvement" },
  ]},
];

export default function Factures() {
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingId, setEditingId] = useState(null);
  const queryClient = useQueryClient();

  const { data: factures = [], isLoading } = useQuery({
    queryKey: ["factures"],
    queryFn: () => base44.entities.Facture.list("-created_date"),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Facture.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["factures"] }); closeModal(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Facture.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["factures"] }); closeModal(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Facture.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["factures"] }),
  });

  const closeModal = () => { setModalOpen(false); setFormData({}); setEditingId(null); };

  const handleEdit = (f) => {
    setFormData(f);
    setEditingId(f.id);
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
    { key: "date_echeance", label: "Échéance", render: (r) => r.date_echeance ? format(new Date(r.date_echeance), "dd/MM/yyyy") : "-" },
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
      <PageHeader title="Factures" subtitle={`${factures.length} factures`} onAdd={() => setModalOpen(true)} addLabel="Nouvelle facture" />
      <DataTable columns={columns} data={factures} isLoading={isLoading} emptyMessage="Aucune facture" />
      <FormModal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? "Modifier la facture" : "Nouvelle facture"}
        fields={formFields}
        data={formData}
        onChange={setFormData}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}