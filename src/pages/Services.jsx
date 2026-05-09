import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Package, Clock, Euro, ToggleLeft, ToggleRight } from "lucide-react";
import { cn } from "@/lib/utils";

const formFields = [
  { key: "nom", label: "Nom du service", required: true },
  { key: "description", label: "Description", type: "textarea" },
  { key: "categorie", label: "Catégorie", type: "select", options: [
    { value: "creation_web", label: "Création web" },
    { value: "automatisation", label: "Automatisation IA" },
    { value: "contenu", label: "Contenu & Social" },
    { value: "application", label: "Application" },
    { value: "conseil", label: "Conseil & Stratégie" },
    { value: "maintenance", label: "Maintenance" },
    { value: "assurance", label: "Assurance" },
    { value: "autre", label: "Autre" },
  ]},
  { key: "prix_base", label: "Prix de base (€)", type: "number" },
  { key: "duree_estimee_jours", label: "Durée estimée (jours)", type: "number" },
  { key: "livrables", label: "Livrables (séparés par virgule)", type: "textarea" },
  { key: "actif", label: "Actif", type: "select", options: [
    { value: "true", label: "Oui" },
    { value: "false", label: "Non" },
  ]},
];

const categorieColors = {
  creation_web: "bg-blue-500/10 text-blue-600",
  automatisation: "bg-purple-500/10 text-purple-600",
  contenu: "bg-pink-500/10 text-pink-600",
  application: "bg-indigo-500/10 text-indigo-600",
  conseil: "bg-amber-500/10 text-amber-600",
  maintenance: "bg-slate-500/10 text-slate-600",
  assurance: "bg-emerald-500/10 text-emerald-600",
  autre: "bg-gray-500/10 text-gray-600",
};

const categorieLabels = {
  creation_web: "Création web", automatisation: "Automatisation IA",
  contenu: "Contenu & Social", application: "Application",
  conseil: "Conseil", maintenance: "Maintenance", assurance: "Assurance", autre: "Autre",
};

export default function Services() {
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const { data: services = [], isLoading } = useQuery({
    queryKey: ["services"],
    queryFn: () => base44.entities.Service.list("-created_date"),
  });

  const createMutation = useMutation({
    mutationFn: (d) => base44.entities.Service.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["services"] }); closeModal(); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Service.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["services"] }); closeModal(); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Service.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["services"] }),
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, actif }) => base44.entities.Service.update(id, { actif: !actif }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["services"] }),
  });

  const closeModal = () => { setModalOpen(false); setFormData({}); setEditingId(null); };
  const handleEdit = (s) => { setFormData({ ...s, actif: String(s.actif) }); setEditingId(s.id); setModalOpen(true); };
  const handleSubmit = () => {
    const data = { ...formData, actif: formData.actif === "true" || formData.actif === true };
    if (editingId) updateMutation.mutate({ id: editingId, data });
    else createMutation.mutate(data);
  };

  const filtered = useMemo(() =>
    services.filter(s => !search || s.nom?.toLowerCase().includes(search.toLowerCase())),
    [services, search]
  );

  if (isLoading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-muted rounded w-1/3" /><div className="h-64 bg-muted rounded-2xl" /></div>;

  return (
    <div>
      <PageHeader
        title="Services"
        subtitle={`${services.filter(s => s.actif).length} actifs · ${services.length} total`}
        onAdd={() => setModalOpen(true)}
        addLabel="Nouveau service"
        search={search}
        onSearch={setSearch}
      />

      {filtered.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-16 text-center">
          <Package className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="text-muted-foreground text-sm">Aucun service</p>
          <Button onClick={() => setModalOpen(true)} size="sm" className="mt-4 gradient-primary border-0 text-white">Créer votre premier service</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((service) => (
            <div key={service.id} className={cn("bg-card rounded-2xl border p-5 card-hover transition-all", !service.actif && "opacity-60 border-border", service.actif && "border-border")}>
              <div className="flex items-start justify-between mb-3">
                <div className={cn("text-xs font-medium px-2.5 py-1 rounded-lg", categorieColors[service.categorie] || "bg-muted text-muted-foreground")}>
                  {categorieLabels[service.categorie] || service.categorie}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => toggleMutation.mutate({ id: service.id, actif: service.actif })}>
                    {service.actif ? <ToggleRight className="w-4 h-4 text-emerald-500" /> : <ToggleLeft className="w-4 h-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(service)}><Pencil className="w-3 h-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(service.id)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </div>
              <h3 className="font-semibold text-sm text-foreground mb-1" style={{fontFamily: "'Space Grotesk', sans-serif"}}>{service.nom}</h3>
              {service.description && <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{service.description}</p>}
              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
                {service.prix_base && (
                  <div className="flex items-center gap-1 text-xs font-semibold text-foreground">
                    <Euro className="w-3 h-3 text-primary" />
                    {service.prix_base.toLocaleString("fr-FR")} €
                  </div>
                )}
                {service.duree_estimee_jours && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {service.duree_estimee_jours}j
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <FormModal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? "Modifier le service" : "Nouveau service"}
        fields={formFields}
        data={formData}
        onChange={setFormData}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
