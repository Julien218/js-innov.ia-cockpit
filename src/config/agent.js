// ============================================================
// src/config/agent.js — Configuration centralisée du service agent
// SOURCE UNIQUE pour toutes les variables d'environnement liées à jsinnovia-agent
//
// Variable Railway à définir : VITE_AGENT_KEY
// (une seule variable suffit — les alias VITE_AGENT_AUTH et VITE_AGENT_API_KEY
//  lisent tous la même source via ce fichier)
// ============================================================

// URL du service jsinnovia-agent (Railway)
export const AGENT_URL =
  import.meta.env.VITE_AGENT_URL ||
  "https://jsinnovia-agent-production.up.railway.app";

// Clé d'authentification x-agent-key
// Priorité : VITE_AGENT_KEY → VITE_AGENT_AUTH → VITE_AGENT_API_KEY → ""
// Jamais de secret en dur dans le code
export const AGENT_KEY =
  import.meta.env.VITE_AGENT_KEY ||
  import.meta.env.VITE_AGENT_AUTH ||
  import.meta.env.VITE_AGENT_API_KEY ||
  "";

// Headers prêts à l'emploi pour fetch()
export const agentHeaders = () => ({
  "Content-Type": "application/json",
  "x-agent-key": AGENT_KEY,
});
