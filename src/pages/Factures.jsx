import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { AGENT_URL, AGENT_KEY } from "@/config/agent";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import ErrorState from "@/components/shared/ErrorState";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, FileText, Send } from "lucide-react";
import { formatCurrency, normalizeBillingPayload, generateDocumentNumber } from "@/lib/billing";

const formFields = [
  { name: "numero",        label: "N° Facture",      type: "text",   required: true },
  { name: "client_nom",    label: "Client",          type: "text",   required: true },
  { name: "client_email",  label: "Email client",    type: "email" },
  { name: "montant_ht",    label: "Montant HT (€)",  type: "number" },
  { name: "tva",           label: "TVA (%)",         type: "number", placeholder: "21" },
  { name: "statut",        label: "Statut",           type: "select",
    options: ["brouillon","envoyee","payee","en_retard","annulee"] },
  { name: "date_emission", label: "Date émission",   type: "date" },
  { name: "date_echeance", label: "Date échéance",   type: "date" },
  { name: "notes",         label: "Notes",            type: "textarea" },
];

const columns = [
  { key: "numero",        label: "N° Facture" },
  { key: "client_nom",    label: "Client" },
  { key: "montant_ttc",   label: "Total TTC",  render: v => v ? formatCurrency(v) : "—" },
  { key: "statut",        label: "Statut",     render: v => <StatusBadge status={v} /> },
  { key: "date_echeance", label: "Échéance",   render: v => v ? new Date(v).toLocaleDateString("fr-BE") : "—" },
];

export default function Factures() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(null);
  const [sendLoading, setSendLoading] = useState(null);
  const [sendMsg, setSendMsg] = useState(null);

  const { data: factures = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["Facture"],
    queryFn: () => base44.entities.Facture.list("-created_at"),
  });

  const safeFactures = Array.isArray(factures) ? factures : [];

  const save = useMutation({
    mutationFn: (data) => {
      const payload = normalizeBillingPayload(data);
      // Auto-générer le numéro si vide
      if (!payload.numero) {
        payload.numero = generateDocumentNumber("FAC", safeFactures);
      }
      return editing
        ? base44.entities.Facture.update(editing.id, payload)
        : base44.entities.Facture.create(payload);
    },
    onSuccess: () => { qc.invalidateQueries(["Facture"]); setOpen(false); setEditing(null); },
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.Facture.delete(id),
    onSuccess: () => qc.invalidateQueries(["Facture"]),
  });

  // ── Télécharger PDF ──
  const handlePDF = async (row) => {
    setPdfLoading(row.id);
    try {
      const res = await fetch(`${AGENT_URL}/api/billing/factures/${row.id}/pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agent-key": AGENT_KEY,
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${row.numero || "facture"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Erreur génération PDF: " + err.message);
    } finally {
      setPdfLoading(null);
    }
  };

  // ── Envoyer par email ──
  const handleSend = async (row) => {
    const to = row.client_email;
    if (!to) {
      setSendMsg({ type: "error", text: `Email client manquant pour ${row.client_nom || "cette facture"}.` });
      setTimeout(() => setSendMsg(null), 4000);
      return;
    }
    if (!confirm(`Envoyer la facture ${row.numero} à ${to} ?`)) return;

    setSendLoading(row.id);
    try {
      const res = await fetch(`${AGENT_URL}/api/billing/factures/${row.id}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agent-key": AGENT_KEY,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSendMsg({ type: "success", text: `Facture envoyée à ${data.sentTo || to}` });
      qc.invalidateQueries(["Facture"]);
    } catch (err) {
      setSendMsg({ type: "error", text: "Erreur envoi: " + err.message });
    } finally {
      setSendLoading(null);
      setTimeout(() => setSendMsg(null), 5000);
    }
  };

  const actions = (row) => (
    <div className="flex gap-1">
      <Button size="icon" variant="ghost" title="Modifier" onClick={() => { setEditing(row); setOpen(true); }}>
        <Pencil className="w-4 h-4" />
      </Button>
      <Button size="icon" variant="ghost" title="PDF" disabled={pdfLoading === row.id}
        onClick={() => handlePDF(row)}>
        <FileText className={`w-4 h-4 ${pdfLoading === row.id ? "animate-pulse" : ""}`} />
      </Button>
      <Button size="icon" variant="ghost" title="Envoyer au client" disabled={sendLoading === row.id}
        onClick={() => handleSend(row)}>
        <Send className={`w-4 h-4 ${sendLoading === row.id ? "animate-pulse" : ""}`} />
      </Button>
      <Button size="icon" variant="ghost" className="text-red-400" title="Supprimer"
        onClick={() => { if (confirm("Supprimer cette facture ?")) del.mutate(row.id); }}>
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
      <PageHeader title="Factures" subtitle={`${safeFactures.length} facture(s)`}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouvelle facture</Button>} />

      {sendMsg && (
        <div className={`p-3 rounded-lg text-sm ${
          sendMsg.type === "success" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
        }`}>
          {sendMsg.text}
        </div>
      )}

      <DataTable columns={columns} data={safeFactures} loading={isLoading} actions={actions} />

      <FormModal
        open={open}
        onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier la facture" : "Nouvelle facture"}
        fields={formFields}
        initialData={editing}
        onSubmit={(data) => save.mutate(data)}
        loading={save.isPending}
      />
    </div>
  );
}
