import React from "react";
import { CheckCircle2, ChevronDown, KeyRound, Loader2, MailPlus, Save, Shield, Users } from "lucide-react";
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
  const [form, setForm] = React.useState({ email: "", fullName: "", organisation: "", role: "client", permissions: ["dashboard"] });
  const [busy, setBusy] = React.useState(false);
  const [roleBusy, setRoleBusy] = React.useState("");
  const [permissionBusy, setPermissionBusy] = React.useState("");
  const [openAccess, setOpenAccess] = React.useState("");
  const [catalog, setCatalog] = React.useState([]);
  const [users, setUsers] = React.useState([]);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState("");

  const loadUsers = React.useCallback(async () => {
    if (!isSuperAdmin) return;
    try {
      const body = await fetch("/api/user-access", { credentials: "same-origin" }).then(readJson);
      setUsers(body.users || []);
      setCatalog(body.catalog || []);
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
      setForm({ email: "", fullName: "", organisation: "", role: "client", permissions: ["dashboard"] });
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

  const allowedCatalog = role => catalog.filter(item => item.roles.includes(role) && item.code !== "user_access");
  const groupedCatalog = role => Object.entries(allowedCatalog(role).reduce((groups, item) => {
    (groups[item.group] ||= []).push(item);
    return groups;
  }, {}));
  const toggleFormPermission = code => code === "dashboard" ? undefined : setForm(current => ({
    ...current,
    permissions: current.permissions.includes(code) ? current.permissions.filter(item => item !== code) : [...current.permissions, code],
  }));
  const toggleUserPermission = (userId, code) => code === "dashboard" ? undefined : setUsers(current => current.map(account => account.id !== userId ? account : ({
    ...account,
    permissions: (account.permissions || []).includes(code) ? account.permissions.filter(item => item !== code) : [...(account.permissions || []), code],
  })));

  const updatePermissions = async account => {
    setPermissionBusy(account.id); setError(""); setResult(null);
    try {
      const body = await fetch(`/api/user-access/${account.id}/permissions`, {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permissions: account.permissions || [] }),
      }).then(readJson);
      setUsers(current => current.map(item => item.id === account.id ? { ...item, permissions: body.permissions || [] } : item));
      setResult({ status: "permissions_updated" });
    } catch (updateError) { setError(updateError.message); }
    finally { setPermissionBusy(""); }
  };

  if (!canInvite) return <div className="rounded-2xl border p-6 text-sm text-muted-foreground">Cette page est réservée aux administrateurs.</div>;

  return <div className="mx-auto max-w-4xl space-y-6">
    <div><h1 className="flex items-center gap-2 text-2xl font-bold"><Shield className="h-6 w-6 text-[#D4AF37]" />Utilisateurs et accès</h1><p className="mt-1 text-sm text-muted-foreground">Invitez un client ou un membre de l’équipe avec uniquement les droits nécessaires.</p></div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {result && <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">{result.status === "invited" ? "Invitation envoyée" : result.status === "pending" ? "Une invitation valide existe déjà" : result.status === "role_updated" ? "Rôle mis à jour" : result.status === "permissions_updated" ? "Accès mis à jour" : "Ce compte est déjà actif"}</p><p>Les droits sont appliqués immédiatement côté serveur.</p></div></div>}

    {isSuperAdmin ? <form onSubmit={submit} className="rounded-2xl border bg-card p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1"><span className="text-sm font-medium">Nom du contact</span><input required value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} className="h-11 w-full rounded-xl border px-3" placeholder="Prénom et nom" /></label>
        <label className="space-y-1"><span className="text-sm font-medium">E-mail</span><input required type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} className="h-11 w-full rounded-xl border px-3" placeholder="client@entreprise.be" /></label>
        <label className="space-y-1 md:col-span-2"><span className="text-sm font-medium">Entreprise / organisation</span><input required value={form.organisation} onChange={event => setForm({ ...form, organisation: event.target.value })} className="h-11 w-full rounded-xl border px-3" placeholder="Nom facturable" /></label>
        <label className="space-y-1 md:col-span-2"><span className="text-sm font-medium">Rôle maximum</span><select value={form.role} onChange={event => setForm(current => ({ ...current, role: event.target.value, permissions: ["dashboard", ...current.permissions.filter(code => code !== "dashboard" && allowedCatalog(event.target.value).some(item => item.code === code))] }))} className="h-11 w-full rounded-xl border px-3">{ROLE_OPTIONS.filter(option => option.value !== "superadmin").map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><p className="text-xs text-muted-foreground">Le rôle fixe un plafond. Seules les cases cochées ci-dessous seront réellement accessibles.</p></label>
      </div>
      <div className="mt-5 space-y-4 rounded-xl border bg-muted/20 p-4">
        <div><p className="font-medium">Modules autorisés</p><p className="text-xs text-muted-foreground">Aucun module sensible n’est accordé automatiquement.</p></div>
        {groupedCatalog(form.role).map(([group, items]) => <div key={group}><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p><div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">{items.map(item => <label key={item.code} className="flex cursor-pointer items-center gap-2 rounded-lg border bg-background p-3 text-sm"><input type="checkbox" disabled={item.code === "dashboard"} checked={form.permissions.includes(item.code)} onChange={() => toggleFormPermission(item.code)} className="h-4 w-4 accent-[#D4AF37]" /><span>{item.label}{item.code === "dashboard" ? " (obligatoire)" : ""}</span></label>)}</div></div>)}
      </div>
      <Button className="mt-5" disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailPlus className="mr-2 h-4 w-4" />}Envoyer l’invitation</Button>
    </form> : <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">Seul le Super administrateur crée les comptes de l’équipe et attribue les rôles.</div>}

    {isSuperAdmin && <section className="rounded-2xl border bg-card p-6">
      <div className="flex items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><Users className="h-5 w-5" />Comptes existants</h2><p className="mt-1 text-sm text-muted-foreground">Les nouveaux droits sont appliqués dès la prochaine requête.</p></div><Button variant="outline" onClick={loadUsers}>Actualiser</Button></div>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Utilisateur</th><th className="py-2 pr-3">Organisation</th><th className="py-2 pr-3">Statut</th><th className="py-2 pr-3">Rôle maximum</th><th className="py-2 text-right">Actions</th></tr></thead>
        <tbody>{users.map(account => { const ownAccount = account.id === user?.id; const accessOpen = openAccess === account.id; return <React.Fragment key={account.id}>
          <tr className="border-b"><td className="py-3 pr-3"><p className="font-medium">{account.full_name || account.email}</p><p className="text-xs text-muted-foreground">{account.email}</p></td><td className="py-3 pr-3">{account.organisation || "—"}</td><td className="py-3 pr-3"><span className={`rounded-full px-2 py-1 text-xs ${account.is_active ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{account.is_active ? "Actif" : "Invitation"}</span></td><td className="py-3 pr-3"><select value={account.role} disabled={ownAccount || roleBusy === account.id} onChange={event => setUsers(current => current.map(item => item.id === account.id ? { ...item, role: event.target.value, permissions: (item.permissions || []).filter(code => allowedCatalog(event.target.value).some(module => module.code === code)) } : item))} className="h-9 rounded-lg border px-2">{ROLE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td><td className="py-3 text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={ownAccount || roleBusy === account.id} onClick={() => updateRole(account)}>{roleBusy === account.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" />Rôle</>}</Button><Button size="sm" variant="outline" disabled={ownAccount} onClick={() => setOpenAccess(accessOpen ? "" : account.id)}><KeyRound className="mr-2 h-4 w-4" />{ownAccount ? "Tous les accès" : `${account.permissions?.length || 0} accès`}<ChevronDown className={`ml-2 h-4 w-4 transition-transform ${accessOpen ? "rotate-180" : ""}`} /></Button></div></td></tr>
          {accessOpen && !ownAccount && <tr className="border-b bg-muted/20"><td colSpan={5} className="p-4"><div className="space-y-4"><div><p className="font-semibold">Accès de {account.full_name || account.email}</p><p className="text-xs text-muted-foreground">Une case non cochée masque le module et bloque aussi ses API.</p></div>{groupedCatalog(account.role).map(([group, items]) => <div key={group}><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p><div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">{items.map(item => <label key={item.code} className="flex cursor-pointer items-center gap-2 rounded-lg border bg-background p-3"><input type="checkbox" disabled={item.code === "dashboard"} checked={(account.permissions || []).includes(item.code)} onChange={() => toggleUserPermission(account.id, item.code)} className="h-4 w-4 accent-[#D4AF37]" /><span>{item.label}{item.code === "dashboard" ? " (obligatoire)" : ""}</span></label>)}</div></div>)}<div className="flex justify-end"><Button disabled={permissionBusy === account.id} onClick={() => updatePermissions(account)}>{permissionBusy === account.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Enregistrer les accès</Button></div></div></td></tr>}
        </React.Fragment>; })}</tbody>
      </table></div>
    </section>}
  </div>;
}
