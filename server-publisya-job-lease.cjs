const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_RE = /^[a-zA-Z0-9._:-]{1,160}$/;

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeWorkerId(value) {
  const workerId = String(value || '').trim();
  if (!WORKER_RE.test(workerId)) {
    const error = new Error('Identifiant worker Publisya invalide.');
    error.code = 'PUBLISYA_WORKER_ID_INVALID';
    throw error;
  }
  return workerId;
}

function normalizeUuid(value, field) {
  const id = String(value || '').trim();
  if (!UUID_RE.test(id)) {
    const error = new Error(`${field || 'UUID'} invalide.`);
    error.code = 'PUBLISYA_LEASE_ID_INVALID';
    throw error;
  }
  return id;
}

function normalizeNextAttemptAt(value) {
  if (value == null || value === '') return null;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) {
    const error = new Error('Date de prochaine tentative invalide.');
    error.code = 'PUBLISYA_NEXT_ATTEMPT_INVALID';
    throw error;
  }
  return new Date(timestamp).toISOString();
}

async function rpcRequest(name, payload) {
  if (!SUPABASE_SECRET) {
    const error = new Error('Clé serveur Supabase non configurée.');
    error.code = 'PUBLISYA_DATABASE_NOT_CONFIGURED';
    throw error;
  }
  if (!/^publisya_(claim|renew|release)_publication_(jobs|lease)$/.test(name)) {
    const error = new Error('RPC Publisya non autorisée.');
    error.code = 'PUBLISYA_LEASE_RPC_NOT_ALLOWED';
    throw error;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SECRET,
      Authorization: `Bearer ${SUPABASE_SECRET}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  const body = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
  if (!response.ok) {
    const error = new Error(`Lease Publisya refusé (${response.status}).`);
    error.code = response.status === 404 ? 'PUBLISYA_LEASE_SCHEMA_NOT_READY' : 'PUBLISYA_LEASE_RPC_FAILED';
    error.status = response.status;
    throw error;
  }
  return body;
}

async function claimPublicationJobs({ workerId, limit = 1, leaseSeconds = 60 } = {}) {
  const normalizedWorker = normalizeWorkerId(workerId);
  const normalizedLimit = clampInteger(limit, 1, 20, 1);
  const normalizedLeaseSeconds = clampInteger(leaseSeconds, 15, 300, 60);
  const rows = await rpcRequest('publisya_claim_publication_jobs', {
    p_worker_id: normalizedWorker,
    p_limit: normalizedLimit,
    p_lease_seconds: normalizedLeaseSeconds,
  });
  return Array.isArray(rows) ? rows : [];
}

async function renewPublicationLease({ jobId, leaseToken, workerId, leaseSeconds = 60 } = {}) {
  const normalizedWorker = normalizeWorkerId(workerId);
  const normalizedLeaseSeconds = clampInteger(leaseSeconds, 15, 300, 60);
  const row = await rpcRequest('publisya_renew_publication_lease', {
    p_job_id: normalizeUuid(jobId, 'Job'),
    p_lease_token: normalizeUuid(leaseToken, 'Lease token'),
    p_worker_id: normalizedWorker,
    p_lease_seconds: normalizedLeaseSeconds,
  });
  return Array.isArray(row) ? row[0] || null : row;
}

async function releasePublicationLease({ jobId, leaseToken, workerId, nextAttemptAt = null } = {}) {
  const normalizedWorker = normalizeWorkerId(workerId);
  const row = await rpcRequest('publisya_release_publication_lease', {
    p_job_id: normalizeUuid(jobId, 'Job'),
    p_lease_token: normalizeUuid(leaseToken, 'Lease token'),
    p_worker_id: normalizedWorker,
    p_next_attempt_at: normalizeNextAttemptAt(nextAttemptAt),
  });
  return Array.isArray(row) ? row[0] || null : row;
}

function leaseFoundationStatus() {
  return Object.freeze({
    started: false,
    automatic_claiming: false,
    automatic_refresh: false,
    publishing_enabled: false,
    scheduler_enabled: false,
    lease_seconds_min: 15,
    lease_seconds_max: 300,
    claim_batch_max: 20,
  });
}

module.exports = {
  UUID_RE,
  WORKER_RE,
  clampInteger,
  normalizeWorkerId,
  normalizeNextAttemptAt,
  claimPublicationJobs,
  renewPublicationLease,
  releasePublicationLease,
  leaseFoundationStatus,
};
