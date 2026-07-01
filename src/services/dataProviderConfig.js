// ============================================================
// dataProviderConfig.js — Sélecteur du moteur de données
// JS-Innov.IA Cockpit — couche ON/OFF Base44 / Agent / Supabase
// ============================================================
//
// 3 modes possibles :
//   - "base44"   : mode compatible actuel (aucun changement de comportement).
//                  À garder actif pendant les 6 mois d'abonnement Base44 déjà payés.
//   - "agent"    : backend JS-Innov.IA (Railway) — même interface CRUD,
//                  transition en cours vers l'infra propre.
//   - "supabase" : connexion directe Supabase (gfjpryakxzdzwnazlsfz) —
//                  futur mode, pas encore branché partout.
//
// Le choix est persistant (localStorage) et peut être forcé via
// la variable d'env VITE_DATA_PROVIDER (utile pour les previews/tests).
// ============================================================

export const DATA_PROVIDERS = {
  BASE44: "base44",
  AGENT: "agent",
  SUPABASE: "supabase",
};

export const STORAGE_KEY = "jsinnovia_data_provider";

export const getDataProvider = () => {
  const fromEnv = import.meta.env.VITE_DATA_PROVIDER;

  const fromStorage =
    typeof window !== "undefined"
      ? window.localStorage.getItem(STORAGE_KEY)
      : null;

  const value = fromStorage || fromEnv || DATA_PROVIDERS.BASE44;

  // Sécurité : si une valeur invalide traîne dans le localStorage, on retombe sur base44
  if (!Object.values(DATA_PROVIDERS).includes(value)) {
    return DATA_PROVIDERS.BASE44;
  }

  return value;
};

export const setDataProvider = (provider) => {
  if (!Object.values(DATA_PROVIDERS).includes(provider)) {
    console.warn(`[dataProviderConfig] Provider inconnu: ${provider}`);
    return;
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, provider);
  }
};

export const isBase44Enabled = () => getDataProvider() === DATA_PROVIDERS.BASE44;
export const isAgentEnabled = () => getDataProvider() === DATA_PROVIDERS.AGENT;
export const isSupabaseEnabled = () => getDataProvider() === DATA_PROVIDERS.SUPABASE;
