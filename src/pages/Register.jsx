import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/roles";

// Tokens de démo (en prod : vérifier via API)
const DEMO_TOKENS = {
  "ABC12-XYZ9": { role: "client", email: "demo@client.com" },
};

export default function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [tokenInfo, setTokenInfo] = useState(null);
  const [tokenError, setTokenError] = useState("");
  const [form, setForm] = useState({ fullName: "", email: "", password: "", confirm: "" });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) { setTokenError("Lien d'invitation manquant ou invalide."); return; }
    const info = DEMO_TOKENS[token];
    if (!info) { setTokenError("Ce lien d'invitation est invalide ou a expiré."); return; }
    setTokenInfo(info);
    setForm(p => ({ ...p, email: info.email }));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) { setError("Les mots de passe ne correspondent pas."); return; }
    if (form.password.length < 8) { setError("Le mot de passe doit faire au moins 8 caractères."); return; }
    setLoading(true); setError("");
    await new Promise(r => setTimeout(r, 1000));
    setLoading(false);
    setDone(true);
    setTimeout(() => navigate("/login"), 2500);
  };

  const colors = tokenInfo ? ROLE_COLORS[tokenInfo.role] : ROLE_COLORS.client;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a14] px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-80 h-80 bg-[#D4AF37]/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-2xl shadow-[#D4AF37]/20 mb-4 ring-2 ring-[#D4AF37]/30">
            <img src="/logo.png" alt="JS-Innov.IA" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            JS-Innov.IA
          </h1>
          <p className="text-sm text-white/40 mt-1 tracking-widest uppercase">Cockpit — Inscription</p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
              <h2 className="text-lg font-semibold text-white mb-1">Compte créé !</h2>
              <p className="text-sm text-white/50">Redirection vers la connexion…</p>
            </div>
          ) : tokenError ? (
            <div className="text-center py-4">
              <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
              <h2 className="text-base font-semibold text-white mb-1">Lien invalide</h2>
              <p className="text-sm text-white/40">{tokenError}</p>
              <a href="/login" className="mt-4 inline-block text-sm text-[#D4AF37]/70 hover:text-[#D4AF37] transition-colors">
                Aller à la connexion →
              </a>
            </div>
          ) : (
            <>
              {tokenInfo && (
                <div className="mb-5 p-3 rounded-xl border" style={{ borderColor: colors.badge + "40", backgroundColor: colors.bg + "33" }}>
                  <p className="text-xs" style={{ color: colors.badge }}>
                    <strong>Invitation acceptée</strong> — Rôle : {ROLE_LABELS[tokenInfo.role]}
                  </p>
                </div>
              )}

              <h2 className="text-lg font-semibold text-white mb-1">Créer votre compte</h2>
              <p className="text-sm text-white/40 mb-6">Complétez votre profil pour accéder au Cockpit.</p>

              {error && (
                <div className="mb-4 flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {[
                  { key: "fullName", label: "Nom complet", type: "text", placeholder: "Jean Dupont" },
                  { key: "email", label: "Email", type: "email", placeholder: "vous@exemple.com" },
                ].map(({ key, label, type, placeholder }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-white/60 mb-1.5">{label}</label>
                    <input type={type} required value={form[key]}
                      onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 transition-all"
                    />
                  </div>
                ))}

                <div>
                  <label className="block text-xs font-medium text-white/60 mb-1.5">Mot de passe</label>
                  <div className="relative">
                    <input type={showPwd ? "text" : "password"} required value={form.password}
                      onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                      placeholder="Min. 8 caractères"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-11 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 transition-all"
                    />
                    <button type="button" onClick={() => setShowPwd(!showPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-white/60 mb-1.5">Confirmer le mot de passe</label>
                  <input type="password" required value={form.confirm}
                    onChange={e => setForm(p => ({ ...p, confirm: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 transition-all"
                  />
                </div>

                <button type="submit" disabled={loading}
                  className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
                  style={{ backgroundColor: "#D4AF37", color: "#0a0a14" }}>
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Création…</> : "Créer mon compte"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
