import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Pencil, Clock, Zap, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

const typeLabels = {
  devis: "Devis", message_client: "Message client", contenu: "Contenu",
  email: "Email", facture: "Facture", autre: "Autre"
};

const typeColors = {
  devis: "bg-blue-500/10 text-blue-600",
  message_client: "bg-purple-500/10 text-purple-600",
  contenu: "bg-pink-500/10 text-pink-600",
  email: "bg-amber-500/10 text-amber-600",
  facture: "bg-emerald-500/10 text-emerald-600",
  autre: "bg-slate-500/10 text-slate-600",
};

const formFields = [
  { key: "titre", label: "Titre", required: true },
  { key: "type_action", label: "Type d'action", type: "select", options: [
    { value: "devis", label: "Devis" },
    { value: "message_client", label: "Message client" },
    { value: "contenu", label: "Contenu" },
    { value: "email", label: "Email" },
    { value: "facture", label: "Facture" },
    { value: "autre", label: "Autre" },
  ]},
  { key: "client_nom", label: "Client concerné" },
  { key: "contenu_propose", label: "Contenu proposé par l'IA", type: "textarea" },
  { key: "priorite", label: "Priorité", type: "select", options: [
    { value: "basse", label: "Basse" },
    { value: "normale", label: "Normale" },
    { value: "haute", label: "Haute" },
    { value: "urgente", label: "Urgente" },
  ]},
  { key: "commentaire_julien", label: "Mon commentaire / modification", type: "textarea" },
  { key: "statut", label: "Décision", type: "select", options: [
    { value: "en_attente", label: "En attente" },
    { value: "approuve", label: "✅ Approuvé" },
    { value: "modifie", label: "✏️ Approuvé avec modification" },
    { value: "rejete", label: "❌ Rejeté" },
  ]},
];

export default function Validations() {
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState("en_attente");
  const queryClient = useQueryClient();

  const { data: validations = [], isLoading } = useQuery({
    queryKey: ["validations"],
    queryFn: () => base44.entities.Validation.list("-created_date"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Validation.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["validations"] }); closeModal(); },
  });
  const createMutation = useMutation({
    mutationFn: (d) => base44.entities.Validation.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["validations"] }); closeModal(); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Validation.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["validations"] }),
  });

  const closeModal = () => { setModalOpen(false); setFormData({}); setEditingId(null); };
  const handleEdit = (v) => { setFormData(v); setEditingId(v.id); setModalOpen(true); };
  const handleSubmit = () => {
    if (editingId) updateMutation.mutate({ id: editingId, data: formData });
    else createMutation.mutate({ ...formData, propose_par: "NOVA (IA)", statut: "en_attente" });
  };
  const quickDecision = (id, statut) => updateMutation.mutate({ id, data: { statut, action_executee_at: new Date().toISOString() } });

  const filtered = useMemo(() =>
    filter === "tous" ? validations : validations.filter(v => v.statut === filter),
    [validations, filter]
  );

  const enAttente = validations.filter(v => v.statut === "en_attente").length;
  const urgentes = validations.filter(v => v.statut === "en_attente" && v.priorite === "urgente").length;

  return (
    <div>
      <PageHeader
        title="Validations"
        subtitle={`${enAttente} en attente${urgentes > 0 ? ` · ${urgentes} urgentes` : ""}`}
        onAdd={() => setModalOpen(true)}
        addLabel="Nouvelle validation"
        actions={
          <div className="flex gap-1 bg-muted rounded-lg p-0.5">
            {["en_attente", "approuve", "modifie", "rejete", "tous"].map(s => (
              <button key={s} onClick={() => setFilter(s)}
                className={cn("px-3 py-1.5 text-xs rounded-md font-medium transition-all",
                  filter === s ? "bg-white shadow text-foreground" : "text-muted-foreground")}>
                {s === "tous" ? "Tous" : s === "en_attente" ? `En attente${enAttente > 0 ? ` (${enAttente})` : ""}` : s === "approuve" ? "Approuvés" : s === "modifie" ? "Modifiés" : "Rejetés"}
              </button>
            ))}
          </div>
        }
      />

      {/* Règle métier reminder */}
      <div className="mb-5 flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-2xl px-5 py-3">
        <Zap className="w-4 h-4 text-primary flex-shrink-0" />
        <p className="text-sm text-foreground font-medium">
          <span className="text-primary">IA propose</span>
          <span className="text-muted-foreground mx-2">→</span>
          <span className="text-foreground">Julien valide</span>
          <span className="text-muted-foreground mx-2">→</span>
          <span className="text-emerald-600">Action envoyée</span>
        </p>
        <p className="text-xs text-muted-foreground ml-auto">Aucune action ne part sans validation humaine</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array(3).fill(0).map((_, i) => <div key={i} className="h-28 bg-muted rounded-2xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-16 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3 opacity-40" />
          <p className="text-muted-foreground text-sm">
            {filter === "en_attente" ? "Aucune validation en attente 🎉" : "Aucun élément"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((v) => (
            <div key={v.id} className={cn(
              "bg-card rounded-2xl border p-5 transition-all",
              v.statut === "en_attente" && v.priorite === "urgente" ? "border-red-500/30 shadow-sm shadow-red-500/10" :
              v.statut === "en_attente" ? "border-amber-500/20" : "border-border opacity-80"
            )}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={cn("text-xs font-medium px-2.5 py-0.5 rounded-lg", typeColors[v.type_action] || "bg-muted text-muted-foreground")}>
                      {typeLabels[v.type_action] || v.type_action}
                    </span>
                    {v.priorite && v.priorite !== "normale" && <StatusBadge status={v.priorite} />}
                    <StatusBadge status={v.statut} />
                    <span className="text-xs text-muted-foreground ml-auto">
                      {format(new Date(v.created_date), "dd MMM à HH:mm", { locale: fr })}
                    </span>
                  </div>
                  <h3 className="font-semibold text-sm text-foreground mb-1" style={{fontFamily: "'Space Grotesk', sans-serif"}}>{v.titre}</h3>
                  {v.client_nom && <p className="text-xs text-muted-foreground mb-2">Client : {v.client_nom}</p>}
                  {v.contenu_propose && (
                    <div className="bg-muted/60 rounded-xl p-3 mt-2">
                      <p className="text-[11px] font-medium text-primary mb-1 flex items-center gap-1"><Zap className="w-3 h-3" /> Proposition NOVA</p>
                      <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{v.contenu_propose}</p>
                    </div>
                  )}
                  {v.commentaire_julien && (
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 mt-2">
                      <p className="text-[11px] font-medium text-amber-600 mb-1">💬 Mon commentaire</p>
                      <p className="text-xs text-foreground">{v.commentaire_julien}</p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 flex-shrink-0">
                  {v.statut === "en_attente" && (
                    <>
                      <Button size="sm" className="h-8 bg-emerald-500 hover:bg-emerald-600 text-white text-xs"
                        onClick={() => quickDecision(v.id, "approuve")}>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approuver
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs border-red-300 text-red-600 hover:bg-red-50"
                        onClick={() => quickDecision(v.id, "rejete")}>
                        <XCircle className="w-3.5 h-3.5 mr-1" /> Rejeter
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground"
                    onClick={() => handleEdit(v)}>
                    <Pencil className="w-3 h-3 mr-1" /> Modifier
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive"
                    onClick={() => deleteMutation.mutate(v.id)}>
                    Supprimer
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <FormModal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? "Modifier la validation" : "Nouvelle proposition IA"}
        fields={formFields}
        data={formData}
        onChange={setFormData}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
