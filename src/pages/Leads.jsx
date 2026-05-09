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
  { key: "nom", label: "Nom", required: true },
  { key: "prenom", label: "Prénom" },
  { key: "email", label: "Email", type: "email", required: true },
  { key: "telephone", label: "Téléphone" },
  { key: "entreprise", label: "Entreprise" },
  { key: "source", label: "Source", type: "select", options: [
    { value: "site_web", label: "Site web" },
    { value: "recommandation", label: "Recommandation" },
    { value: "linkedin", label: "LinkedIn" },
    { value: "salon", label: "Salon" },
    { value: "appel_entrant", label: "Appel entrant" },
    { value: "autre", label: "Autre" },
  ]},
  { key: "statut", label: "Statut", type: "select", options: [
    { value: "nouveau", label: "Nouveau" },
    { value: "contacte", label: "Contacté" },
    { value: "qualifie", label: "Qualifié" },
    { value: "proposition", label: "Proposition" },
    { value: "gagne", label: "Gagné" },
    { value: "perdu", label: "Perdu" },
  ]},
  { key: "valeur_estimee", label: "Valeur estimée (€)", type: "number" },
  { key: "date_relance", label: "Date de relance", type: "date" },
  { key: "notes", label: "Notes", type: "textarea" },
];

export default function Leads() {
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingId, setEditingId] = useState(null);
  const queryClient = useQueryClient();

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads"],
    queryFn: () => base44.entities.Lead.list("-created_date"),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Lead.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["leads"] }); closeModal(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Lead.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["leads"] }); closeModal(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Lead.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads"] }),
  });

  const closeModal = () => { setModalOpen(false); setFormData({}); setEditingId(null); };

  const handleEdit = (lead) => {
    setFormData(lead);
    setEditingId(lead.id);
    setModalOpen(true);
  };

  const handleSubmit = () => {
    if (editingId) updateMutation.mutate({ id: editingId, data: formData });
    else createMutation.mutate(formData);
  };

  const columns = [
    { key: "nom", label: "Nom", render: (r) => <span className="font-medium">{r.prenom} {r.nom}</span> },
    { key: "email", label: "Email" },
    { key: "entreprise", label: "Entreprise" },
    { key: "source", label: "Source", render: (r) => <span className="capitalize text-xs">{r.source?.replace(/_/g, " ")}</span> },
    { key: "valeur_estimee", label: "Valeur", render: (r) => r.valeur_estimee ? `${r.valeur_estimee.toLocaleString("fr-FR")} €` : "-" },
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
      <PageHeader title="Leads" subtitle={`${leads.length} leads`} onAdd={() => setModalOpen(true)} addLabel="Nouveau lead" />
      <DataTable columns={columns} data={leads} isLoading={isLoading} emptyMessage="Aucun lead" />
      <FormModal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? "Modifier le lead" : "Nouveau lead"}
        fields={formFields}
        data={formData}
        onChange={setFormData}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}