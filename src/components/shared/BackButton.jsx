import React from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

export default function BackButton({ className = "" }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Ne pas afficher sur le dashboard
  if (location.pathname === "/") return null;

  return (
    <button
      onClick={() => {
        if (window.history.length > 1) {
          navigate(-1);
        } else {
          navigate("/");
        }
      }}
      className={`flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] px-2 ${className}`}
      aria-label="Retour"
    >
      <ArrowLeft className="w-4 h-4" />
      <span>Retour</span>
    </button>
  );
}
