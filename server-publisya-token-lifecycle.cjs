const express = require('express');
const { resolveTenant } = require('./server-tenant.cjs');
const tokenVault = require('./server-publisya-token-vault.cjs');
const { verifyLinkedInIdentity } = require('./server-publisya-targets.cjs');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PROVIDER_TIMEOUT_MS = 15_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const refreshInFlight = new Map();

function env(name) {
  return String(process.env[name] || '').trim();
}

function context(req) {
  const tenantId = resolveTenant(req);
  return { tenantId, clientId: tenantId };
}

function scopesFrom(value) {
  return [...new Set(String(value || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_SECRET) {
    const error = new Error('Clé serveur Supabase non configurée.');
    error.code = 'PUBLISYA_DATABASE_NOT_CONFIGURED';
    throw error;
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET,
      Authorization: `Bearer ${SUPABASE_SECRET}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  const body = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : [];
  if (!response.ok) {
    const error = new Error(`Publisya token storage HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function accountFor(req, accountId) {
  if (!UUID_RE.test(String(accountId || ''))) return null;
  const { tenantId, clientId } = context(req);
  const rows = await supabaseRequest(
    `publisya_social_accounts?select=id,tenant_id,client_id,provider,provider_account_id,account_name,account_type,connection_status,scopes,token_ciphertext,refresh_token_ciphertext,token_expires_at,last_verified_at,metadata&id=eq.${encodeURIComponent(accountId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}&limit=1`,
  );
  return rows?.[0] || null;
}

function refreshConfig(provider) {
  if (provider === 'tiktok') {
    return {
      provider,
      endpoint: 'https://open.tiktokapis.com/v2/oauth/token/',
      clientIdName: 'PUBLISYA_TIKTOK_CLIENT_KEY',
      clientSecretName: 'PUBLISYA_TIKTOK_CLIENT_SECRET',
      clientIdParam: 'client_key',
    };
  }
  if (provider === 'youtube') {
    return {
      provider,
      endpoint: 'https://oauth2.googleapis.com/token',
      clientIdName: 'PUBLISYA_YOUTUBE_CLIENT_ID',
      clientSecretName: 'PUBLISYA_YOUTUBE_CLIENT_SECRET',
      clientIdParam: 'client_id',
    };
  }
  if (provider === 'linkedin') {
    return {
      provider,
      endpoint: 'https://www.linkedin.com/oauth/v2/accessToken',
      clientIdName: 'PUBLISYA_LINKEDIN_CLIENT_ID',
      clientSecretName: 'PUBLISYA_LINKEDIN_CLIENT_SECRET',
      clientIdParam: 'client_id',
    };
  }
  return null;
}

function refreshAad(account) {
  return `${account.tenant_id}:${account.client_id}:${account.provider}:${account.provider_account_id}:refresh`;
}

function accessAad(account) {
  return `${account.tenant_id}:${account.client_id}:${account.provider}:${account.provider_account_id}:access`;
}

function refreshTokenFor(account) {
  if (!account.refresh_token_ciphertext) return null;
  return tokenVault.decrypt(account.refresh_token_ciphertext, refreshAad(account));
}

function expiresAt(seconds, now = Date.now()) {
  const value = Number(seconds || 0);
  return Number.isFinite(value) && value > 0 ? new Date(now + value * 1000).toISOString() : null;
}

async function providerTokenRequest(config, refreshToken) {
  const clientId = env(config.clientIdName);
  const clientSecret = env(config.clientSecretName);
  if (!clientId || !clientSecret) {
    const error = new Error('Credentials fournisseur incomplets.');
    error.code = 'PUBLISYA_REFRESH_PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_secret: clientSecret,
  });
  params.set(config.clientIdParam, clientId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) {
      const error = new Error(`Rafraîchissement ${config.provider} refusé (${response.status}).`);
      error.code = 'PUBLISYA_REFRESH_PROVIDER_REJECTED';
      error.status = response.status;
      error.providerCode = String(body?.error || body?.error_code || body?.code || '').slice(0, 80) || null;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function bearerJson(url, accessToken) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Vérification identité HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyRefreshedIdentity(account, tokenBody) {
  const accessToken = tokenBody.access_token;
  if (account.provider === 'tiktok') {
    if (tokenBody.open_id && String(tokenBody.open_id) !== String(account.provider_account_id)) return false;
    const body = await bearerJson('https://open.tiktokapis.com/v2/user/info/?fields=open_id', accessToken);
    return String(body?.data?.user?.open_id || '') === String(account.provider_account_id);
  }
  if (account.provider === 'youtube') {
    const body = await bearerJson('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&maxResults=1', accessToken);
    return String(body?.items?.[0]?.id || '') === String(account.provider_account_id);
  }
  if (account.provider === 'linkedin') {
    const identity = await verifyLinkedInIdentity(account, accessToken);
    return Boolean(identity?.id) && String(identity.id) === String(account.provider_account_id);
  }
  return false;
}

function refreshExpirySeconds(body) {
  return body?.refresh_expires_in ?? body?.refresh_token_expires_in ?? null;
}

async function markReconnectRequired(account, providerCode) {
  const metadata = {
    ...(account.metadata || {}),
    last_refresh_error_code: providerCode || 'provider_rejected',
    last_refresh_error_at: new Date().toISOString(),
    automatic_refresh_enabled: false,
  };
  await supabaseRequest(
    `publisya_social_accounts?id=eq.${encodeURIComponent(account.id)}&tenant_id=eq.${encodeURIComponent(account.tenant_id)}&client_id=eq.${encodeURIComponent(account.client_id)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ connection_status: 'reconnect_required', metadata }),
    },
  ).catch(() => null);
}

async function persistRefresh(account, tokenBody, previousRefreshToken) {
  const now = Date.now();
  const newRefreshToken = String(tokenBody.refresh_token || previousRefreshToken || '');
  if (!newRefreshToken) {
    const error = new Error('Le fournisseur n’a pas renvoyé de refresh token exploitable.');
    error.code = 'PUBLISYA_REFRESH_TOKEN_LOST';
    throw error;
  }

  const newScopes = scopesFrom(tokenBody.scope);
  const refreshExpiresAt = expiresAt(refreshExpirySeconds(tokenBody), now)
    || account.metadata?.refresh_expires_at
    || null;
  const metadata = {
    ...(account.metadata || {}),
    refresh_token_present: true,
    refresh_expires_at: refreshExpiresAt,
    last_token_refresh_at: new Date(now).toISOString(),
    token_fingerprint: tokenVault.safeFingerprint(tokenBody.access_token),
    refresh_token_rotated: Boolean(tokenBody.refresh_token && tokenBody.refresh_token !== previousRefreshToken),
    automatic_refresh_enabled: false,
    manual_refresh_only: true,
  };
  delete metadata.last_refresh_error_code;
  delete metadata.last_refresh_error_at;

  const patch = {
    connection_status: 'connected',
    token_ciphertext: tokenVault.encrypt(tokenBody.access_token, accessAad(account)),
    refresh_token_ciphertext: tokenVault.encrypt(newRefreshToken, refreshAad(account)),
    token_expires_at: expiresAt(tokenBody.expires_in, now),
    last_verified_at: new Date(now).toISOString(),
    metadata,
  };
  if (newScopes.length) patch.scopes = newScopes;

  const rows = await supabaseRequest(
    `publisya_social_accounts?id=eq.${encodeURIComponent(account.id)}&tenant_id=eq.${encodeURIComponent(account.tenant_id)}&client_id=eq.${encodeURIComponent(account.client_id)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    },
  );
  return rows?.[0] || { ...account, ...patch };
}

function safeRefreshAccount(account) {
  return {
    id: account.id,
    provider: account.provider,
    provider_account_id: account.provider_account_id,
    account_name: account.account_name,
    connection_status: account.connection_status,
    scopes: Array.isArray(account.scopes) ? account.scopes : [],
    token_expires_at: account.token_expires_at,
    last_verified_at: account.last_verified_at,
    metadata: {
      refresh_token_present: Boolean(account.metadata?.refresh_token_present),
      refresh_expires_at: account.metadata?.refresh_expires_at || null,
      last_token_refresh_at: account.metadata?.last_token_refresh_at || null,
      manual_refresh_only: true,
    },
  };
}

async function refreshAccount(req, accountId) {
  const account = await accountFor(req, accountId);
  if (!account) {
    const error = new Error('Connexion Publisya introuvable.');
    error.code = 'PUBLISYA_REFRESH_ACCOUNT_NOT_FOUND';
    throw error;
  }
  if (!['connected', 'reconnect_required'].includes(account.connection_status)) {
    const error = new Error('Cette connexion ne peut pas être rafraîchie dans son état actuel.');
    error.code = 'PUBLISYA_REFRESH_STATE_INVALID';
    throw error;
  }
  if (!tokenVault.isConfigured()) {
    const error = new Error('Coffre de jetons non configuré.');
    error.code = 'PUBLISYA_TOKEN_VAULT_NOT_CONFIGURED';
    throw error;
  }

  const config = refreshConfig(account.provider);
  if (!config) {
    const error = new Error('Rafraîchissement programmatique non activé pour ce fournisseur.');
    error.code = 'PUBLISYA_REFRESH_UNSUPPORTED_PROVIDER';
    throw error;
  }

  let refreshToken;
  try {
    refreshToken = refreshTokenFor(account);
  } catch {
    const error = new Error('Le refresh token chiffré ne correspond pas à ce compte.');
    error.code = 'PUBLISYA_REFRESH_DECRYPT_FAILED';
    throw error;
  }
  if (!refreshToken) {
    const error = new Error('Aucun refresh token n’a été délivré pour cette connexion. Une nouvelle autorisation est requise.');
    error.code = 'PUBLISYA_REFRESH_TOKEN_MISSING';
    throw error;
  }

  let tokenBody;
  try {
    tokenBody = await providerTokenRequest(config, refreshToken);
  } catch (error) {
    if (error.code === 'PUBLISYA_REFRESH_PROVIDER_REJECTED' && ['invalid_grant', 'invalid_request'].includes(error.providerCode)) {
      await markReconnectRequired(account, error.providerCode);
    }
    throw error;
  }

  const identityMatches = await verifyRefreshedIdentity(account, tokenBody);
  if (!identityMatches) {
    const error = new Error('Le nouveau jeton ne correspond pas au compte social attendu.');
    error.code = 'PUBLISYA_REFRESH_IDENTITY_MISMATCH';
    throw error;
  }

  return persistRefresh(account, tokenBody, refreshToken);
}

router.post('/accounts/:accountId/refresh', async (req, res) => {
  const accountId = String(req.params.accountId || '');
  if (!UUID_RE.test(accountId)) return res.status(400).json({ error: 'Identifiant de connexion invalide.' });

  const { tenantId, clientId } = context(req);
  const lockKey = `${tenantId}:${clientId}:${accountId}`;
  if (refreshInFlight.has(lockKey)) {
    return res.status(409).json({ error: 'Un rafraîchissement est déjà en cours pour ce compte.', code: 'PUBLISYA_REFRESH_ALREADY_RUNNING' });
  }

  const operation = refreshAccount(req, accountId);
  refreshInFlight.set(lockKey, operation);
  try {
    const account = await operation;
    return res.json({
      success: true,
      account: safeRefreshAccount(account),
      automatic_refresh_enabled: false,
      publishing_enabled: false,
    });
  } catch (error) {
    const known = new Set([
      'PUBLISYA_REFRESH_ACCOUNT_NOT_FOUND',
      'PUBLISYA_REFRESH_STATE_INVALID',
      'PUBLISYA_TOKEN_VAULT_NOT_CONFIGURED',
      'PUBLISYA_REFRESH_UNSUPPORTED_PROVIDER',
      'PUBLISYA_REFRESH_DECRYPT_FAILED',
      'PUBLISYA_REFRESH_TOKEN_MISSING',
      'PUBLISYA_REFRESH_PROVIDER_NOT_CONFIGURED',
      'PUBLISYA_REFRESH_PROVIDER_REJECTED',
      'PUBLISYA_REFRESH_IDENTITY_MISMATCH',
      'PUBLISYA_REFRESH_TOKEN_LOST',
      'PUBLISYA_DATABASE_NOT_CONFIGURED',
    ]);
    const code = known.has(error.code) ? error.code : 'PUBLISYA_REFRESH_FAILED';
    console.error('[publisya token lifecycle] refresh:', accountId, code);
    const status = code === 'PUBLISYA_REFRESH_ACCOUNT_NOT_FOUND' ? 404
      : code === 'PUBLISYA_DATABASE_NOT_CONFIGURED' ? 503
        : code === 'PUBLISYA_REFRESH_PROVIDER_NOT_CONFIGURED' || code === 'PUBLISYA_TOKEN_VAULT_NOT_CONFIGURED' ? 503
          : code === 'PUBLISYA_REFRESH_PROVIDER_REJECTED' || code === 'PUBLISYA_REFRESH_IDENTITY_MISMATCH' ? 409
            : 400;
    return res.status(status).json({ error: error.message, code });
  } finally {
    refreshInFlight.delete(lockKey);
  }
});

module.exports = {
  router,
  refreshConfig,
  expiresAt,
  refreshExpirySeconds,
  safeRefreshAccount,
  refreshAccount,
};
