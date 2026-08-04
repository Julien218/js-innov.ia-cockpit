import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
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
  { name: "numero",        label: "N° Devis",        type: "text",   required: true },
  { name: "client_nom",    label: "Client",          type: "text",   required: true },
  { name: "client_email",  label: "Email client",    type: "email" },
  { name: "objet",         label: "Objet",            type: "text" },
  { name: "montant_ht",    label: "Montant HT (€)",   type: "number" },
  { name: "tva",           label: "TVA (%)",         type: "number", placeholder: "21" },
  { name: "statut",        label: "Statut",           type: "select",
    options: ["brouillon","envoye","accepte","refuse","expire"] },
  { name: "date_emission", label: "Date émission",   type: "date" },
  { name: "date_validite", label: "Valide jusqu'au", type: "date" },
  { name: "notes",         label: "Notes",            type: "textarea" },
];

const columns = [
  { key: "numero",        label: "N° Devis" },
  { key: "client_nom",    label: "Client" },
  { key: "objet",         label: "Objet" },
  { key: "montant_ttc",   label: "Total TTC", render: v => v ? formatCurrency(v) : "—" },
  { key: "statut",        label: "Statut",    render: v => <StatusBadge status={v} /> },
  { key: "date_validite", label: "Validité",  render: v => v ? new Date(v).toLocaleDateString("fr-BE") : "—" },
];

export default function Devis() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(null);
  const [sendLoading, setSendLoading] = useState(null);
  const [sendMsg, setSendMsg] = useState(null);

  const { data: devis = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["Devis"],
    queryFn: () => base44.entities.Devis.list("-created_at"),
  });

  const safeDevis = Array.isArray(devis) ? devis : [];

  const save = useMutation({
    mutationFn: (data) => {
      const payload = normalizeBillingPayload(data);
      // Auto-générer le numéro si vide
      if (!payload.numero) {
        payload.numero = generateDocumentNumber("DEV", safeDevis);
      }
      return editing
        ? base44.entities.Devis.update(editing.id, payload)
        : base44.entities.Devis.create(payload);
    },
    onSuccess: () => { qc.invalidateQueries(["Devis"]); setOpen(false); setEditing(null); },
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.Devis.delete(id),
    onSuccess: () => qc.invalidateQueries(["Devis"]),
  });

  // ── Télécharger PDF (route relative cockpit) ──
  const handlePDF = async (row) => {
    setPdfLoading(row.id);
    try {
      const res = await fetch(`/api/billing/devis/${row.id}/pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${row.numero || "devis"}.pdf`;
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

  // ── Envoyer par email (route relative cockpit) ──
  const handleSend = async (row) => {
    const to = row.client_email;
    if (!to) {
      setSendMsg({ type: "error", text: `Email client manquant pour ${row.client_nom || "ce devis"}.` });
      setTimeout(() => setSendMsg(null), 4000);
      return;
    }
    if (!confirm(`Envoyer le devis ${row.numero} à ${to} ?`)) return;

    setSendLoading(row.id);
    try {
      const res = await fetch(`/api/billing/devis/${row.id}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSendMsg({ type: "success", text: `Devis envoyé à ${data.sentTo || to}` });
      qc.invalidateQueries(["Devis"]);
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
        onClick={() => { if (confirm("Supprimer ce devis ?")) del.mutate(row.id); }}>
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );

  if (isError) {
    return (
      <div className="space-y-4">
        <ErrorState
          title="Impossible de charger les devis"
          message={error?.message || "Erreur de connexion au serveur backend."}
          onRetry={refetch}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Devis" subtitle={`${safeDevis.length} devis`}
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}>+ Nouveau devis</Button>} />

      {sendMsg && (
        <div className={`p-3 rounded-lg text-sm ${
          sendMsg.type === "success" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
        }`}>
          {sendMsg.text}
        </div>
      )}

      <DataTable columns={columns} data={safeDevis} loading={isLoading} actions={actions} />

      <FormModal
        open={open}
        onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier le devis" : "Nouveau devis"}
        fields={formFields}
        initialData={editing}
        onSubmit={(data) => save.mutate(data)}
        loading={save.isPending}
      />
    </div>
  );
}
