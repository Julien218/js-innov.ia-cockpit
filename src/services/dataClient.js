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

const providerNotReady = (entity, action) => {
  throw new Error(
    \Provider non encore connecté pour \.\. Utilise Base44 ou Agent pour cette étape.\
  );
};

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
