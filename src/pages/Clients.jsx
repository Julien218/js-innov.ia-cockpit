import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import ErrorState from "@/components/shared/ErrorState";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { AlertTriangle, BellRing, Building2, Landmark, Mail, MapPin, Pencil, ShieldCheck, Trash2, Users } from "lucide-react";

const booleanOptions = [
  { value: "false", label: "Non" },
  { value: "true", label: "Oui" },
];

const ALERT_BOOLEAN_FIELDS = [
  "alert_sms_enabled",
  "alert_whatsapp_enabled",
  "alert_whatsapp_opt_in",
  "alert_site_incidents",
  "alert_screen_incidents",
];

const alertDefaults = {
  alert_sms_enabled: false,
  alert_whatsapp_enabled: false,
  alert_whatsapp_opt_in: false,
  alert_site_incidents: true,
  alert_screen_incidents: true,
};

function tenantKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function clientFormData(client) {
  const source = client || {};
  return {
    ...source,
    alert_phone: source.alert_phone || source.telephone || "",
    ...Object.fromEntries(
      ALERT_BOOLEAN_FIELDS.map((field) => [field, String(source[field] ?? alertDefaults[field])])
    ),
  };
}

const formFields = [
  { name: "nom",                   label: "Nom du contact",                 type: "text", required: true },
  { name: "prenom",                label: "Prénom du contact",              type: "text" },
  { name: "email",                 label: "Email principal",                type: "email", required: true },
  { name: "telephone",             label: "Téléphone",                      type: "text" },
  { name: "alert_phone",           label: "Contacts & alertes · Téléphone SMS / WhatsApp", type: "text", placeholder: "Reprend le téléphone principal si vide" },
  { name: "alert_sms_enabled",     label: "Contacts & alertes · SMS urgents", type: "select", options: booleanOptions },
  { name: "alert_whatsapp_enabled", label: "Contacts & alertes · WhatsApp urgent", type: "select", options: booleanOptions },
  { name: "alert_whatsapp_opt_in", label: "WhatsApp · Accord explicite du client", type: "select", options: booleanOptions },
  { name: "alert_site_incidents",  label: "Urgences · Incident site / domaine", type: "select", options: booleanOptions },
  { name: "alert_screen_incidents", label: "Urgences · Incident écran Signelya", type: "select", options: booleanOptions },
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
  { key: "alert_phone", label: "Alertes", render: (_v, row) => {
    const channels = [];
    if (row.alert_sms_enabled) channels.push("SMS");
    if (row.alert_whatsapp_enabled && row.alert_whatsapp_opt_in) channels.push("WhatsApp");
    if (row.alert_whatsapp_enabled && !row.alert_whatsapp_opt_in) channels.push("WhatsApp en attente");
    return channels.length
      ? <span className="text-cyan-300">{channels.join(" · ")}</span>
      : <span className="text-muted-foreground">Cockpit uniquement</span>;
  } },
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
  const [search, setSearch] = useState("");

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

      ALERT_BOOLEAN_FIELDS.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(payload, field)) {
          payload[field] = payload[field] === true || String(payload[field]).toLowerCase() === "true";
        }
      });

      if (!String(payload.alert_phone || "").trim() && String(payload.telephone || "").trim()) {
        payload.alert_phone = String(payload.telephone).trim();
      }
      if (!editing?.alert_tenant_key) {
        payload.alert_tenant_key = tenantKey(payload.entreprise || payload.denomination_legale || payload.nom);
      }
      payload.alert_whatsapp_opt_in_at = payload.alert_whatsapp_opt_in
        ? (editing?.alert_whatsapp_opt_in_at || new Date().toISOString())
        : null;
      payload.alert_updated_at = new Date().toISOString();

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

  const verifyBce = useMutation({
    mutationFn: async (client) => {
      const response = await fetch("/api/bce/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enterprise_number: client.numero_entreprise || client.numero_tva,
          name: client.denomination_legale || client.entreprise || client.nom,
          postal_code: client.code_postal,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || "La recherche BCE a échoué.");
        error.auditId = payload.audit_id;
        error.registrationUrl = payload.official_registration_url;
        throw error;
      }

      const official = payload.record || {};
      const editable = ["denomination_legale", "numero_entreprise", "numero_tva", "adresse", "code_postal", "ville", "pays"];
      const changes = editable
        .filter((field) => official[field] && String(official[field]).trim() !== String(client[field] || "").trim())
        .map((field) => ({ field, before: client[field] || "—", after: official[field] }));
      if (changes.length === 0) {
        return { unchanged: true, auditId: payload.audit_id };
      }

      const labels = {
        denomination_legale: "Dénomination",
        numero_entreprise: "N° entreprise",
        numero_tva: "N° TVA",
        adresse: "Adresse",
        code_postal: "Code postal",
        ville: "Ville",
        pays: "Pays",
      };
      const summary = changes.map(({ field, before, after }) => `${labels[field]} : ${before} → ${after}`).join("\n");
      const accepted = window.confirm(
        `Données reçues de la BCE officielle :\n\n${summary}\n\nAppliquer uniquement ces différences à cette fiche client ?`
      );
      if (!accepted) return { cancelled: true, auditId: payload.audit_id };

      const update = Object.fromEntries(changes.map(({ field, after }) => [field, after]));
      update.facturation_statut = "verifie";
      update.facturation_verifiee_at = payload.retrieved_at || new Date().toISOString();
      update.facturation_source = `bce-officielle:${payload.audit_id}`;
      await base44.entities.Client.update(client.id, update);
      return { updated: true, auditId: payload.audit_id, count: changes.length };
    },
    onSuccess: async (result) => {
      if (result?.updated) {
        await qc.invalidateQueries({ queryKey: ["Client"] });
        alert(`Fiche mise à jour avec ${result.count} donnée(s) BCE. Journal : ${result.auditId}`);
      } else if (result?.unchanged) {
        alert(`La fiche correspond déjà aux données BCE reçues. Journal : ${result.auditId}`);
      }
    },
    onError: (lookupError) => {
      const journal = lookupError.auditId ? `\nJournal : ${lookupError.auditId}` : "";
      const access = lookupError.registrationUrl ? "\nUn accès au service web officiel BCE doit être configuré par l’administrateur." : "";
      alert(`${lookupError.message}${journal}${access}`);
    },
  });

  const rows = Array.isArray(clients) ? clients : [];
  const verifiedCount = rows.filter((client) => client.facturation_statut === "verifie").length;
  const missingLegalCount = rows.filter((client) =>
    !client.numero_tva || !client.denomination_legale || client.facturation_statut !== "verifie"
  ).length;
  const activeCount = rows.filter((client) => client.statut === "actif").length;
  const externalAlertsCount = rows.filter((client) =>
    client.alert_sms_enabled || (client.alert_whatsapp_enabled && client.alert_whatsapp_opt_in)
  ).length;

  const filteredClients = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((client) =>
      [client.nom, client.prenom, client.email, client.entreprise, client.denomination_legale, client.numero_tva, client.ville, client.alert_phone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [rows, search]);

  const actions = (row) => (
    <div className="flex gap-2">
      <Button size="icon" variant="ghost" title="Vérifier auprès de la BCE officielle"
        disabled={verifyBce.isPending} onClick={() => verifyBce.mutate(row)}>
        <Landmark className="w-4 h-4" />
      </Button>
      <Button size="icon" variant="ghost" title="Modifier le client et ses alertes" onClick={() => { setEditing(row); setOpen(true); }}>
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
      <PageHeader title="Clients" subtitle={`${filteredClients.length} résultat(s) · ${rows.length} client(s)`}
        search={search} onSearch={setSearch}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouveau client</Button>} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="workspace-metric">
          <div className="workspace-metric-icon text-cyan-300"><Users className="h-4 w-4" /></div>
          <div><p className="workspace-metric-value">{activeCount}</p><p className="workspace-metric-label">clients actifs</p></div>
        </div>
        <div className="workspace-metric">
          <div className="workspace-metric-icon text-emerald-300"><ShieldCheck className="h-4 w-4" /></div>
          <div><p className="workspace-metric-value">{verifiedCount}</p><p className="workspace-metric-label">fiches vérifiées</p></div>
        </div>
        <div className="workspace-metric">
          <div className="workspace-metric-icon text-cyan-300"><BellRing className="h-4 w-4" /></div>
          <div><p className="workspace-metric-value">{externalAlertsCount}</p><p className="workspace-metric-label">alertes téléphone actives</p></div>
        </div>
        <div className="workspace-metric">
          <div className="workspace-metric-icon text-amber-300"><AlertTriangle className="h-4 w-4" /></div>
          <div><p className="workspace-metric-value">{missingLegalCount}</p><p className="workspace-metric-label">fiches à compléter</p></div>
        </div>
      </div>

      <div className="hidden lg:block data-surface">
        <DataTable columns={columns} data={filteredClients} loading={isLoading} actions={actions} emptyMessage="Aucun client trouvé" />
      </div>

      <div className="grid gap-3 lg:hidden">
        {isLoading ? (
          <div className="workspace-card p-5 text-sm text-muted-foreground">Chargement des clients…</div>
        ) : filteredClients.length === 0 ? (
          <div className="workspace-card p-8 text-center text-sm text-muted-foreground">Aucun client trouvé</div>
        ) : filteredClients.map((client) => {
          const alertChannels = [];
          if (client.alert_sms_enabled) alertChannels.push("SMS");
          if (client.alert_whatsapp_enabled && client.alert_whatsapp_opt_in) alertChannels.push("WhatsApp");
          if (client.alert_whatsapp_enabled && !client.alert_whatsapp_opt_in) alertChannels.push("WhatsApp en attente d’accord");
          return (
          <article key={client.id} className="workspace-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="workspace-avatar"><Building2 className="h-4 w-4" /></div>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{client.entreprise || `${client.nom || ""} ${client.prenom || ""}`.trim()}</h2>
                  {client.entreprise && <p className="truncate text-xs text-muted-foreground">{client.nom} {client.prenom}</p>}
                </div>
              </div>
              <StatusBadge status={client.statut} />
            </div>
            <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <span className="flex items-center gap-2 truncate"><Mail className="h-3.5 w-3.5 shrink-0" />{client.email || "Email manquant"}</span>
              <span className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 shrink-0" />{client.ville || "Ville manquante"}</span>
              <span className="flex items-center gap-2"><Landmark className="h-3.5 w-3.5 shrink-0" />{client.numero_tva || "TVA manquante"}</span>
              <span className="flex items-center gap-2"><BellRing className="h-3.5 w-3.5 shrink-0" />{alertChannels.length ? alertChannels.join(" · ") : "Alertes Cockpit uniquement"}</span>
              <span className={client.facturation_statut === "verifie" ? "text-emerald-300" : "text-amber-300"}>
                {client.facturation_statut === "verifie" ? "Données légales vérifiées" : "Données légales à vérifier"}
              </span>
            </div>
            <div className="mt-3 flex justify-end border-t border-border/70 pt-2">{actions(client)}</div>
          </article>
          );
        })}
      </div>
      <FormModal open={open} onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier le client" : "Nouveau client"}
        fields={formFields} initialData={clientFormData(editing)}
        onSubmit={(data) => save.mutate(data)} loading={save.isPending} />
    </div>
  );
}
