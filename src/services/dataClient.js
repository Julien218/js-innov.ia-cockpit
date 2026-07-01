// ============================================================
// dataClient.js — Client de données indépendant (couche de transition)
// JS-Innov.IA Cockpit — bascule Base44 / Agent / Supabase
// ============================================================
//
// Objectif : offrir la MÊME interface CRUD (list/get/create/update/delete/filter)
// quel que soit le moteur choisi dans Paramètres > Moteur données.
//
// - "base44"   → passe par src/api/base44Client.js (comportement actuel inchangé)
// - "agent"    → passe par le backend Railway jsinnovia-agent (même infra que
//                base44Client.js aujourd'hui — voir note ci-dessous)
// - "supabase" → pas encore branché (mode futur), lève une erreur explicite
//
// NOTE IMPORTANTE (transparence technique) :
// base44Client.js a déjà été migré il y a plusieurs semaines pour proxy-er
// vers le backend Railway (jsinnovia-agent) + Supabase gfjpryakxzdzwnazlsfz.
// Concrètement, "base44" et "agent" tapent aujourd'hui la même infra réseau.
// Cette couche sert avant tout à préparer la bascule progressive des pages
// vers dataClient.entities.X sans rien casser, et à garder une place propre
// pour une vraie 3ᵉ voie ("supabase" direct) plus tard.
// Si tu veux un vrai fallback vers le SDK natif Base44 (app JS - AGENT - COCKPIT,
// id 69ff4dc771a2cdab275f8a00), il faudra une clé API Base44 dédiée configurée
// côté Railway (jamais en dur dans le repo) — dis-moi si tu veux qu'on la mette en place.
// ============================================================

import { base44 } from "@/api/base44Client";
import { getDataProvider, DATA_PROVIDERS } from "@/services/dataProviderConfig";

const ENTITY_MAP = {
  Client: "Client",
  Lead: "Lead",
  Projet: "Projet",
  Service: "Service",
  Tache: "Tache",
  Devis: "Devis",
  Facture: "Facture",
  Commission: "Commission",
  Demande: "Demande",
  Validation: "Validation",
  LogAction: "LogAction",
};

function providerNotReady(entityName, action) {
  throw new Error(
    `[dataClient] Provider "supabase" non encore branché pour ${entityName}.${action}(). ` +
    `Utilise le mode "Base44" ou "Agent JS-Innov.IA" dans Paramètres > Moteur données.`
  );
}

function makeEntity(entityName) {
  return {
    list: async (sort) => {
      const provider = getDataProvider();
      if (provider === DATA_PROVIDERS.BASE44 || provider === DATA_PROVIDERS.AGENT) {
        return base44.entities[entityName].list(sort);
      }
      return providerNotReady(entityName, "list");
    },

    get: async (id) => {
      const provider = getDataProvider();
      if (provider === DATA_PROVIDERS.BASE44 || provider === DATA_PROVIDERS.AGENT) {
        return base44.entities[entityName].get(id);
      }
      return providerNotReady(entityName, "get");
    },

    create: async (data) => {
      const provider = getDataProvider();
      if (provider === DATA_PROVIDERS.BASE44 || provider === DATA_PROVIDERS.AGENT) {
        return base44.entities[entityName].create(data);
      }
      return providerNotReady(entityName, "create");
    },

    update: async (id, data) => {
      const provider = getDataProvider();
      if (provider === DATA_PROVIDERS.BASE44 || provider === DATA_PROVIDERS.AGENT) {
        return base44.entities[entityName].update(id, data);
      }
      return providerNotReady(entityName, "update");
    },

    delete: async (id) => {
      const provider = getDataProvider();
      if (provider === DATA_PROVIDERS.BASE44 || provider === DATA_PROVIDERS.AGENT) {
        return base44.entities[entityName].delete(id);
      }
      return providerNotReady(entityName, "delete");
    },

    filter: async (query = {}, sort) => {
      const provider = getDataProvider();
      if (provider === DATA_PROVIDERS.BASE44 || provider === DATA_PROVIDERS.AGENT) {
        return base44.entities[entityName].filter(query, sort);
      }
      return providerNotReady(entityName, "filter");
    },
  };
}

export const dataClient = {
  provider: getDataProvider,
  entities: Object.fromEntries(
    Object.keys(ENTITY_MAP).map((entity) => [entity, makeEntity(entity)])
  ),
};

export default dataClient;
