import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import ErrorState from "@/components/shared/ErrorState";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";

const INTERNAL_PROJECT_VALUE = "__jsinnovia_internal__";

const formFields = [
  { name: "nom",             label: "Nom du projet",     type: "text",   required: true },
  { name: "client_id",       label: "Propriétaire du projet", type: "select", required: true, options: [] },
  { name: "description",     label: "Description",       type: "textarea" },
  { name: "statut",          label: "Statut",            type: "select",
    options: ["en_attente","en_cours","pause","termine","annule"] },
  { name: "budget",          label: "Budget (€)",        type: "number" },
  { name: "date_debut",      label: "Date début",        type: "date" },
  { name: "date_fin_prevue", label: "Date fin prévue",   type: "date" },
  { name: "notes",           label: "Notes",             type: "textarea" },
];

const columns = [
  { key: "nom",             label: "Projet" },
  { key: "client_nom",      label: "Propriétaire", render: (v, row) => {
    if (row.client_id) return v || "Client rattaché";
    if (String(row.organisation_id || "").toLowerCase() === "jsinnovia") {
      return <span className="text-cyan-300">JS-Innov.IA — projet interne</span>;
    }
    return <span className="text-amber-300">À classer — interne ou client</span>;
  } },
  { key: "statut",          label: "Statut",   render: v => <StatusBadge status={v} /> },
  { key: "budget",          label: "Budget",   render: v => v ? `${v.toLocaleString("fr-BE")} €` : "—" },
  { key: "date_fin_prevue", label: "Fin prévue", render: v => v ? new Date(v).toLocaleDateString("fr-BE") : "—" },
];

export default function Projets() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: projets = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["Projet"],
    queryFn: () => base44.entities.Projet.list("-created_at"),
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["Client"],
    queryFn: () => base44.entities.Client.list("entreprise"),
  });
  const safeClients = Array.isArray(clients) ? clients : [];
  const resolvedFormFields = formFields.map((field) => field.name === "client_id"
    ? {
        ...field,
        options: [
          { value: INTERNAL_PROJECT_VALUE, label: "JS-Innov.IA — projet interne" },
          ...safeClients.map((client) => ({
            value: client.id,
            label: client.denomination_legale || client.entreprise || [client.prenom, client.nom].filter(Boolean).join(" ") || client.email,
          })),
        ],
      }
    : field);

  const save = useMutation({
    mutationFn: (data) => {
      const editableFields = new Set(resolvedFormFields.map((field) => field.name));
      const payload = Object.fromEntries(
        Object.entries(data || {}).filter(([key]) => editableFields.has(key))
      );
      if (payload.client_id === INTERNAL_PROJECT_VALUE) {
        payload.client_id = null;
        payload.client_nom = "JS-Innov.IA — projet interne";
        payload.organisation_id = "jsinnovia";
      } else {
        const selectedClient = safeClients.find((client) => client.id === payload.client_id);
        if (!selectedClient) throw new Error("Sélectionnez un client existant ou le propriétaire interne JS-Innov.IA.");
        payload.client_nom = selectedClient.denomination_legale || selectedClient.entreprise || [selectedClient.prenom, selectedClient.nom].filter(Boolean).join(" ");
      }
      return editing
        ? base44.entities.Projet.update(editing.id, payload)
        : base44.entities.Projet.create(payload);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["Projet"] });
      setOpen(false);
      setEditing(null);
    },
    onError: (saveError) => alert("Erreur d’enregistrement : " + (saveError?.message || "Erreur inconnue")),
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.Projet.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["Projet"] }),
  });

  const actions = (row) => (
    <div className="flex gap-2">
      <Button size="icon" variant="ghost" onClick={() => { setEditing(row); setOpen(true); }}>
        <Pencil className="w-4 h-4" />
      </Button>
      <Button size="icon" variant="ghost" className="text-red-400"
        onClick={() => { if (confirm("Supprimer ce projet ?")) del.mutate(row.id); }}>
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );

  if (isError) {
    return (
      <div className="space-y-4">
        <ErrorState
          title="Impossible de charger les données"
          message={error?.message || "Erreur de connexion au serveur backend. Vérifiez que le service jsinnovia-agent est disponible."}
          onRetry={refetch}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Projets" subtitle={`${Array.isArray(projets) ? projets.length : 0} projet(s)`}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouveau projet</Button>} />
      <DataTable columns={columns} data={Array.isArray(projets) ? projets : []} loading={isLoading} actions={actions} />
      <FormModal open={open} onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier le projet" : "Nouveau projet"}
        fields={resolvedFormFields} initialData={editing
          ? { ...editing, client_id: editing.client_id || INTERNAL_PROJECT_VALUE }
          : { client_id: INTERNAL_PROJECT_VALUE, statut: "en_cours" }}
        onSubmit={(data) => save.mutate(data)} loading={save.isPending} />
    </div>
  );
}
