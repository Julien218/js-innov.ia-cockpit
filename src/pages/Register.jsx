import React, { useEffect, useState } from "react";
import { Shield, Loader2 } from "lucide-react";

export default function Register() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [valid, setValid] = useState(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/auth/invite?token=${encodeURIComponent(token)}`).then(response => response.json()).then(data => setValid(Boolean(data.valid))).catch(() => setValid(false));
  }, [token]);

  const activate = async event => {
    event.preventDefault(); setError("");
    if (password.length < 12) return setError("Utilisez au moins 12 caractères.");
    if (password !== confirm) return setError("Les mots de passe ne correspondent pas.");
    setSaving(true);
    try {
      const response = await fetch("/api/auth/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Activation impossible.");
      setDone(true);
    } catch (activationError) { setError(activationError.message); }
    finally { setSaving(false); }
  };

  return <div className="min-h-screen flex items-center justify-center bg-[#0a0a14] px-4"><div className="relative w-full max-w-md">
    <div className="flex flex-col items-center mb-8"><div className="w-16 h-16 rounded-2xl overflow-hidden shadow-2xl shadow-[#D4AF37]/20 mb-4 ring-2 ring-[#D4AF37]/30"><img src="/logo.png" alt="JS-Innov.IA" className="w-full h-full object-cover" /></div><h1 className="text-2xl font-bold text-white">JS-Innov.IA</h1><p className="text-sm text-white/40 mt-1 tracking-widest uppercase">Cockpit</p></div>
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl text-center"><Shield className="w-10 h-10 text-[#D4AF37]/70 mx-auto mb-4" />
      {valid === null ? <Loader2 className="w-6 h-6 animate-spin text-white/50 mx-auto" /> : done ? <><h2 className="text-lg font-semibold text-white mb-2">Compte activé</h2><p className="text-sm text-white/50">Votre mot de passe est enregistré. Vous pouvez maintenant vous connecter.</p></> : valid ? <form onSubmit={activate} className="space-y-4 text-left"><h2 className="text-lg font-semibold text-white text-center">Activer votre compte</h2><p className="text-sm text-white/50 text-center">Choisissez un mot de passe d’au moins 12 caractères.</p><input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Nouveau mot de passe" className="w-full h-11 rounded-xl bg-white/5 border border-white/10 px-4 text-white" /><input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} placeholder="Confirmer le mot de passe" className="w-full h-11 rounded-xl bg-white/5 border border-white/10 px-4 text-white" />{error && <p className="text-sm text-red-400">{error}</p>}<button disabled={saving} className="w-full h-11 rounded-xl bg-[#D4AF37] text-black font-semibold disabled:opacity-50">{saving ? "Activation…" : "Activer mon compte"}</button></form> : <><h2 className="text-lg font-semibold text-white mb-2">Invitation invalide ou expirée</h2><p className="text-sm text-white/40">Demandez une nouvelle invitation à votre administrateur.</p></>}
      <div className="mt-6 pt-6 border-t border-white/5"><a href="/login" className="text-[#D4AF37]/60 hover:text-[#D4AF37] transition-colors text-xs">← Retour à la connexion</a></div>
    </div>
  </div></div>;
}
