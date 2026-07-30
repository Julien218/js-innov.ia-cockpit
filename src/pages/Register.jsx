import React from "react";
import { Shield } from "lucide-react";

export default function Register() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a14] px-4">
      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-2xl shadow-[#D4AF37]/20 mb-4 ring-2 ring-[#D4AF37]/30">
            <img src="/logo.png" alt="JS-Innov.IA" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            JS-Innov.IA
          </h1>
          <p className="text-sm text-white/40 mt-1 tracking-widest uppercase">Cockpit</p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl text-center">
          <Shield className="w-10 h-10 text-white/30 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-white mb-2">Inscription temporairement indisponible</h2>
          <p className="text-sm text-white/40 leading-relaxed">
            La création de compte est temporairement indisponible suite à la migration de l'authentification.
            Contactez votre administrateur si vous avez besoin d'un accès.
          </p>
          <div className="mt-6 pt-6 border-t border-white/5">
            <a href="/login" className="text-[#D4AF37]/60 hover:text-[#D4AF37] transition-colors text-xs">
              ← Retour à la connexion
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
