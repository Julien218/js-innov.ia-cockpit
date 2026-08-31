import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDemandes } from "@/lib/useDemandes";
import { demandeStatus, isNewDemande, demandeOrigin, demandeTitle, demandeFormData, DEMANDE_STATUS_OPTIONS, DEMANDE_STATUS_FILTERS } from "@/lib/demandePresentation";
const useMutationAny = /** @type {any} */ (useMutation);
import PageHeader from "@/components/shared/PageHeader";
import ErrorState from "@/components/shared/ErrorState";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { format, isValid } from "date-fns";
import { fr } from "date-fns/locale";

const formFields = [
  { key: "nom", label: "Nom du contact", required: true },
  { key: "email", label: "E-mail", type: "email" },
  { key: "telephone", label: "Téléphone" },
  { key: "entreprise", label: "Entreprise" },
  { key: "message", label: "Demande", type: "textarea", required: true },
  { key: "type", label: "Type de demande", type: "select", options: [
    { value: "contact", label: "Contact" },
    { value: "elynea_commerciale", label: "Elynea — site web" },
    { value: "demande_devis", label: "Demande de devis" },
    { value: "support", label: "Support" },
    { value: "autre", label: "Autre" },
  ]},
  { key: "statut", label: "Statut", type: "select", options: DEMANDE_STATUS_OPTIONS },
];

export default function Demandes() {
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatut, setFilterStatut] = useState("tous");
  const [selected, setSelected] = useState(null);
  const queryClient = useQueryClient();

  const { data: demandes = [], isLoading, isError, error, refetch } = useDemandes();

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
  const handleEdit = (d) => { setFormData(demandeFormData(d)); setEditingId(d.id); setModalOpen(true); };
  const handleSubmit = () => {
    if (editingId) updateMutation.mutate({ id: editingId, data: demandeFormData(formData) });
    else createMutation.mutate(demandeFormData(formData));
  };

  const filtered = useMemo(() =>
    demandes.filter(d =>
      (filterStatut === "tous" || demandeStatus(d) === filterStatut) &&
      (!search || [d.nom, d.entreprise, d.email, d.telephone, d.message, demandeOrigin(d)].some(value => value?.toLowerCase().includes(search.toLowerCase())))
    ), [demandes, search, filterStatut]
  );

  const nouvelles = demandes.filter(isNewDemande).length;
  const enTraitement = demandes.filter(d => demandeStatus(d) === "en_cours").length;
  const displayDate = (d) => {
    const date = new Date(d.created_at || d.created_date || '');
    return isValid(date) ? format(date, 'dd MMM yyyy', { locale: fr }) : 'Date non renseignée';
  };

  const columns = [
    { key: "message", label: "Demande", render: (_value, r) => (
      <div>
        <p className="font-medium text-sm">{demandeTitle(r)}</p>
        <p className="text-xs text-muted-foreground line-clamp-2 whitespace-normal max-w-md">{r.message || 'Message non renseigné'}</p>
      </div>
    )},
    { key: "nom", label: "Contact", render: (_value, r) => (
      <div>
        <p className="text-sm">{r.nom || "Contact non renseigné"}</p>
        {r.entreprise && <p className="text-xs text-muted-foreground">{r.entreprise}</p>}
        {r.email && <p className="text-xs text-muted-foreground">{r.email}</p>}
        {r.telephone && <p className="text-xs text-muted-foreground">{r.telephone}</p>}
      </div>
    )},
    { key: "type", label: "Origine", render: (_value, r) => <span className="text-xs text-muted-foreground">{demandeOrigin(r)}</span> },
    { key: "created_at", label: "Date", render: (_value, r) => <span className="text-xs text-muted-foreground">{displayDate(r)}</span> },
    { key: "statut", label: "Statut", render: (_value, r) => <StatusBadge status={demandeStatus(r)} /> },
    { key: "actions", label: "", render: (_value, r) => (
      <div className="flex gap-1">
        <Button aria-label="Voir la demande" variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setSelected(r); }}><Eye className="w-3 h-3" /></Button>
        <Button aria-label="Modifier la demande" variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleEdit(r); }}><Pencil className="w-3 h-3" /></Button>
        <Button aria-label="Supprimer la demande" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); if (window.confirm('Supprimer cette demande ?')) deleteMutation.mutate(r.id); }}><Trash2 className="w-3 h-3" /></Button>
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
        onAdd={() => { setFormData(demandeFormData()); setEditingId(null); setModalOpen(true); }}
        addLabel="Nouvelle demande"
        search={search}
        onSearch={setSearch}
        actions={
          <div className="flex gap-1 bg-muted rounded-lg p-0.5">
            {["tous", ...Object.keys(DEMANDE_STATUS_FILTERS)].map(s => (
              <button key={s} onClick={() => setFilterStatut(s)}
                className={`px-3 py-1.5 text-xs rounded-md font-medium transition-all ${filterStatut === s ? "bg-white shadow text-foreground" : "text-muted-foreground"}`}>
                {s === "tous" ? "Tous" : DEMANDE_STATUS_FILTERS[s]}
              </button>
            ))}
          </div>
        }
      />
      {(createMutation.error || updateMutation.error || deleteMutation.error) && <p role="alert" className="text-destructive text-sm">{(createMutation.error || updateMutation.error || deleteMutation.error).message}</p>}
      <DataTable columns={columns} data={filtered} isLoading={isLoading} emptyMessage="Aucune demande" onRowClick={setSelected} />
      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected ? demandeTitle(selected) : 'Demande'}</DialogTitle>
            <DialogDescription>Coordonnées et origine enregistrées pour cette demande.</DialogDescription>
          </DialogHeader>
          {selected && <div className="space-y-3 text-sm">
            <p><strong>Contact :</strong> {selected.nom || 'Non renseigné'} {selected.entreprise && `— ${selected.entreprise}`}</p>
            <p><strong>E-mail :</strong> {selected.email || 'Non renseigné'}</p>
            <p><strong>Téléphone :</strong> {selected.telephone || 'Non renseigné'}</p>
            <p><strong>Origine :</strong> {demandeOrigin(selected)}</p>
            <p><strong>Date :</strong> {displayDate(selected)}</p>
            {selected.created_by && <p><strong>Enregistrée par :</strong> {selected.created_by}</p>}
            <StatusBadge status={demandeStatus(selected)} />
            <p className="whitespace-pre-wrap break-words">{selected.message || 'Message non renseigné'}</p>
          </div>}
        </DialogContent>
      </Dialog>
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
