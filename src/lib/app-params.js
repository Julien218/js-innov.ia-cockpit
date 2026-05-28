// app-params.js — simplifié pour Supabase
// Plus de dépendance Base44
export const appParams = {
  appId: null,
  token: null,
  fromUrl: typeof window !== 'undefined' ? window.location.href : '',
  functionsVersion: null,
  appBaseUrl: null,
};
