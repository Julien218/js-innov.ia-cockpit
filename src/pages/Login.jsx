import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import InstallSignelyaButton from "@/components/InstallSignelyaButton";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError("");
    const result = await login(email.trim(), password);
    setLoading(false);
    if (result.success) {
      navigate("/ecran-geant", { replace: true });
    } else {
      setError(result.error || "Identifiants incorrects.");
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] w-full max-w-full items-start justify-center overflow-x-hidden bg-[#0a0a14] px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:items-center sm:py-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-[#00D4FF]/5 blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 h-64 w-64 rounded-full bg-purple-600/5 blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
      </div>

      <div className="relative w-full max-w-md py-2 sm:py-0">
        <div className="mb-4 flex flex-col items-center sm:mb-8">
          <img
            src="/signelya-lockup-approved.png"
            alt="SIGNELYA — Vos écrans prennent vie"
            className="h-auto w-full max-w-[300px] sm:max-w-[360px]"
          />
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-xl sm:p-8">
          <h2 className="mb-1 text-lg font-semibold text-white">Connexion</h2>
          <p className="mb-5 text-sm text-white/40 sm:mb-6">Accédez à votre espace de gestion.</p>

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/60">Adresse e-mail</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white placeholder:text-white/20 focus:border-[#00D4FF]/50 focus:outline-none focus:ring-2 focus:ring-[#00D4FF]/50 sm:text-sm"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/60">Mot de passe</label>
              <div className="relative">
                <input
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 pr-11 text-base text-white placeholder:text-white/20 focus:border-[#00D4FF]/50 focus:outline-none focus:ring-2 focus:ring-[#00D4FF]/50 sm:text-sm"
                  autoComplete="current-password"
                  required
                />
                <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-white/30 transition-colors hover:text-white/60" aria-label={showPwd ? "Masquer le mot de passe" : "Afficher le mot de passe"}>
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: "#00D4FF", color: "#0a0a14" }}
            >
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Connexion…</> : "Se connecter"}
            </button>
          </form>

          <InstallSignelyaButton />

          <div className="mt-5 border-t border-white/5 pt-5 text-center sm:mt-6 sm:pt-6">
            <p className="text-xs text-white/20">Vous avez reçu une invitation ?{" "}<a href="/register" className="text-[#00D4FF]/60 transition-colors hover:text-[#00D4FF]">Créer un compte</a></p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[11px] text-white/30 sm:mt-6 sm:text-xs">
          <span>SIGNELYA — by JS‑Innov.IA</span>
          <span aria-hidden="true">•</span>
          <a href="/politique-de-confidentialite" className="transition-colors hover:text-[#00D9FF]">Confidentialité</a>
        </div>
      </div>
    </div>
  );
}
