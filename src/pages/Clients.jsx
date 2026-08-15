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

const formFields = [
  { name: "nom",                   label: "Nom du contact",                 type: "text", required: true },
  { name: "prenom",                label: "Prénom du contact",              type: "text" },
  { name: "email",                 label: "Email principal",                type: "email", required: true },
  { name: "telephone",             label: "Téléphone",                      type: "text" },
  { name: "type_client",           label: "Type de client",                 type: "select",
    options: ["particulier", "professionnel", "entreprise", "asbl"] },
  { name: "entreprise",            label: "Nom commercial",                 type: "text" },
  { name: "denomination_legale",   label: "Dénomination légale exacte",     type: "text" },
  { name: "numero_entreprise",     label: "N° d’entreprise",                type: "text" },
  { name: "numero_tva",            label: "N° de TVA",                      type: "text" },
  { name: "adresse",               label: "Adresse officielle",             type: "text" },
  { name: "code_postal",           label: "Code postal",                    type: "text" },
  { name: "ville",                 label: "Ville",                          type: "text" },
  { name: "pays",                  label: "Pays",                           type: "text" },
  { name: "email_facturation",     label: "Email de facturation",           type: "email" },
  { name: "facturation_statut",    label: "Vérification facturation",       type: "select",
    options: [
      { value: "a_verifier", label: "À vérifier" },
      { value: "informations_demandees", label: "Informations demandées" },
      { value: "verifie", label: "Vérifié — données officielles confirmées" },
    ] },
  { name: "statut",                label: "Statut client",                  type: "select",
    options: ["actif", "inactif", "prospect", "archive"] },
  { name: "notes",                 label: "Notes",                          type: "textarea" },
];

const columns = [
  { key: "nom",        label: "Nom",         render: (v, row) => `${v || ""} ${row.prenom || ""}`.trim() },
  { key: "email",      label: "Email" },
  { key: "entreprise", label: "Entreprise" },
  { key: "numero_tva", label: "N° TVA", render: v => v || <span className="text-amber-400">Manquant</span> },
  { key: "facturation_statut", label: "Données légales", render: v =>
    v === "verifie"
      ? <span className="text-emerald-400">Vérifiées</span>
      : <span className="text-amber-400">{v === "informations_demandees" ? "Demandées" : "À vérifier"}</span> },
  { key: "ville",      label: "Ville" },
  { key: "statut",     label: "Statut",  render: v => <StatusBadge status={v} /> },
  { key: "created_at", label: "Créé le", render: v => v ? new Date(v).toLocaleDateString("fr-BE") : "—" },
];

export default function Clients() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: clients = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["Client"],
    queryFn: () => base44.entities.Client.list("-created_at"),
  });

  const save = useMutation({
    mutationFn: (data) => {
      const editableFields = new Set(formFields.map((field) => field.name));
      const payload = Object.fromEntries(
        Object.entries(data || {}).filter(([key]) => editableFields.has(key))
      );
      if (payload.facturation_statut === "verifie") {
        payload.facturation_verifiee_at = new Date().toISOString();
        payload.facturation_source = "validation-cockpit";
      }
      return editing
        ? base44.entities.Client.update(editing.id, payload)
        : base44.entities.Client.create(payload);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["Client"] });
      setOpen(false);
      setEditing(null);
    },
    onError: (saveError) => {
      alert("Erreur d’enregistrement : " + (saveError?.message || "Erreur inconnue"));
    },
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.Client.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["Client"] }),
  });

  const actions = (row) => (
    <div className="flex gap-2">
      <Button size="icon" variant="ghost" onClick={() => { setEditing(row); setOpen(true); }}>
        <Pencil className="w-4 h-4" />
      </Button>
      <Button size="icon" variant="ghost" className="text-red-400"
        onClick={() => { if (confirm("Supprimer ce client ?")) del.mutate(row.id); }}>
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
      <PageHeader title="Clients" subtitle={`${Array.isArray(clients) ? clients.length : 0} client(s)`}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouveau client</Button>} />
      <DataTable columns={columns} data={Array.isArray(clients) ? clients : []} loading={isLoading} actions={actions} />
      <FormModal open={open} onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier le client" : "Nouveau client"}
        fields={formFields} initialData={editing}
        onSubmit={(data) => save.mutate(data)} loading={save.isPending} />
    </div>
  );
}
