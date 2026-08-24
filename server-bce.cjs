const express = require('express');

const router = express.Router();

const OFFICIAL_BCE_INFO_URL = 'https://economie.fgov.be/fr/themes/entreprises/banque-carrefour-des/services-pour-tous/reutilisation-de-donnees/banque-carrefour-des';

function clean(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeEnterpriseNumber(value) {
  const digits = clean(value, 32).replace(/\D/g, '');
  if (digits.length === 9) return `0${digits}`;
  return digits.length === 10 ? digits : '';
}

function formatEnterpriseNumber(value) {
  const digits = normalizeEnterpriseNumber(value);
  return digits ? `${digits.slice(0, 4)}.${digits.slice(4, 7)}.${digits.slice(7)}` : '';
}

function isValidEnterpriseNumber(value) {
  const digits = normalizeEnterpriseNumber(value);
  if (!digits) return false;
  const base = Number(digits.slice(0, 8));
  const check = Number(digits.slice(8));
  return 97 - (base % 97) === check;
}

function firstValue(source, keys) {
  for (const key of keys) {
    const value = key.split('.').reduce((current, part) => current?.[part], source);
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return '';
}

function normalizeBceRecord(raw = {}) {
  const enterpriseNumber = normalizeEnterpriseNumber(firstValue(raw, [
    'enterprise_number', 'enterpriseNumber', 'number', 'kbo_number',
  ]));
  const vatNumber = normalizeEnterpriseNumber(firstValue(raw, ['vat_number', 'vatNumber']));
  const street = clean(firstValue(raw, ['address.street', 'address.street_name', 'street', 'adresse']), 300);
  const houseNumber = clean(firstValue(raw, ['address.house_number', 'address.number', 'house_number']), 32);
  const box = clean(firstValue(raw, ['address.box', 'box']), 32);
  const address = [street, houseNumber, box ? `boîte ${box}` : ''].filter(Boolean).join(' ');
  const statusValue = clean(firstValue(raw, ['status', 'entity_status', 'statut']), 80).toLowerCase();
  const active = raw.active === true || /active|actif|ac|actieve/.test(statusValue);

  return {
    numero_entreprise: formatEnterpriseNumber(enterpriseNumber),
    numero_tva: vatNumber ? `BE${vatNumber}` : '',
    denomination_legale: clean(firstValue(raw, ['legal_name', 'legalName', 'denomination', 'name', 'enterprise_name']), 240),
    adresse: address || street,
    code_postal: clean(firstValue(raw, ['address.postal_code', 'postal_code', 'zip']), 20),
    ville: clean(firstValue(raw, ['address.city', 'city', 'municipality']), 120),
    pays: clean(firstValue(raw, ['address.country', 'country']), 80) || 'Belgique',
    statut_bce: statusValue || (active ? 'actif' : ''),
    actif: active,
  };
}

function configuredProvider() {
  const url = clean(process.env.BCE_LOOKUP_URL, 1000);
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  return { url: parsed.toString(), token: clean(process.env.BCE_LOOKUP_TOKEN, 4000) };
}

async function lookupBce(query, fetchImpl = fetch) {
  const provider = configuredProvider();
  if (!provider) {
    const error = new Error('Le service web officiel BCE n’est pas encore configuré. Enregistrez un accès BCE puis renseignez BCE_LOOKUP_URL et BCE_LOOKUP_TOKEN.');
    error.status = 503;
    error.code = 'bce_provider_not_configured';
    throw error;
  }

  const response = await fetchImpl(provider.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(provider.token ? { Authorization: `Bearer ${provider.token}` } : {}),
    },
    body: JSON.stringify(query),
    signal: AbortSignal.timeout(15_000),
  });
  const rawText = await response.text();
  let payload;
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    const error = new Error('Le fournisseur BCE n’a pas renvoyé de JSON exploitable.');
    error.status = 502;
    error.code = 'bce_invalid_response';
    throw error;
  }
  if (!response.ok) {
    const error = new Error(clean(payload?.error || payload?.message || `Erreur BCE ${response.status}`, 500));
    error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    error.code = 'bce_provider_error';
    throw error;
  }

  const candidates = Array.isArray(payload) ? payload : Array.isArray(payload.results) ? payload.results : [payload];
  const requestedNumber = normalizeEnterpriseNumber(query.enterprise_number);
  const filtered = requestedNumber
    ? candidates.filter((item) => normalizeEnterpriseNumber(firstValue(item, ['enterprise_number', 'enterpriseNumber', 'number', 'kbo_number', 'vat_number', 'vatNumber'])) === requestedNumber)
    : candidates;
  if (filtered.length !== 1) {
    const error = new Error(filtered.length === 0
      ? 'Aucune entreprise BCE ne correspond exactement à cette fiche.'
      : 'Plusieurs entreprises correspondent. Ajoutez le numéro d’entreprise exact avant de valider.');
    error.status = 409;
    error.code = filtered.length === 0 ? 'bce_not_found' : 'bce_ambiguous';
    throw error;
  }

  const record = normalizeBceRecord(filtered[0]);
  if (!record.numero_entreprise || !record.denomination_legale) {
    const error = new Error('La réponse BCE ne contient pas le numéro et la dénomination nécessaires à une validation sûre.');
    error.status = 502;
    error.code = 'bce_incomplete_response';
    throw error;
  }
  return record;
}

router.get('/status', (_req, res) => {
  res.json({
    configured: Boolean(configuredProvider()),
    provider: 'BCE officielle',
    official_registration_url: OFFICIAL_BCE_INFO_URL,
    automatic_updates_require_review: true,
  });
});

router.post('/lookup', async (req, res) => {
  const enterpriseNumber = normalizeEnterpriseNumber(req.body?.enterprise_number || req.body?.numero_entreprise || req.body?.numero_tva);
  const name = clean(req.body?.name || req.body?.denomination || req.body?.entreprise, 240);
  const postalCode = clean(req.body?.postal_code || req.body?.code_postal, 20);
  if (enterpriseNumber && !isValidEnterpriseNumber(enterpriseNumber)) {
    return res.status(400).json({ error: 'Le numéro d’entreprise belge est invalide.', code: 'invalid_enterprise_number' });
  }
  if (!enterpriseNumber && name.length < 3) {
    return res.status(400).json({ error: 'Indiquez un numéro d’entreprise ou une dénomination d’au moins 3 caractères.', code: 'missing_lookup_key' });
  }

  const auditId = `bce-${crypto.randomUUID()}`;
  try {
    const record = await lookupBce({
      enterprise_number: enterpriseNumber ? formatEnterpriseNumber(enterpriseNumber) : '',
      name,
      postal_code: postalCode,
    });
    return res.json({
      audit_id: auditId,
      source: 'BCE officielle',
      retrieved_at: new Date().toISOString(),
      requires_confirmation: true,
      record,
    });
  } catch (error) {
    console.warn(`[BCE] ${auditId} ${error.code || 'lookup_failed'}: ${error.message}`);
    return res.status(error.status || 502).json({
      error: error.message,
      code: error.code || 'bce_lookup_failed',
      audit_id: auditId,
      official_registration_url: OFFICIAL_BCE_INFO_URL,
    });
  }
});

module.exports = {
  router,
  normalizeEnterpriseNumber,
  formatEnterpriseNumber,
  isValidEnterpriseNumber,
  normalizeBceRecord,
  lookupBce,
  OFFICIAL_BCE_INFO_URL,
};
