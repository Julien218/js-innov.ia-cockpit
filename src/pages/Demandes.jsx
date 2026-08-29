import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
const useMutationAny = /** @type {any} */ (useMutation);
import PageHeader from "@/components/shared/PageHeader";
import ErrorState from "@/components/shared/ErrorState";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const formFields = [
  { key: "nom", label: "Nom du contact", required: true },
  { key: "email", label: "E-mail", type: "email", required: true },
  { key: "telephone", label: "Téléphone" },
  { key: "entreprise", label: "Entreprise" },
  { key: "message", label: "Demande", type: "textarea", required: true },
  { key: "type", label: "Origine", type: "select", options: [
    { value: "contact", label: "Contact" },
    { value: "elynea_commerciale", label: "Elynea — site web" },
    { value: "demande_devis", label: "Demande de devis" },
    { value: "support", label: "Support" },
    { value: "autre", label: "Autre" },
  ]},
  { key: "statut", label: "Statut", type: "select", options: [
    { value: "nouveau", label: "Nouvelle" },
    { value: "en_cours", label: "En cours" },
    { value: "traite", label: "Traitée" },
    { value: "ferme", label: "Fermée" },
  ]},
];

export default function Demandes() {
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatut, setFilterStatut] = useState("tous");
  const queryClient = useQueryClient();

  const { data: demandes = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["demandes"],
    queryFn: () => base44.entities.Demande.list("-created_at"),
  });

  const createMutation = useMutationAny({
    mutationFn: (d) => base44.entities.Demande.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["demandes"] }); closeModal(); },
  });
  const updateMutation = useMutationAny({
    mutationFn: ({ id, data }) => base44.entities.Demande.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["demandes"] }); closeModal(); },
  });
  const deleteMutation = useMutationAny({
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
      (!search || [d.nom, d.entreprise, d.email, d.message].some(value => value?.toLowerCase().includes(search.toLowerCase())))
    ), [demandes, search, filterStatut]
  );

  const nouvelles = demandes.filter(d => d.statut === "nouveau").length;
  const enTraitement = demandes.filter(d => d.statut === "en_cours").length;

  const columns = [
    { key: "message", label: "Demande", render: (r) => (
      <div>
        <p className="font-medium text-sm">{r.type === "elynea_commerciale" ? "Demande qualifiée par Elynea" : (r.type || "Contact")}</p>
        <p className="text-xs text-muted-foreground line-clamp-2">{r.message}</p>
      </div>
    )},
    { key: "nom", label: "Contact", render: (r) => (
      <div>
        <p className="text-sm">{r.nom || "-"}</p>
        {r.entreprise && <p className="text-xs text-muted-foreground">{r.entreprise}</p>}
        {r.email && <p className="text-xs text-muted-foreground">{r.email}</p>}
      </div>
    )},
    { key: "type", label: "Origine", render: (r) => <span className="text-xs capitalize text-muted-foreground">{r.type?.replace(/_/g, " ") || "-"}</span> },
    { key: "created_at", label: "Date", render: (r) => <span className="text-xs text-muted-foreground">{format(new Date(r.created_date || r.created_at), "dd MMM", { locale: fr })}</span> },
    { key: "statut", label: "Statut", render: (r) => <StatusBadge status={r.statut} /> },
    { key: "actions", label: "", render: (r) => (
      <div className="flex gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleEdit(r); }}><Pencil className="w-3 h-3" /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(r.id); }}><Trash2 className="w-3 h-3" /></Button>
      </div>
    )},
  ];

  if (isError) {
    return (
      <div className="space-y-4">
        <ErrorState
          title="Impossible de charger les demandes"
          message={error?.message || "Erreur de connexion au serveur backend."}
          onRetry={refetch}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Demandes"
        subtitle={`${nouvelles} nouvelles · ${enTraitement} en cours`}
        onAdd={() => setModalOpen(true)}
        addLabel="Nouvelle demande"
        search={search}
        onSearch={setSearch}
        actions={
          <div className="flex gap-1 bg-muted rounded-lg p-0.5">
            {["tous", "nouveau", "en_cours", "traite"].map(s => (
              <button key={s} onClick={() => setFilterStatut(s)}
                className={`px-3 py-1.5 text-xs rounded-md font-medium transition-all ${filterStatut === s ? "bg-white shadow text-foreground" : "text-muted-foreground"}`}>
                {s === "tous" ? "Tous" : s === "nouveau" ? "Nouvelles" : s === "en_cours" ? "En cours" : "Traitées"}
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
