import React from "react";
import { CheckCircle2, Loader2, MailPlus, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/lib/usePermissions";

export default function Invitations() {
  const { canInvite } = usePermissions();
  const [form, setForm] = React.useState({ email: "", fullName: "", organisation: "" });
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState("");

  const submit = async event => {
    event.preventDefault();
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/client-signage/invitations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Invitation impossible");
      setResult(body);
      setForm({ email: "", fullName: "", organisation: "" });
    } catch (inviteError) {
      setError(inviteError.message);
    } finally {
      setBusy(false);
    }
  };

  if (!canInvite) return <div className="rounded-2xl border p-6 text-sm text-muted-foreground">Cette page est réservée aux administrateurs.</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Shield className="h-6 w-6 text-[#D4AF37]" />Inviter un client</h1>
        <p className="mt-1 text-sm text-muted-foreground">Le client reçoit un lien personnel valable 7 jours pour activer son espace Signage.</p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {result && <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">{result.status === "invited" ? "Invitation envoyée" : result.status === "pending" ? "Une invitation valide existe déjà" : "Le client possède déjà un compte actif"}</p><p>Aucun mot de passe ni jeton secret n’est affiché dans le Cockpit.</p></div></div>}

      <form onSubmit={submit} className="rounded-2xl border bg-card p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1"><span className="text-sm font-medium">Nom du contact</span><input required value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} className="h-11 w-full rounded-xl border px-3" placeholder="Prénom et nom" /></label>
          <label className="space-y-1"><span className="text-sm font-medium">E-mail</span><input required type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} className="h-11 w-full rounded-xl border px-3" placeholder="client@entreprise.be" /></label>
          <label className="space-y-1 md:col-span-2"><span className="text-sm font-medium">Entreprise / organisation</span><input required value={form.organisation} onChange={event => setForm({ ...form, organisation: event.target.value })} className="h-11 w-full rounded-xl border px-3" placeholder="Nom facturable du client" /></label>
        </div>
        <Button className="mt-5" disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailPlus className="mr-2 h-4 w-4" />}Envoyer l’invitation</Button>
      </form>
    </div>
  );
}
