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
  { key: "adresse", label: "Adresse" },
  { key: "ville", label: "Ville" },
  { key: "code_postal", label: "Code postal" },
  { key: "type_client", label: "Type", type: "select", options: [
    { value: "particulier", label: "Particulier" },
    { value: "professionnel", label: "Professionnel" },
    { value: "entreprise", label: "Entreprise" },
  ]},
  { key: "statut", label: "Statut", type: "select", options: [
    { value: "actif", label: "Actif" },
    { value: "inactif", label: "Inactif" },
    { value: "prospect", label: "Prospect" },
  ]},
  { key: "notes", label: "Notes", type: "textarea" },
];

export default function Clients() {
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingId, setEditingId] = useState(null);
  const queryClient = useQueryClient();

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: () => base44.entities.Client.list("-created_date"),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Client.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["clients"] }); closeModal(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Client.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["clients"] }); closeModal(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Client.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clients"] }),
  });

  const closeModal = () => { setModalOpen(false); setFormData({}); setEditingId(null); };

  const handleEdit = (client) => {
    setFormData(client);
    setEditingId(client.id);
    setModalOpen(true);
  };

  const handleSubmit = () => {
    if (editingId) updateMutation.mutate({ id: editingId, data: formData });
    else createMutation.mutate(formData);
  };

  const columns = [
    { key: "nom", label: "Nom", render: (r) => <span className="font-medium">{r.prenom} {r.nom}</span> },
    { key: "email", label: "Email" },
    { key: "telephone", label: "Téléphone" },
    { key: "entreprise", label: "Entreprise" },
    { key: "type_client", label: "Type", render: (r) => <span className="capitalize text-xs">{r.type_client?.replace("_", " ")}</span> },
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
      <PageHeader title="Clients" subtitle={`${clients.length} clients`} onAdd={() => setModalOpen(true)} addLabel="Nouveau client" />
      <DataTable columns={columns} data={clients} isLoading={isLoading} emptyMessage="Aucun client" />
      <FormModal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? "Modifier le client" : "Nouveau client"}
        fields={formFields}
        data={formData}
        onChange={setFormData}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}