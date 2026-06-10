import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";

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
      navigate("/", { replace: true });
    } else {
      setError(result.error || "Identifiants incorrects.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a14] px-4">
      {/* Fond animé */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#D4AF37]/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-600/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-2xl shadow-[#D4AF37]/20 mb-4 ring-2 ring-[#D4AF37]/30">
            <img src="/logo.png" alt="JS-Innov.IA" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            JS-Innov.IA
          </h1>
          <p className="text-sm text-white/40 mt-1 tracking-widest uppercase">Cockpit</p>
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-white mb-1">Connexion</h2>
          <p className="text-sm text-white/40 mb-6">Accédez à votre espace de gestion.</p>

          {error && (
            <div className="mb-4 flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1.5">
                Adresse e-mail
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]/50 transition-all"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/60 mb-1.5">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-11 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]/50 transition-all"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{ backgroundColor: "#D4AF37", color: "#0a0a14" }}
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Connexion…</>
              ) : (
                "Se connecter"
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/5 text-center">
            <p className="text-xs text-white/20">
              Vous avez reçu une invitation ?{" "}
              <a href="/register" className="text-[#D4AF37]/60 hover:text-[#D4AF37] transition-colors">
                Créer un compte
              </a>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-white/15 mt-6">
          🚀 JS-Innov.IA — Intelligence artificielle amplifiée par l'humain
        </p>
      </div>
    </div>
  );
}
