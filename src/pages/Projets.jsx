import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";

const formFields = [
  { key: "nom", label: "Nom du projet", required: true },
  { key: "client_nom", label: "Nom du client" },
  { key: "description", label: "Description", type: "textarea" },
  { key: "statut", label: "Statut", type: "select", options: [
    { value: "en_attente", label: "En attente" },
    { value: "en_cours", label: "En cours" },
    { value: "termine", label: "Terminé" },
    { value: "annule", label: "Annulé" },
  ]},
  { key: "priorite", label: "Priorité", type: "select", options: [
    { value: "basse", label: "Basse" },
    { value: "moyenne", label: "Moyenne" },
    { value: "haute", label: "Haute" },
    { value: "urgente", label: "Urgente" },
  ]},
  { key: "date_debut", label: "Date début", type: "date" },
  { key: "date_fin_prevue", label: "Date fin prévue", type: "date" },
  { key: "budget", label: "Budget (€)", type: "number" },
  { key: "progression", label: "Progression (%)", type: "number" },
];

export default function Projets() {
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingId, setEditingId] = useState(null);
  const queryClient = useQueryClient();

  const { data: projets = [], isLoading } = useQuery({
    queryKey: ["projets"],
    queryFn: () => base44.entities.Projet.list("-created_date"),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Projet.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["projets"] }); closeModal(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Projet.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["projets"] }); closeModal(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Projet.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projets"] }),
  });

  const closeModal = () => { setModalOpen(false); setFormData({}); setEditingId(null); };

  const handleEdit = (p) => {
    setFormData(p);
    setEditingId(p.id);
    setModalOpen(true);
  };

  const handleSubmit = () => {
    if (editingId) updateMutation.mutate({ id: editingId, data: formData });
    else createMutation.mutate(formData);
  };

  const columns = [
    { key: "nom", label: "Projet", render: (r) => <span className="font-medium">{r.nom}</span> },
    { key: "client_nom", label: "Client" },
    { key: "priorite", label: "Priorité", render: (r) => <span className="capitalize text-xs">{r.priorite}</span> },
    { key: "progression", label: "Progression", render: (r) => (
      <div className="flex items-center gap-2 min-w-[120px]">
        <Progress value={r.progression || 0} className="h-2 flex-1" />
        <span className="text-xs text-muted-foreground w-8">{r.progression || 0}%</span>
      </div>
    )},
    { key: "budget", label: "Budget", render: (r) => r.budget ? `${r.budget.toLocaleString("fr-FR")} €` : "-" },
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
      <PageHeader title="Projets" subtitle={`${projets.length} projets`} onAdd={() => setModalOpen(true)} addLabel="Nouveau projet" />
      <DataTable columns={columns} data={projets} isLoading={isLoading} emptyMessage="Aucun projet" />
      <FormModal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? "Modifier le projet" : "Nouveau projet"}
        fields={formFields}
        data={formData}
        onChange={setFormData}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}