// ============================================================
// base44Client.js — REMPLACÉ PAR SUPABASE
// Interface identique : base44.entities.X.list/create/update/delete
// Backend : Supabase REST API (fngyikpxvggrokqtezia)
// Aucun autre fichier à modifier.
// ============================================================

const SUPABASE_URL = 'https://fngyikpxvggrokqtezia.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_SERVICE_KEY || '';

const TABLE_MAP = {
  Lead:       'leads_fr',
  Client:     'clients_fr',
  Projet:     'projets',
  Service:    'services_fr',
  Tache:      'taches',
  Devis:      'devis',
  Facture:    'factures',
  Commission: 'commissions_fr',
  Demande:    'demandes',
  Validation: 'validations',
  LogAction:  'logs_actions',
};

async function sbReq(table, params = '', options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${params ? '?' + params : ''}`;
  const isWrite = ['POST', 'PATCH', 'PUT'].includes(options.method);
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...(isWrite ? { Prefer: 'return=representation' } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) {
    console.error('[Supabase Error]', data);
    throw new Error(data?.message || `HTTP ${res.status}`);
  }
  return data;
}

function makeEntity(tableName) {
  return {
    list: async (sort) => {
      const sortParam = sort
        ? (sort.startsWith('-')
            ? `order=${sort.slice(1)}.desc`
            : `order=${sort}.asc`)
        : 'order=created_at.desc';
      return await sbReq(tableName, sortParam);
    },
    get: async (id) => {
      const rows = await sbReq(tableName, `id=eq.${id}`);
      return rows?.[0] ?? null;
    },
    create: async (data) => {
      const rows = await sbReq(tableName, '', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return rows?.[0] ?? rows;
    },
    update: async (id, data) => {
      const rows = await sbReq(tableName, `id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      return rows?.[0] ?? rows;
    },
    delete: async (id) => {
      await sbReq(tableName, `id=eq.${id}`, { method: 'DELETE' });
      return { id };
    },
    filter: async (query = {}, sort) => {
      const parts = Object.entries(query).map(
        ([k, v]) => `${k}=eq.${encodeURIComponent(v)}`
      );
      if (sort) {
        const desc = sort.startsWith('-');
        parts.push(`order=${desc ? sort.slice(1) : sort}.${desc ? 'desc' : 'asc'}`);
      }
      return await sbReq(tableName, parts.join('&'));
    },
  };
}

export const base44 = {
  entities: Object.fromEntries(
    Object.entries(TABLE_MAP).map(([entity, table]) => [entity, makeEntity(table)])
  ),
};

export default base44;
