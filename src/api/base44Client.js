// ============================================================
// base44Client.js — PROXY via jsinnovia-agent backend
// Interface identique : base44.entities.X.list/create/update/delete
// Backend : jsinnovia-agent (Railway) → Supabase service_role (bypass RLS)
// ============================================================

const AGENT_URL = import.meta.env.VITE_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_AUTH = import.meta.env.VITE_AGENT_AUTH || 'julien-ai-secret-key-change-me';

// TABLE_MAP — noms PascalCase = noms réels dans Supabase gfjpryakxzdzwnazlsfz
// Le backend data.js supporte aussi les alias legacy (clients_fr → Client)
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
};

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
      return await agentReq(tableName, params);
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
      return await agentReq(tableName, `?${parts.join('&')}`);
    },
  };
}

export const base44 = {
  entities: Object.fromEntries(
    Object.entries(TABLE_MAP).map(([entity, table]) => [entity, makeEntity(table)])
  ),
};

export default base44;
