import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";

const typeLabels = {
  auto: "Auto",
  habitation: "Habitation",
  sante: "Santé",
  vie: "Vie",
  prevoyance: "Prévoyance",
  responsabilite_civile_pro: "RC Pro",
  multirisque_pro: "Multirisque Pro",
  autre: "Autre",
};

const formFields = [
  { key: "reference", label: "Référence", required: true, placeholder: "COM-001" },
  { key: "client_nom", label: "Nom du client" },
  { key: "assureur", label: "Assureur", required: true },
  { key: "type_contrat", label: "Type de contrat", type: "select", options: [
    { value: "auto", label: "Auto" },
    { value: "habitation", label: "Habitation" },
    { value: "sante", label: "Santé" },
    { value: "vie", label: "Vie" },
    { value: "prevoyance", label: "Prévoyance" },
    { value: "responsabilite_civile_pro", label: "RC Pro" },
    { value: "multirisque_pro", label: "Multirisque Pro" },
    { value: "autre", label: "Autre" },
  ]},
  { key: "numero_contrat", label: "N° contrat" },
  { key: "prime_annuelle", label: "Prime annuelle (€)", type: "number" },
  { key: "taux_commission", label: "Taux commission (%)", type: "number" },
  { key: "montant", label: "Montant commission (€)", type: "number" },
  { key: "date_effet", label: "Date d'effet", type: "date" },
  { key: "date_echeance", label: "Date d'échéance", type: "date" },
  { key: "statut", label: "Statut", type: "select", options: [
    { value: "en_attente", label: "En attente" },
    { value: "payee", label: "Perçue" },
    { value: "annulee", label: "Annulée" },
  ]},
  { key: "notes", label: "Notes", type: "textarea" },
];

export default function Commissions() {
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingId, setEditingId] = useState(null);
  const queryClient = useQueryClient();

  const { data: commissions = [], isLoading } = useQuery({
    queryKey: ["commissions"],
    queryFn: () => base44.entities.Commission.list("-created_at"),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Commission.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["commissions"] }); closeModal(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Commission.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["commissions"] }); closeModal(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Commission.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["commissions"] }),
  });

  const closeModal = () => { setModalOpen(false); setFormData({}); setEditingId(null); };

  const handleEdit = (c) => {
    setFormData(c);
    setEditingId(c.id);
    setModalOpen(true);
  };

  const handleSubmit = () => {
    if (editingId) updateMutation.mutate({ id: editingId, data: formData });
    else createMutation.mutate(formData);
  };

  const totalCommissions = commissions.filter(c => c.statut === "payee").reduce((s, c) => s + (c.montant || 0), 0);

  const columns = [
    { key: "reference", label: "Réf.", render: (r) => <span className="font-mono text-xs font-semibold">{r.reference}</span> },
    { key: "client_nom", label: "Client" },
    { key: "assureur", label: "Assureur", render: (r) => <span className="font-medium">{r.assureur}</span> },
    { key: "type_contrat", label: "Type", render: (r) => <span className="text-xs">{typeLabels[r.type_contrat] || r.type_contrat}</span> },
    { key: "prime_annuelle", label: "Prime", render: (r) => r.prime_annuelle ? `${r.prime_annuelle.toLocaleString("fr-FR")} €` : "-" },
    { key: "taux_commission", label: "Taux", render: (r) => r.taux_commission ? `${r.taux_commission}%` : "-" },
    { key: "montant", label: "Commission", render: (r) => r.montant ? <span className="font-semibold text-emerald-600">{r.montant.toLocaleString("fr-FR")} €</span> : "-" },
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
      <PageHeader
        title="Commissions assurance"
        subtitle={`${commissions.length} commissions · Total perçu : ${totalCommissions.toLocaleString("fr-FR")} €`}
        onAdd={() => setModalOpen(true)}
        addLabel="Nouvelle commission"
      />
      <DataTable columns={columns} data={commissions} isLoading={isLoading} emptyMessage="Aucune commission" />
      <FormModal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? "Modifier la commission" : "Nouvelle commission"}
        fields={formFields}
        data={formData}
        onChange={setFormData}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}