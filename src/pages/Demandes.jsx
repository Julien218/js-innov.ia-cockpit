import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const formFields = [
  { key: "titre", label: "Titre", required: true },
  { key: "contenu", label: "Description", type: "textarea", required: true },
  { key: "client_nom", label: "Nom du client" },
  { key: "client_email", label: "Email", type: "email" },
  { key: "source", label: "Source", type: "select", options: [
    { value: "email", label: "Email" },
    { value: "telephone", label: "Téléphone" },
    { value: "formulaire", label: "Formulaire web" },
    { value: "direct", label: "Direct" },
    { value: "autre", label: "Autre" },
  ]},
  { key: "priorite", label: "Priorité", type: "select", options: [
    { value: "basse", label: "Basse" },
    { value: "moyenne", label: "Moyenne" },
    { value: "haute", label: "Haute" },
    { value: "urgente", label: "Urgente" },
  ]},
  { key: "statut", label: "Statut", type: "select", options: [
    { value: "ouverte", label: "Ouverte" },
    { value: "en_traitement", label: "En traitement" },
    { value: "resolue", label: "Résolue" },
    { value: "annulee", label: "Annulée" },
  ]},
  { key: "notes_internes", label: "Notes internes", type: "textarea" },
];

export default function Demandes() {
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatut, setFilterStatut] = useState("tous");
  const queryClient = useQueryClient();

  const { data: demandes = [], isLoading } = useQuery({
    queryKey: ["demandes"],
    queryFn: () => base44.entities.Demande.list("-created_date"),
  });

  const createMutation = useMutation({
    mutationFn: (d) => base44.entities.Demande.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["demandes"] }); closeModal(); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Demande.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["demandes"] }); closeModal(); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Demande.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["demandes"] }),
  });

  const closeModal = () => { setModalOpen(false); setFormData({}); setEditingId(null); };
  const handleEdit = (d) => { setFormData(d); setEditingId(d.id); setModalOpen(true); };
  const handleSubmit = () => {
    if (editingId) updateMutation.mutate({ id: editingId, data: formData });
    else createMutation.mutate(formData);
  };

  const filtered = useMemo(() =>
    demandes.filter(d =>
      (filterStatut === "tous" || d.statut === filterStatut) &&
      (!search || d.titre?.toLowerCase().includes(search.toLowerCase()) || d.client_nom?.toLowerCase().includes(search.toLowerCase()))
    ), [demandes, search, filterStatut]
  );

  const ouvertes = demandes.filter(d => d.statut === "ouverte").length;
  const enTraitement = demandes.filter(d => d.statut === "en_traitement").length;

  const columns = [
    { key: "titre", label: "Demande", render: (r) => (
      <div>
        <p className="font-medium text-sm">{r.titre}</p>
        <p className="text-xs text-muted-foreground line-clamp-1">{r.contenu}</p>
      </div>
    )},
    { key: "client_nom", label: "Client", render: (r) => (
      <div>
        <p className="text-sm">{r.client_nom || "-"}</p>
        {r.client_email && <p className="text-xs text-muted-foreground">{r.client_email}</p>}
      </div>
    )},
    { key: "source", label: "Source", render: (r) => <span className="text-xs capitalize text-muted-foreground">{r.source?.replace(/_/g, " ") || "-"}</span> },
    { key: "priorite", label: "Priorité", render: (r) => r.priorite ? <StatusBadge status={r.priorite} /> : "-" },
    { key: "created_date", label: "Date", render: (r) => <span className="text-xs text-muted-foreground">{format(new Date(r.created_date), "dd MMM", { locale: fr })}</span> },
    { key: "statut", label: "Statut", render: (r) => <StatusBadge status={r.statut} /> },
    { key: "actions", label: "", render: (r) => (
      <div className="flex gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleEdit(r); }}><Pencil className="w-3 h-3" /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(r.id); }}><Trash2 className="w-3 h-3" /></Button>
      </div>
    )},
  ];

  return (
    <div>
      <PageHeader
        title="Demandes"
        subtitle={`${ouvertes} ouvertes · ${enTraitement} en traitement`}
        onAdd={() => setModalOpen(true)}
        addLabel="Nouvelle demande"
        search={search}
        onSearch={setSearch}
        actions={
          <div className="flex gap-1 bg-muted rounded-lg p-0.5">
            {["tous", "ouverte", "en_traitement", "resolue"].map(s => (
              <button key={s} onClick={() => setFilterStatut(s)}
                className={`px-3 py-1.5 text-xs rounded-md font-medium transition-all ${filterStatut === s ? "bg-white shadow text-foreground" : "text-muted-foreground"}`}>
                {s === "tous" ? "Tous" : s === "ouverte" ? "Ouvertes" : s === "en_traitement" ? "En cours" : "Résolues"}
              </button>
            ))}
          </div>
        }
      />
      <DataTable columns={columns} data={filtered} isLoading={isLoading} emptyMessage="Aucune demande" />
      <FormModal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? "Modifier la demande" : "Nouvelle demande"}
        fields={formFields}
        data={formData}
        onChange={setFormData}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
