import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import ErrorState from "@/components/shared/ErrorState";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, FileText, Send, RefreshCw, CheckCircle2 } from "lucide-react";
import { formatCurrency, normalizeBillingPayload, generateDocumentNumber } from "@/lib/billing";

const formFields = [
  { name: "numero", label: "N° Facture", type: "text", required: true },
  { name: "client_id", label: "Client du Cockpit", type: "select", required: true, options: [] },
  { name: "objet", label: "Objet", type: "text", required: true },
  { name: "montant_ht", label: "Montant HT (€)", type: "number" },
  { name: "tva", label: "TVA (%)", type: "number", placeholder: "21" },
  { name: "statut", label: "Statut", type: "select", options: ["brouillon", "envoyee", "payee", "en_retard", "annulee"] },
  { name: "date_emission", label: "Date émission", type: "date" },
  { name: "date_echeance", label: "Date échéance", type: "date" },
  { name: "notes", label: "Notes", type: "textarea" },
];

const formatTrackingDate = value => value
  ? new Date(value).toLocaleString("fr-BE", { dateStyle: "short", timeStyle: "short" })
  : "—";

const reviewLabel = row => {
  if (!row.auto_generation) return <span className="text-slate-400">Manuelle</span>;
  const blockers = Array.isArray(row.billing_blockers) ? row.billing_blockers.length : 0;
  if (row.billing_review_status === "blocked" || blockers > 0) {
    return <span className="font-medium text-red-400">Bloquée · {blockers} anomalie(s)</span>;
  }
  if (row.billing_review_status === "pending") return <span className="font-medium text-amber-400">À vérifier</span>;
  if (row.billing_review_status === "approved") return <span className="font-medium text-sky-400">Envoi en cours</span>;
  if (row.billing_review_status === "send_failed") return <span className="font-medium text-red-400">Envoi à relancer</span>;
  if (row.billing_review_status === "sent") return <span className="font-medium text-emerald-400">Validée & envoyée</span>;
  return <span className="text-slate-400">Automatique</span>;
};

async function handleComplianceError(data) {
  if (data?.code !== "CLIENT_INFORMATION_INCOMPLETE" || !data?.canRequestByEmail || !data?.clientId) return false;
  const missing = Array.isArray(data.missingLabels) ? data.missingLabels.join(", ") : "informations légales";
  const approved = confirm(`Facturation bloquée : ${missing}.\n\nEnvoyer une demande à ${data.clientEmail} ?`);
  if (!approved) return false;
  const response = await fetch(`/api/billing/clients/${data.clientId}/request-information`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`);
  alert(`Demande d’informations envoyée à ${result.sentTo}. La facture reste bloquée jusqu’à validation des données.`);
  return true;
}

const columns = [
  { key: "numero", label: "N° Facture" },
  { key: "client_nom", label: "Client" },
  { key: "montant_ttc", label: "Total TTC", render: v => v != null ? formatCurrency(v) : "—" },
  { key: "statut", label: "Statut", render: v => <StatusBadge status={v} /> },
  { key: "billing_review_status", label: "Contrôle mensuel", render: (_v, row) => reviewLabel(row) },
  { key: "date_echeance", label: "Échéance", render: v => v ? new Date(v).toLocaleDateString("fr-BE") : "—" },
  { key: "pdf_genere_at", label: "PDF archivé", render: (v, row) => {
    if (v && row.pdf_conformite_statut === "incomplet") {
      return <span className="text-red-400" title="Ancienne version conservée pour audit">Non conforme — données légales à compléter</span>;
    }
    return v
      ? <span title={row.pdf_version || "Modèle officiel"}>{formatTrackingDate(v)} · {row.nombre_telechargements || 0} ouverture(s)</span>
      : <span className="text-amber-400">À ouvrir/vérifier</span>;
  } },
  { key: "date_dernier_envoi", label: "Dernier envoi", render: (v, row) => v
    ? <span>{formatTrackingDate(v)} · {row.nombre_envois || 1} envoi(s)</span>
    : "—" },
];

export default function Factures() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(null);
  const [sendLoading, setSendLoading] = useState(null);
  const [refreshLoading, setRefreshLoading] = useState(null);
  const [sendMsg, setSendMsg] = useState(null);

  const { data: factures = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["Facture"],
    queryFn: () => base44.entities.Facture.list("-created_at"),
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["Client"],
    queryFn: () => base44.entities.Client.list("entreprise"),
  });

  const safeFactures = Array.isArray(factures) ? factures : [];
  const safeClients = Array.isArray(clients) ? clients : [];
  const pendingReviewCount = safeFactures.filter(row => row.auto_generation && row.statut === "brouillon" && ["pending", "blocked", "send_failed"].includes(row.billing_review_status)).length;
  const resolvedFormFields = formFields.map((field) => field.name === "client_id"
    ? {
        ...field,
        options: safeClients.map((client) => ({
          value: client.id,
          label: client.denomination_legale || client.entreprise || [client.prenom, client.nom].filter(Boolean).join(" ") || client.email,
        })),
      }
    : field);

  const save = useMutation({
    mutationFn: (data) => {
      const editableFields = new Set(resolvedFormFields.map(field => field.name));
      const editableData = Object.fromEntries(Object.entries(data || {}).filter(([key]) => editableFields.has(key)));
      const payload = normalizeBillingPayload(editableData);
      const selectedClient = safeClients.find((client) => client.id === payload.client_id);
      if (!selectedClient) throw new Error("Sélectionnez un client existant dans le Cockpit.");
      payload.client_nom = selectedClient.denomination_legale || selectedClient.entreprise || [selectedClient.prenom, selectedClient.nom].filter(Boolean).join(" ");
      payload.client_email = selectedClient.email_facturation || selectedClient.email || "";
      if (!payload.numero) payload.numero = generateDocumentNumber("FAC", safeFactures);
      return editing
        ? base44.entities.Facture.update(editing.id, payload)
        : base44.entities.Facture.create(payload);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["Facture"] });
      setOpen(false);
      setEditing(null);
    },
    onError: (saveError) => alert("Erreur d’enregistrement : " + (saveError?.message || "Erreur inconnue")),
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.Facture.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["Facture"] }),
  });

  const handlePDF = async (row) => {
    setPdfLoading(row.id);
    try {
      const res = await fetch(`/api/billing/factures/${row.id}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (await handleComplianceError(err)) return;
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      if (!popup) {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${row.numero || "facture"}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
      await qc.invalidateQueries({ queryKey: ["Facture"] });
    } catch (err) {
      alert("Erreur ouverture PDF: " + err.message);
    } finally {
      setPdfLoading(null);
    }
  };

  const handleRefreshAuto = async (row) => {
    setRefreshLoading(row.id);
    try {
      const res = await fetch(`/api/billing/factures/${row.id}/refresh-auto-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      await qc.invalidateQueries({ queryKey: ["Facture"] });
      if (Array.isArray(data.blockers) && data.blockers.length) {
        alert(`Brouillon actualisé, mais ${data.blockers.length} anomalie(s) empêchent encore l’envoi :\n\n${data.blockers.slice(0, 6).map(item => `• ${item.message}`).join("\n")}`);
      } else {
        setSendMsg({ type: "success", text: data.changed ? `Facture ${row.numero} actualisée. Ouvre le PDF et vérifie-la avant validation.` : `Facture ${row.numero} déjà à jour.` });
      }
    } catch (err) {
      setSendMsg({ type: "error", text: "Erreur actualisation : " + err.message });
    } finally {
      setRefreshLoading(null);
      setTimeout(() => setSendMsg(null), 6000);
    }
  };

  const handleApproveAndSend = async (row) => {
    const blockers = Array.isArray(row.billing_blockers) ? row.billing_blockers : [];
    if (blockers.length) {
      alert(`Cette facture ne peut pas encore être envoyée :\n\n${blockers.slice(0, 8).map(item => `• ${item.message}`).join("\n")}`);
      return;
    }
    const to = row.client_email;
    if (!to) {
      setSendMsg({ type: "error", text: `Email client manquant pour ${row.client_nom || "cette facture"}.` });
      return;
    }
    const reviewed = confirm(
      `VALIDATION FINALE\n\nJe confirme avoir ouvert et vérifié le PDF ${row.numero}.\nMontant : ${formatCurrency(row.montant_ttc)} TTC\nDestinataire : ${to}\n\nValider et envoyer maintenant ?`
    );
    if (!reviewed) return;

    setSendLoading(row.id);
    try {
      const res = await fetch(`/api/billing/factures/${row.id}/approve-and-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        if (data.code === "BILLING_DRAFT_REFRESHED") {
          await qc.invalidateQueries({ queryKey: ["Facture"] });
          alert("Les coûts ont changé. Le brouillon vient d’être recalculé : ouvre le nouveau PDF et vérifie-le avant de valider à nouveau.");
          return;
        }
        if (data.code === "BILLING_REVIEW_BLOCKED" && Array.isArray(data.blockers)) {
          await qc.invalidateQueries({ queryKey: ["Facture"] });
          alert(`Envoi bloqué :\n\n${data.blockers.slice(0, 8).map(item => `• ${item.message}`).join("\n")}`);
          return;
        }
        if (await handleComplianceError(data)) return;
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSendMsg({ type: "success", text: `Facture ${row.numero} validée et envoyée automatiquement à ${data.sentTo || to}.` });
      await qc.invalidateQueries({ queryKey: ["Facture"] });
    } catch (err) {
      setSendMsg({ type: "error", text: "Erreur validation/envoi : " + err.message });
    } finally {
      setSendLoading(null);
      setTimeout(() => setSendMsg(null), 7000);
    }
  };

  const handleSend = async (row) => {
    if (row.auto_generation) return handleApproveAndSend(row);
    const to = row.client_email;
    if (!to) {
      setSendMsg({ type: "error", text: `Email client manquant pour ${row.client_nom || "cette facture"}.` });
      setTimeout(() => setSendMsg(null), 4000);
      return;
    }
    if (!confirm(`Envoyer la facture ${row.numero} à ${to} ?`)) return;
    setSendLoading(row.id);
    try {
      const res = await fetch(`/api/billing/factures/${row.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        if (await handleComplianceError(data)) return;
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSendMsg({ type: "success", text: `Facture envoyée à ${data.sentTo || to}` });
      await qc.invalidateQueries({ queryKey: ["Facture"] });
    } catch (err) {
      setSendMsg({ type: "error", text: "Erreur envoi: " + err.message });
    } finally {
      setSendLoading(null);
      setTimeout(() => setSendMsg(null), 5000);
    }
  };

  const actions = (row) => {
    const automatic = Boolean(row.auto_generation);
    const blockers = Array.isArray(row.billing_blockers) ? row.billing_blockers.length : 0;
    const canApprove = automatic && row.statut === "brouillon" && blockers === 0 && ["pending", "send_failed"].includes(row.billing_review_status);
    return (
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost"
          title={automatic ? "Brouillon automatique — modification manuelle bloquée" : row.pdf_document_id ? "Facture archivée — modification bloquée" : "Modifier"}
          disabled={automatic || Boolean(row.pdf_document_id)}
          onClick={() => { setEditing(row); setOpen(true); }}>
          <Pencil className="w-4 h-4" />
        </Button>
        <Button size="icon" variant="ghost"
          title={row.pdf_conformite_statut === "incomplet" ? "Compléter les données légales" : row.pdf_document_id ? "Ouvrir le PDF archivé" : "Générer, archiver et ouvrir le PDF"}
          aria-label={row.pdf_document_id ? "Ouvrir le PDF archivé" : "Générer et ouvrir le PDF"}
          disabled={pdfLoading === row.id}
          onClick={() => handlePDF(row)}>
          <FileText className={`w-4 h-4 ${pdfLoading === row.id ? "animate-pulse" : ""}`} />
        </Button>
        {automatic && row.statut === "brouillon" && (
          <Button size="icon" variant="ghost" title="Resynchroniser les coûts et actualiser le brouillon"
            disabled={refreshLoading === row.id || sendLoading === row.id}
            onClick={() => handleRefreshAuto(row)}>
            <RefreshCw className={`w-4 h-4 ${refreshLoading === row.id ? "animate-spin" : ""}`} />
          </Button>
        )}
        {automatic ? (
          <Button size="sm" variant="outline"
            title={blockers ? "Corrigez les anomalies avant validation" : "Valider le brouillon vérifié et l’envoyer immédiatement"}
            disabled={!canApprove || sendLoading === row.id || refreshLoading === row.id}
            onClick={() => handleApproveAndSend(row)}>
            <CheckCircle2 className={`w-4 h-4 mr-1 ${sendLoading === row.id ? "animate-pulse" : ""}`} />
            Valider & envoyer
          </Button>
        ) : (
          <Button size="icon" variant="ghost" title="Envoyer au client" disabled={sendLoading === row.id}
            onClick={() => handleSend(row)}>
            <Send className={`w-4 h-4 ${sendLoading === row.id ? "animate-pulse" : ""}`} />
          </Button>
        )}
        <Button size="icon" variant="ghost" className="text-red-400"
          title={automatic ? "Facture mensuelle auditable — suppression manuelle bloquée" : row.pdf_document_id ? "Facture archivée — suppression bloquée" : "Supprimer"}
          disabled={automatic || Boolean(row.pdf_document_id)}
          onClick={() => { if (confirm("Supprimer cette facture ?")) del.mutate(row.id); }}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    );
  };

  if (isError) {
    return (
      <div className="space-y-4">
        <ErrorState title="Impossible de charger les données" message={error?.message || "Erreur de connexion au serveur backend."} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Factures"
        subtitle={`${safeFactures.length} facture(s)${pendingReviewCount ? ` · ${pendingReviewCount} à vérifier` : ""}`}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouvelle facture</Button>}
      />

      {pendingReviewCount > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">
          Les factures mensuelles sont préparées automatiquement, mais aucun envoi n’est effectué sans ta validation. Ouvre le PDF, contrôle le montant et les coordonnées, puis utilise « Valider & envoyer ».
        </div>
      )}

      {sendMsg && (
        <div className={`p-3 rounded-lg text-sm ${sendMsg.type === "success" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
          {sendMsg.text}
        </div>
      )}

      <DataTable columns={columns} data={safeFactures} loading={isLoading} actions={actions} />

      <FormModal
        open={open}
        onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier la facture" : "Nouvelle facture"}
        fields={resolvedFormFields}
        initialData={editing}
        onSubmit={(data) => save.mutate(data)}
        loading={save.isPending}
      />
    </div>
  );
}
