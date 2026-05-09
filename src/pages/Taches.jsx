import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, CheckSquare, Clock, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

const formFields = [
  { key: "titre", label: "Titre", required: true },
  { key: "description", label: "Description", type: "textarea" },
  { key: "projet_nom", label: "Projet" },
  { key: "client_nom", label: "Client" },
  { key: "statut", label: "Statut", type: "select", options: [
    { value: "a_faire", label: "À faire" },
    { value: "en_cours", label: "En cours" },
    { value: "terminee", label: "Terminée" },
    { value: "bloquee", label: "Bloquée" },
  ]},
  { key: "priorite", label: "Priorité", type: "select", options: [
    { value: "basse", label: "Basse" },
    { value: "moyenne", label: "Moyenne" },
    { value: "haute", label: "Haute" },
    { value: "urgente", label: "Urgente" },
  ]},
  { key: "date_echeance", label: "Échéance", type: "date" },
];

const statuts = ["a_faire", "en_cours", "terminee", "bloquee"];
const statutLabels = { a_faire: "À faire", en_cours: "En cours", terminee: "Terminée", bloquee: "Bloquée" };

export default function Taches() {
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingId, setEditingId] = useState(false);
  const [view, setView] = useState("liste");
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const { data: taches = [], isLoading } = useQuery({
    queryKey: ["taches"],
    queryFn: () => base44.entities.Tache.list("-created_date"),
  });

  const createMutation = useMutation({
    mutationFn: (d) => base44.entities.Tache.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["taches"] }); closeModal(); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Tache.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["taches"] }); closeModal(); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Tache.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["taches"] }),
  });

  const closeModal = () => { setModalOpen(false); setFormData({}); setEditingId(null); };
  const handleEdit = (t) => { setFormData(t); setEditingId(t.id); setModalOpen(true); };
  const handleSubmit = () => {
    if (editingId) updateMutation.mutate({ id: editingId, data: formData });
    else createMutation.mutate(formData);
  };

  const filtered = useMemo(() =>
    taches.filter(t => !search || t.titre?.toLowerCase().includes(search.toLowerCase())),
    [taches, search]
  );

  const isOverdue = (t) => t.date_echeance && new Date(t.date_echeance) < new Date() && t.statut !== "terminee";

  const columns = [
    { key: "titre", label: "Tâche", render: (r) => (
      <div className="flex items-center gap-2">
        {isOverdue(r) && <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
        <span className={cn("font-medium text-sm", r.statut === "terminee" && "line-through text-muted-foreground")}>{r.titre}</span>
      </div>
    )},
    { key: "projet_nom", label: "Projet", render: (r) => <span className="text-xs text-muted-foreground">{r.projet_nom || "-"}</span> },
    { key: "client_nom", label: "Client", render: (r) => <span className="text-xs text-muted-foreground">{r.client_nom || "-"}</span> },
    { key: "priorite", label: "Priorité", render: (r) => r.priorite ? <StatusBadge status={r.priorite} /> : "-" },
    { key: "date_echeance", label: "Échéance", render: (r) => r.date_echeance ? (
      <span className={cn("text-xs", isOverdue(r) ? "text-red-500 font-medium" : "text-muted-foreground")}>
        {format(new Date(r.date_echeance), "dd MMM", { locale: fr })}
      </span>
    ) : "-" },
    { key: "statut", label: "Statut", render: (r) => <StatusBadge status={r.statut} /> },
    { key: "actions", label: "", render: (r) => (
      <div className="flex gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleEdit(r); }}><Pencil className="w-3 h-3" /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(r.id); }}><Trash2 className="w-3 h-3" /></Button>
      </div>
    )},
  ];

  const enRetard = taches.filter(isOverdue).length;
  const terminees = taches.filter(t => t.statut === "terminee").length;

  return (
    <div>
      <PageHeader
        title="Tâches"
        subtitle={`${taches.length} tâches · ${enRetard} en retard · ${terminees} terminées`}
        onAdd={() => setModalOpen(true)}
        addLabel="Nouvelle tâche"
        search={search}
        onSearch={setSearch}
        actions={
          <div className="flex gap-1 bg-muted rounded-lg p-0.5">
            <button onClick={() => setView("liste")} className={cn("px-3 py-1.5 text-xs rounded-md font-medium transition-all", view === "liste" ? "bg-white shadow text-foreground" : "text-muted-foreground")}>Liste</button>
            <button onClick={() => setView("kanban")} className={cn("px-3 py-1.5 text-xs rounded-md font-medium transition-all", view === "kanban" ? "bg-white shadow text-foreground" : "text-muted-foreground")}>Kanban</button>
          </div>
        }
      />

      {view === "liste" ? (
        <DataTable columns={columns} data={filtered} isLoading={isLoading} emptyMessage="Aucune tâche" />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statuts.map(statut => {
            const items = filtered.filter(t => t.statut === statut);
            return (
              <div key={statut} className="bg-card rounded-2xl border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{statutLabels[statut]}</h3>
                  <span className="text-xs bg-muted px-2 py-0.5 rounded-full font-medium">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map(t => (
                    <div key={t.id} onClick={() => handleEdit(t)} className="bg-background rounded-xl border border-border p-3 cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all">
                      <p className="text-xs font-medium text-foreground mb-1.5">{t.titre}</p>
                      <div className="flex items-center justify-between">
                        {t.priorite && <StatusBadge status={t.priorite} />}
                        {t.date_echeance && (
                          <span className={cn("text-[10px]", isOverdue(t) ? "text-red-500" : "text-muted-foreground")}>
                            {format(new Date(t.date_echeance), "dd/MM")}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && <p className="text-[11px] text-muted-foreground text-center py-4">Vide</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <FormModal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? "Modifier la tâche" : "Nouvelle tâche"}
        fields={formFields}
        data={formData}
        onChange={setFormData}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
