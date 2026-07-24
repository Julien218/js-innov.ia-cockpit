// ============================================================
// base44Client.js — PROXY via jsinnovia-agent backend
// Interface identique : base44.entities.X.list/create/update/delete
// Backend : jsinnovia-agent (Railway) → Supabase service_role (bypass RLS)
// ============================================================

import { AGENT_URL, AGENT_KEY as AGENT_AUTH } from '@/config/agent';

// Guard: if no API key is configured, fail fast with a clear message
if (!AGENT_AUTH) {
  console.error('[base44Client] VITE_AGENT_KEY manquant côté frontend cockpit — toutes les API CRM retourneront 401');
}

// TABLE_MAP — noms PascalCase = noms réels dans Supabase (via jsinnovia-agent proxy)
const TABLE_MAP = {
  Client:     'Client',
  Lead:       'Lead',
  Projet:     'Projet',
  Service:    'Service',
  Tache:      'Tache',
  Devis:      'Devis',
  Facture:    'Facture',
  Commission: 'Commission',
  Demande:    'Demande',
  LogAction:  'LogAction',
  Asset:            'Asset',
  AssetHistory:     'AssetHistory',
  SystemConfig:     'SystemConfig',
  AutomationAudit:  'AutomationAudit',
  Validation:     'validations',
};

// Normalize any API response to an array — never return undefined/null/object
function toArray(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.data)) return result.data;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

async function agentReq(table, path = '', options = {}) {
  const url = `${AGENT_URL}/data/${table}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-agent-key': AGENT_AUTH,
      ...(options.headers || {}),
    },
  });

  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) {
    console.error('[Agent CRUD Error]', data);
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

function makeEntity(tableName) {
  return {
    list: async (sort) => {
      const params = sort
        ? `?sort=${sort.startsWith('-') ? sort.slice(1) : sort}&order=${sort.startsWith('-') ? 'desc' : 'asc'}`
        : '';
      const result = await agentReq(tableName, params);
      return toArray(result);
    },
    get: async (id) => {
      return await agentReq(tableName, `/${id}`);
    },
    create: async (data) => {
      return await agentReq(tableName, '', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    update: async (id, data) => {
      return await agentReq(tableName, `/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
    },
    delete: async (id) => {
      await agentReq(tableName, `/${id}`, { method: 'DELETE' });
      return { id };
    },
    filter: async (query = {}, sort) => {
      const parts = Object.entries(query).map(
        ([k, v]) => `${k}=${encodeURIComponent(v)}`
      );
      if (sort) {
        const desc = sort.startsWith('-');
        parts.push(`sort=${desc ? sort.slice(1) : sort}&order=${desc ? 'desc' : 'asc'}`);
      }
      const result = await agentReq(tableName, `?${parts.join('&')}`);
      return toArray(result);
    },
  };
}

export const base44 = {
  entities: Object.fromEntries(
    Object.entries(TABLE_MAP).map(([entity, table]) => [entity, makeEntity(table)])
  ),
};

export default base44;
