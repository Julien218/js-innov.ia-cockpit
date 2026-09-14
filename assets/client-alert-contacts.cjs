'use strict';

const { createClient } = require('@supabase/supabase-js');

const SYNC_ENABLED = process.env.CLIENT_ALERT_CONTACT_SYNC_ENABLED !== 'false';
const SYNC_INTERVAL_MS = Math.max(60_000, Number(process.env.CLIENT_ALERT_CONTACT_SYNC_INTERVAL_MS || 60_000));
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

function cleanTenant(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function normalizePhone(value) {
  let phone = String(value || '').trim().replace(/[\s()./-]/g, '');
  if (!phone) return '';
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  if (/^0\d{8,9}$/.test(phone)) phone = `+32${phone.slice(1)}`;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : '';
}

function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'oui', 'on'].includes(String(value).trim().toLowerCase());
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const manualConfig = parseJsonObject(process.env.CLIENT_ALERT_CONTACTS_JSON);

function tenantKeyForClient(row) {
  return cleanTenant(
    row?.alert_tenant_key || row?.entreprise || row?.denomination_legale || row?.nom,
  );
}

function candidateScore(row) {
  let score = row?.statut === 'actif' ? 10 : 0;
  if (normalizePhone(row?.alert_phone || row?.telephone)) score += 8;
  if (asBool(row?.alert_sms_enabled)) score += 4;
  if (asBool(row?.alert_whatsapp_enabled)) score += 2;
  if (asBool(row?.alert_whatsapp_opt_in)) score += 2;
  if (row?.alert_updated_at) score += 1;
  return score;
}

function buildDbConfig(rows = []) {
  const selected = new Map();
  for (const row of rows) {
    const tenant = tenantKeyForClient(row);
    if (!tenant) continue;
    const previous = selected.get(tenant);
    if (!previous || candidateScore(row) > candidateScore(previous)) selected.set(tenant, row);
  }

  const config = {};
  for (const [tenant, row] of selected.entries()) {
    const phone = normalizePhone(row.alert_phone || row.telephone);
    const siteIncidents = asBool(row.alert_site_incidents, true);
    const smsEnabled = siteIncidents && asBool(row.alert_sms_enabled) && Boolean(phone);
    const whatsappOptIn = asBool(row.alert_whatsapp_opt_in);
    const whatsappEnabled = siteIncidents && asBool(row.alert_whatsapp_enabled) && whatsappOptIn && Boolean(phone);

    config[tenant] = {
      name: String(row.entreprise || row.denomination_legale || row.nom || tenant).trim().slice(0, 120),
      sms: smsEnabled ? [phone] : [],
      whatsapp: whatsappEnabled ? [{ phone, opt_in: true }] : [],
      alert_types: {
        site: siteIncidents,
        screen: asBool(row.alert_screen_incidents, true),
      },
      source: 'client-record',
    };
  }
  return config;
}

let supabase = null;
let refreshRunning = false;

async function refreshClientAlertContacts() {
  if (!SYNC_ENABLED || refreshRunning || !SUPABASE_URL || !SUPABASE_KEY) return;
  refreshRunning = true;
  try {
    if (!supabase) {
      supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    const { data, error } = await supabase
      .from('Client')
      .select('nom,denomination_legale,entreprise,telephone,statut,alert_tenant_key,alert_phone,alert_sms_enabled,alert_whatsapp_enabled,alert_whatsapp_opt_in,alert_site_incidents,alert_screen_incidents,alert_updated_at');
    if (error) throw error;
    const dbConfig = buildDbConfig(data || []);
    process.env.CLIENT_ALERT_CONTACTS_JSON = JSON.stringify({ ...manualConfig, ...dbConfig });
    global.__clientAlertContactSync = {
      refreshedAt: new Date().toISOString(),
      tenantCount: Object.keys(dbConfig).length,
      error: null,
    };
  } catch (error) {
    global.__clientAlertContactSync = {
      refreshedAt: new Date().toISOString(),
      tenantCount: 0,
      error: error.message,
    };
    console.warn('[client-alerts] synchronisation contacts indisponible:', error.message);
  } finally {
    refreshRunning = false;
  }
}

if (SYNC_ENABLED) {
  refreshClientAlertContacts();
  const timer = setInterval(refreshClientAlertContacts, SYNC_INTERVAL_MS);
  timer.unref?.();
}

module.exports = {
  normalizePhone,
  cleanTenant,
  buildDbConfig,
  refreshClientAlertContacts,
};
