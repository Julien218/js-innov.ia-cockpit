import React from "react";
import { CheckCircle2, Loader2, MailPlus, Save, Shield, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/lib/usePermissions";
import { useAuth } from "@/lib/AuthContext";

const ROLE_OPTIONS = [
  { value: "client", label: "Client" },
  { value: "collaborateur", label: "Commercial" },
  { value: "admin", label: "Administrateur" },
  { value: "superadmin", label: "Super administrateur" },
];

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Action impossible");
  return body;
}

export default function Invitations() {
  const { canInvite, isSuperAdmin } = usePermissions();
  const { user } = useAuth();
  const [form, setForm] = React.useState({ email: "", fullName: "", organisation: "", role: "client" });
  const [busy, setBusy] = React.useState(false);
  const [roleBusy, setRoleBusy] = React.useState("");
  const [users, setUsers] = React.useState([]);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState("");

  const loadUsers = React.useCallback(async () => {
    if (!isSuperAdmin) return;
    try {
      const body = await fetch("/api/user-access", { credentials: "same-origin" }).then(readJson);
      setUsers(body.users || []);
    } catch (loadError) { setError(loadError.message); }
  }, [isSuperAdmin]);

  React.useEffect(() => { loadUsers(); }, [loadUsers]);

  const submit = async event => {
    event.preventDefault();
    setBusy(true); setError(""); setResult(null);
    try {
      const body = await fetch("/api/user-access/invite", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      }).then(readJson);
      setResult(body);
      setForm({ email: "", fullName: "", organisation: "", role: "client" });
      await loadUsers();
    } catch (inviteError) { setError(inviteError.message); }
    finally { setBusy(false); }
  };

  const updateRole = async account => {
    setRoleBusy(account.id); setError(""); setResult(null);
    try {
      await fetch(`/api/user-access/${account.id}`, {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: account.role }),
      }).then(readJson);
      setResult({ status: "role_updated" });
      await loadUsers();
    } catch (updateError) { setError(updateError.message); }
    finally { setRoleBusy(""); }
  };

  if (!canInvite) return <div className="rounded-2xl border p-6 text-sm text-muted-foreground">Cette page est réservée aux administrateurs.</div>;

  return <div className="mx-auto max-w-4xl space-y-6">
    <div><h1 className="flex items-center gap-2 text-2xl font-bold"><Shield className="h-6 w-6 text-[#D4AF37]" />Utilisateurs et accès</h1><p className="mt-1 text-sm text-muted-foreground">Invitez un client ou un membre de l’équipe avec uniquement les droits nécessaires.</p></div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {result && <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">{result.status === "invited" ? "Invitation envoyée" : result.status === "pending" ? "Une invitation valide existe déjà" : result.status === "role_updated" ? "Rôle mis à jour" : "Ce compte est déjà actif"}</p><p>Le lien d’activation est personnel et valable 7 jours.</p></div></div>}

    {isSuperAdmin ? <form onSubmit={submit} className="rounded-2xl border bg-card p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1"><span className="text-sm font-medium">Nom du contact</span><input required value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} className="h-11 w-full rounded-xl border px-3" placeholder="Prénom et nom" /></label>
        <label className="space-y-1"><span className="text-sm font-medium">E-mail</span><input required type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} className="h-11 w-full rounded-xl border px-3" placeholder="client@entreprise.be" /></label>
        <label className="space-y-1 md:col-span-2"><span className="text-sm font-medium">Entreprise / organisation</span><input required value={form.organisation} onChange={event => setForm({ ...form, organisation: event.target.value })} className="h-11 w-full rounded-xl border px-3" placeholder="Nom facturable" /></label>
        <label className="space-y-1 md:col-span-2"><span className="text-sm font-medium">Niveau d’accès</span><select value={form.role} onChange={event => setForm({ ...form, role: event.target.value })} className="h-11 w-full rounded-xl border px-3">{ROLE_OPTIONS.filter(option => option.value !== "superadmin").map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><p className="text-xs text-muted-foreground">Commercial : CRM, projets, demandes et devis. Administrateur : gestion opérationnelle complète. Client : uniquement son espace.</p></label>
      </div>
      <Button className="mt-5" disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailPlus className="mr-2 h-4 w-4" />}Envoyer l’invitation</Button>
    </form> : <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">Seul le Super administrateur crée les comptes de l’équipe et attribue les rôles.</div>}

    {isSuperAdmin && <section className="rounded-2xl border bg-card p-6">
      <div className="flex items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><Users className="h-5 w-5" />Comptes existants</h2><p className="mt-1 text-sm text-muted-foreground">Les nouveaux droits sont appliqués dès la prochaine requête.</p></div><Button variant="outline" onClick={loadUsers}>Actualiser</Button></div>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Utilisateur</th><th className="py-2 pr-3">Organisation</th><th className="py-2 pr-3">Statut</th><th className="py-2 pr-3">Rôle</th><th className="py-2 text-right">Action</th></tr></thead>
        <tbody>{users.map(account => { const ownAccount = account.id === user?.id; return <tr key={account.id} className="border-b last:border-0"><td className="py-3 pr-3"><p className="font-medium">{account.full_name || account.email}</p><p className="text-xs text-muted-foreground">{account.email}</p></td><td className="py-3 pr-3">{account.organisation || "—"}</td><td className="py-3 pr-3"><span className={`rounded-full px-2 py-1 text-xs ${account.is_active ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{account.is_active ? "Actif" : "Invitation"}</span></td><td className="py-3 pr-3"><select value={account.role} disabled={ownAccount || roleBusy === account.id} onChange={event => setUsers(current => current.map(item => item.id === account.id ? { ...item, role: event.target.value } : item))} className="h-9 rounded-lg border px-2">{ROLE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td><td className="py-3 text-right"><Button size="sm" variant="outline" disabled={ownAccount || roleBusy === account.id} onClick={() => updateRole(account)}>{roleBusy === account.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" />Enregistrer</>}</Button></td></tr>; })}</tbody>
      </table></div>
    </section>}
  </div>;
}
