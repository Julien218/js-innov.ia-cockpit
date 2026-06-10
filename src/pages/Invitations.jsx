import React, { useState } from "react";
import { Mail, Plus, Copy, Trash2, Clock, CheckCircle2, AlertCircle, Shield, Users, Briefcase, User } from "lucide-react";
import { usePermissions } from "@/lib/usePermissions";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/roles";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin", desc: "Accès complet sauf config système", icon: Shield },
  { value: "collaborateur", label: "Collaborateur", desc: "Projets, tâches, demandes", icon: Briefcase },
  { value: "client", label: "Client", desc: "Portail client — ses projets/devis/factures", icon: User },
];

function generateToken() {
  return Math.random().toString(36).slice(2, 10).toUpperCase() +
    "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export default function Invitations() {
  const { isSuperAdmin, canInvite } = usePermissions();
  const [invitations, setInvitations] = useState([
    {
      id: "1", email: "demo@client.com", role: "client",
      token: "ABC12-XYZ9", status: "pending",
      createdAt: new Date(Date.now() - 86400000 * 2), expiresAt: new Date(Date.now() + 86400000 * 5),
    },
  ]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: "", role: "collaborateur", message: "" });
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(null);

  if (!canInvite) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Shield className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Accès non autorisé</p>
          <p className="text-sm text-gray-400">Seuls les admins peuvent gérer les invitations.</p>
        </div>
      </div>
    );
  }

  const handleSend = async (e) => {
    e.preventDefault();
    setSending(true);
    await new Promise(r => setTimeout(r, 800));
    const newInvite = {
      id: Date.now().toString(),
      email: form.email,
      role: form.role,
      token: generateToken(),
      status: "pending",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000 * 7),
    };
    setInvitations(p => [newInvite, ...p]);
    setForm({ email: "", role: "collaborateur", message: "" });
    setShowForm(false);
    setSending(false);
  };

  const copyLink = (token) => {
    const link = `${window.location.origin}/register?token=${token}`;
    navigator.clipboard.writeText(link);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  const revokeInvite = (id) => {
    setInvitations(p => p.filter(i => i.id !== id));
  };

  const pending = invitations.filter(i => i.status === "pending");
  const accepted = invitations.filter(i => i.status === "accepted");

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-[#D4AF37]" /> Invitations
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Invitez des collaborateurs ou clients à rejoindre le Cockpit.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{ backgroundColor: "#001a3d", color: "#D4AF37" }}
        >
          <Plus className="w-4 h-4" /> Inviter
        </button>
      </div>

      {/* Formulaire d'invitation */}
      {showForm && (
        <div className="mb-6 p-5 rounded-2xl border-2 border-[#D4AF37]/20 bg-[#001a3d]/5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Mail className="w-4 h-4 text-[#D4AF37]" /> Nouvelle invitation
          </h3>
          <form onSubmit={handleSend} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email du destinataire</label>
              <input
                type="email" required value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="collaborateur@exemple.com"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2">Rôle attribué</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {ROLE_OPTIONS.map(opt => {
                  const selected = form.role === opt.value;
                  const colors = ROLE_COLORS[opt.value];
                  return (
                    <button key={opt.value} type="button"
                      onClick={() => setForm(p => ({ ...p, role: opt.value }))}
                      className={`p-3 rounded-xl border-2 text-left transition-all ${
                        selected ? "border-current" : "border-gray-100 hover:border-gray-200"
                      }`}
                      style={selected ? { borderColor: colors.badge, backgroundColor: colors.bg + "15" } : {}}>
                      <opt.icon className="w-4 h-4 mb-1" style={{ color: selected ? colors.badge : "#9ca3af" }} />
                      <p className="text-xs font-semibold" style={{ color: selected ? colors.badge : "#374151" }}>
                        {opt.label}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Uniquement superadmin peut inviter des admins */}
            {!isSuperAdmin && form.role === "admin" && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                Seul le Super Admin peut inviter des Admins.
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Message personnalisé (optionnel)</label>
              <textarea
                value={form.message}
                onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
                placeholder="Bonjour, je vous invite à rejoindre notre espace de gestion…"
                rows={2}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30 resize-none"
              />
            </div>

            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
                Annuler
              </button>
              <button type="submit" disabled={sending || (!isSuperAdmin && form.role === "admin")}
                className="px-5 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 flex items-center gap-2"
                style={{ backgroundColor: "#001a3d", color: "#D4AF37" }}>
                {sending ? <><Clock className="w-3.5 h-3.5 animate-spin" /> Envoi…</> : <><Mail className="w-3.5 h-3.5" /> Envoyer l'invitation</>}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Liste — En attente */}
      {pending.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            En attente ({pending.length})
          </p>
          <div className="space-y-2">
            {pending.map(inv => {
              const colors = ROLE_COLORS[inv.role] || ROLE_COLORS.client;
              const link = `${window.location.origin}/register?token=${inv.token}`;
              return (
                <div key={inv.id} className="p-4 bg-white rounded-xl border border-gray-100 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm flex-shrink-0"
                      style={{ backgroundColor: colors.bg + "33", color: colors.badge }}>
                      <Mail className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">{inv.email}</p>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: colors.badge + "22", color: colors.badge }}>
                          {ROLE_LABELS[inv.role]}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" /> En attente
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5 font-mono truncate">{link}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => copyLink(inv.token)} title="Copier le lien"
                        className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-700">
                        {copied === inv.token ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                      </button>
                      <button onClick={() => revokeInvite(inv.id)} title="Révoquer"
                        className="p-2 rounded-lg hover:bg-red-50 transition-colors text-gray-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Liste — Acceptées */}
      {accepted.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Acceptées ({accepted.length})
          </p>
          <div className="space-y-2">
            {accepted.map(inv => {
              const colors = ROLE_COLORS[inv.role] || ROLE_COLORS.client;
              return (
                <div key={inv.id} className="p-4 bg-green-50/50 rounded-xl border border-green-100">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-900">{inv.email}</p>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: colors.badge + "22", color: colors.badge }}>
                      {ROLE_LABELS[inv.role]}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {invitations.length === 0 && (
        <div className="text-center py-16">
          <Users className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Aucune invitation envoyée.</p>
          <button onClick={() => setShowForm(true)}
            className="mt-4 text-sm font-semibold underline underline-offset-2"
            style={{ color: "#D4AF37" }}>
            Créer la première invitation
          </button>
        </div>
      )}
    </div>
  );
}
