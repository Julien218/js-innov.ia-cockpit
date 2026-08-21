import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import ErrorState from "@/components/shared/ErrorState";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Bot, ChevronRight, KeyRound, Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

async function fetchJson(url, options) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  return data;
}

function secretSegment(value) {
  return String(value || "NON_NOMME").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function generatedSecretRef(provider, client, project) {
  return `${secretSegment(provider)}_API_KEY_${secretSegment(client.entreprise || client.nom)}_${secretSegment(project.nom)}`;
}

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
  const [selectedClient, setSelectedClient] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [assignmentError, setAssignmentError] = useState("");
  const [assignment, setAssignment] = useState({ provider: "openai", status: "a_creer", monthly_budget_usd: "", hard_limit_usd: "" });

  const { data: clients = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["Client"],
    queryFn: () => base44.entities.Client.list("-created_at"),
  });

  const { data: projets = [] } = useQuery({
    queryKey: ["Projet"],
    queryFn: () => base44.entities.Projet.list("-created_at"),
  });

  const attributionsQuery = useQuery({
    queryKey: ["ai-key-attributions", selectedClient?.id],
    queryFn: () => fetchJson(`/api/ai-cost/attributions?client_id=${encodeURIComponent(selectedClient.id)}`),
    enabled: Boolean(selectedClient?.id),
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

  const saveAssignment = useMutation({
    mutationFn: () => fetchJson("/api/ai-cost/attributions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: selectedClient.id,
        project_id: assigning.id,
        client_name: selectedClient.entreprise || `${selectedClient.nom || ""} ${selectedClient.prenom || ""}`.trim(),
        project_name: assigning.nom,
        ...assignment,
        secret_ref: generatedSecretRef(assignment.provider, selectedClient, assigning),
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-key-attributions", selectedClient?.id] });
      setAssigning(null);
      setAssignmentError("");
    },
    onError: (mutationError) => setAssignmentError(mutationError.message),
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
      <Button size="sm" variant="outline" onClick={() => setSelectedClient(row)}>
        Projets <ChevronRight className="w-4 h-4 ml-1" />
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
      {selectedClient && (
        <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-lg">Projets de {selectedClient.entreprise || selectedClient.nom}</h2>
              <p className="text-sm text-muted-foreground">Attributions IA et suivi des coûts par projet.</p>
            </div>
            <Button variant="ghost" onClick={() => setSelectedClient(null)}>Fermer</Button>
          </div>
          <div className="grid gap-3">
            {(Array.isArray(projets) ? projets : []).filter((project) =>
              project.client_id === selectedClient.id || (!project.client_id && project.client_nom &&
                [selectedClient.entreprise, selectedClient.nom].filter(Boolean).some((name) => name.toLowerCase() === project.client_nom.toLowerCase()))
            ).map((project) => {
              const projectAssignments = (attributionsQuery.data?.items || []).filter((item) => item.project_id === project.id);
              return (
                <div key={project.id} className="rounded-xl border border-border p-4">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div><p className="font-medium">{project.nom}</p><p className="text-xs text-muted-foreground">{project.statut || "Sans statut"}</p></div>
                    <Button size="sm" onClick={() => { setAssigning(project); setAssignmentError(""); }}><KeyRound className="w-4 h-4 mr-2" />Attribuer une clé IA</Button>
                  </div>
                  {projectAssignments.map((item) => (
                    <div key={item.id} className="mt-3 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 rounded-lg bg-muted/40 p-3 text-sm">
                      <div className="col-span-2"><span className="text-xs text-muted-foreground block">Référence du secret</span><code className="text-xs break-all">{item.secret_ref}</code></div>
                      <div><span className="text-xs text-muted-foreground block">Statut</span><StatusBadge status={item.status} /></div>
                      <div><span className="text-xs text-muted-foreground block">Budget</span>{Number(item.monthly_budget_usd || 0).toFixed(2)} USD</div>
                      <div><span className="text-xs text-muted-foreground block">Consommation</span>{Number(item.consumption_usd || 0).toFixed(3)} USD</div>
                      <div><span className="text-xs text-muted-foreground block">Dernier usage</span>{item.last_usage_at ? new Date(item.last_usage_at).toLocaleString("fr-BE") : "Jamais"}</div>
                      <div><span className="text-xs text-muted-foreground block">Alertes</span>{item.blocked ? <span className="text-red-600 flex gap-1"><AlertTriangle className="w-4 h-4" />Plafond</span> : item.alerts?.length ? `${Math.max(...item.alerts)} % atteint` : "Aucune"}</div>
                    </div>
                  ))}
                  {!attributionsQuery.isLoading && projectAssignments.length === 0 && <p className="mt-3 text-xs text-muted-foreground flex items-center gap-2"><Bot className="w-4 h-4" />Aucune attribution IA.</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}
      <FormModal open={open} onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier le client" : "Nouveau client"}
        fields={formFields} initialData={editing}
        onSubmit={(data) => save.mutate(data)} loading={save.isPending} />
      <Dialog open={Boolean(assigning)} onOpenChange={(openDialog) => !openDialog && setAssigning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attribuer une clé IA</DialogTitle>
            <DialogDescription>Le Cockpit enregistre uniquement le nom de la variable secrète, jamais sa valeur.</DialogDescription>
          </DialogHeader>
          {assigning && <div className="space-y-4">
            <div className="space-y-2"><Label>Fournisseur</Label><Select value={assignment.provider} onValueChange={(provider) => setAssignment({ ...assignment, provider })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="openai">OpenAI</SelectItem><SelectItem value="xai">xAI</SelectItem><SelectItem value="anthropic">Anthropic</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Nom généré</Label><Input readOnly value={generatedSecretRef(assignment.provider, selectedClient, assigning)} className="font-mono text-xs" /><p className="text-xs text-muted-foreground">Créez cette variable dans Railway, puis passez son statut à « Configurée ».</p></div>
            <div className="space-y-2"><Label>Statut</Label><Select value={assignment.status} onValueChange={(status) => setAssignment({ ...assignment, status })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="a_creer">À créer</SelectItem><SelectItem value="configuree">Configurée</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="erreur">Erreur</SelectItem></SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Budget mensuel (USD)</Label><Input type="number" min="0" step="0.01" value={assignment.monthly_budget_usd} onChange={(event) => setAssignment({ ...assignment, monthly_budget_usd: event.target.value })} /></div><div className="space-y-2"><Label>Plafond (USD)</Label><Input type="number" min="0" step="0.01" value={assignment.hard_limit_usd} onChange={(event) => setAssignment({ ...assignment, hard_limit_usd: event.target.value })} /></div></div>
            {assignmentError && <p className="text-sm text-red-600">{assignmentError}</p>}
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setAssigning(null)}>Annuler</Button><Button onClick={() => saveAssignment.mutate()} disabled={saveAssignment.isPending}>{saveAssignment.isPending ? "Enregistrement…" : "Créer l’attribution"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
