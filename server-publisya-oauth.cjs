const express = require('express');
const { resolveTenant } = require('./server-tenant.cjs');
const tokenVault = require('./server-publisya-token-vault.cjs');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PROVIDER_IDS = Object.freeze(['meta', 'tiktok', 'linkedin', 'youtube']);
const PROVIDER_SET = new Set(PROVIDER_IDS);
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 15_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function env(name) {
  return String(process.env[name] || '').trim();
}

function scopesFrom(value) {
  return [...new Set(String(value || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

function requestContext(req) {
  const tenantId = resolveTenant(req);
  return {
    tenantId,
    clientId: tenantId,
    actor: String(req.user?.id || req.user?.email || 'unknown').slice(0, 200),
  };
}

function appBaseUrl(req) {
  const configured = env('PUBLIC_BASE_URL').replace(/\/+$/g, '');
  if (configured && /^https:\/\//i.test(configured)) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

function redirectUri(req, provider) {
  const explicit = env(`PUBLISYA_${provider.toUpperCase()}_REDIRECT_URI`);
  return explicit || `${appBaseUrl(req)}/api/publisya/oauth/${provider}/callback`;
}

function validMetaVersion(value) {
  return /^v\d+\.\d+$/.test(String(value || '').trim());
}

function providerConfig(provider, req = null) {
  const id = String(provider || '').trim().toLowerCase();
  if (!PROVIDER_SET.has(id)) return null;
  const redirect = req ? redirectUri(req, id) : env(`PUBLISYA_${id.toUpperCase()}_REDIRECT_URI`);

  if (id === 'meta') {
    const version = env('PUBLISYA_META_GRAPH_VERSION');
    const scopes = scopesFrom(env('PUBLISYA_META_SCOPES'));
    const clientId = env('PUBLISYA_META_APP_ID');
    const clientSecret = env('PUBLISYA_META_APP_SECRET');
    const versionReady = validMetaVersion(version);
    return {
      id,
      label: 'Facebook + Instagram',
      clientId,
      clientSecret,
      scopes,
      redirectUri: redirect,
      authorizeUrl: versionReady ? `https://www.facebook.com/${version}/dialog/oauth` : null,
      tokenUrl: versionReady ? `https://graph.facebook.com/${version}/oauth/access_token` : null,
      apiBaseUrl: versionReady ? `https://graph.facebook.com/${version}` : null,
      graphVersion: version,
      requirements: {
        client_id: Boolean(clientId),
        client_secret: Boolean(clientSecret),
        scopes: scopes.length > 0,
        redirect_uri: Boolean(redirect),
        graph_version: versionReady,
      },
    };
  }

  if (id === 'tiktok') {
    const clientId = env('PUBLISYA_TIKTOK_CLIENT_KEY');
    const clientSecret = env('PUBLISYA_TIKTOK_CLIENT_SECRET');
    const scopes = scopesFrom(env('PUBLISYA_TIKTOK_SCOPES'));
    return {
      id,
      label: 'TikTok',
      clientId,
      clientSecret,
      scopes,
      redirectUri: redirect,
      authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
      tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
      requirements: {
        client_id: Boolean(clientId),
        client_secret: Boolean(clientSecret),
        scopes: scopes.length > 0,
        redirect_uri: Boolean(redirect),
      },
    };
  }

  if (id === 'linkedin') {
    const clientId = env('PUBLISYA_LINKEDIN_CLIENT_ID');
    const clientSecret = env('PUBLISYA_LINKEDIN_CLIENT_SECRET');
    const scopes = scopesFrom(env('PUBLISYA_LINKEDIN_SCOPES'));
    return {
      id,
      label: 'LinkedIn',
      clientId,
      clientSecret,
      scopes,
      redirectUri: redirect,
      authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
      tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
      requirements: {
        client_id: Boolean(clientId),
        client_secret: Boolean(clientSecret),
        scopes: scopes.length > 0,
        redirect_uri: Boolean(redirect),
      },
    };
  }

  const clientId = env('PUBLISYA_YOUTUBE_CLIENT_ID');
  const clientSecret = env('PUBLISYA_YOUTUBE_CLIENT_SECRET');
  const scopes = scopesFrom(env('PUBLISYA_YOUTUBE_SCOPES'));
  return {
    id,
    label: 'YouTube',
    clientId,
    clientSecret,
    scopes,
    redirectUri: redirect,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    requirements: {
      client_id: Boolean(clientId),
      client_secret: Boolean(clientSecret),
      scopes: scopes.length > 0,
      redirect_uri: Boolean(redirect),
    },
  };
}

function providerConfigured(config) {
  return Boolean(config && Object.values(config.requirements || {}).every(Boolean));
}

function publicProviderConfig(config) {
  return {
    id: config.id,
    label: config.label,
    configured: providerConfigured(config),
    ready: providerConfigured(config) && tokenVault.isConfigured() && Boolean(SUPABASE_SECRET),
    scopes: config.scopes,
    redirect_uri: config.redirectUri || null,
    requirements: config.requirements,
  };
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
    const error = new Error(`Publisya OAuth storage HTTP ${response.status}`);
    error.status = response.status;
    error.body = typeof body === 'string' ? body.slice(0, 220) : JSON.stringify(body).slice(0, 220);
    throw error;
  }
  return body;
}

function oauthSchemaNotReady(error) {
  const text = `${error?.body || ''} ${error?.message || ''}`;
  return error?.code === 'PUBLISYA_DATABASE_NOT_CONFIGURED'
    || error?.status === 404
    || /PGRST205|publisya_oauth_states|publisya_social_accounts|relation .* does not exist/i.test(text);
}

async function oauthStoreReady() {
  try {
    await Promise.all([
      supabaseRequest('publisya_social_accounts?select=id&limit=1'),
      supabaseRequest('publisya_oauth_states?select=state_hash&limit=1'),
    ]);
    return true;
  } catch {
    return false;
  }
}

function safeAccount(account) {
  return {
    id: account.id,
    provider: account.provider,
    provider_account_id: account.provider_account_id,
    account_name: account.account_name,
    account_type: account.account_type,
    connection_status: account.connection_status,
    scopes: Array.isArray(account.scopes) ? account.scopes : [],
    capabilities: account.capabilities || {},
    token_expires_at: account.token_expires_at,
    last_verified_at: account.last_verified_at,
    connected_by: account.connected_by,
    disconnected_at: account.disconnected_at,
    metadata: account.metadata || {},
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
}

async function accountsFor(req) {
  const { tenantId, clientId } = requestContext(req);
  return supabaseRequest(
    `publisya_social_accounts?select=id,provider,provider_account_id,account_name,account_type,connection_status,scopes,capabilities,token_expires_at,last_verified_at,connected_by,disconnected_at,metadata,created_at,updated_at&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}&order=updated_at.desc`,
  );
}

async function createState(req, provider) {
  const { tenantId, clientId, actor } = requestContext(req);
  const state = tokenVault.stateToken();
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();
  await supabaseRequest('publisya_oauth_states', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      state_hash: tokenVault.stateHash(state),
      tenant_id: tenantId,
      client_id: clientId,
      provider,
      return_path: '/publisya',
      created_by: actor,
      expires_at: expiresAt,
    }),
  });
  return state;
}

async function consumeState(req, provider, state) {
  const hash = tokenVault.stateHash(state);
  const { tenantId, clientId } = requestContext(req);
  const now = new Date().toISOString();
  const query = `state_hash=eq.${encodeURIComponent(hash)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}&provider=eq.${encodeURIComponent(provider)}&used_at=is.null&expires_at=gt.${encodeURIComponent(now)}`;
  const rows = await supabaseRequest(`publisya_oauth_states?select=state_hash,return_path,expires_at&${query}&limit=1`);
  if (!rows?.[0]) {
    const error = new Error('État OAuth expiré ou invalide.');
    error.code = 'PUBLISYA_OAUTH_STATE_INVALID';
    throw error;
  }
  const consumed = await supabaseRequest(`publisya_oauth_states?${query}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ used_at: now }),
  });
  if (!consumed?.[0]) {
    const error = new Error('État OAuth déjà utilisé.');
    error.code = 'PUBLISYA_OAUTH_STATE_REPLAY';
    throw error;
  }
  return rows[0];
}

function authorizationUrl(config, state) {
  const url = new URL(config.authorizeUrl);
  const params = new URLSearchParams();

  if (config.id === 'tiktok') {
    params.set('client_key', config.clientId);
    params.set('scope', config.scopes.join(','));
  } else {
    params.set('client_id', config.clientId);
    params.set('scope', config.id === 'meta' ? config.scopes.join(',') : config.scopes.join(' '));
  }
  params.set('redirect_uri', config.redirectUri);
  params.set('state', state);
  params.set('response_type', 'code');

  if (config.id === 'youtube') {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
    params.set('include_granted_scopes', 'true');
  }

  url.search = params.toString();
  return url.toString();
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function tokenRequest(config, code) {
  const params = new URLSearchParams({
    code,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });
  if (config.id === 'tiktok') {
    params.set('client_key', config.clientId);
    params.set('client_secret', config.clientSecret);
  } else {
    params.set('client_id', config.clientId);
    params.set('client_secret', config.clientSecret);
  }

  const response = await fetchWithTimeout(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    const error = new Error(`Échange OAuth ${config.id} refusé (${response.status}).`);
    error.code = 'PUBLISYA_OAUTH_TOKEN_EXCHANGE_FAILED';
    error.status = response.status;
    error.provider_code = String(body.error || body.error_code || '').slice(0, 80) || null;
    throw error;
  }
  return body;
}

async function bearerJson(url, accessToken, headers = {}) {
  const response = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Identité OAuth indisponible (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function resolveIdentity(config, accessToken) {
  if (config.id === 'meta') {
    const body = await bearerJson(`${config.apiBaseUrl}/me?fields=id,name`, accessToken);
    if (!body.id) throw new Error('Compte Meta non identifiable.');
    return { id: String(body.id), name: String(body.name || 'Compte Meta'), type: 'meta_user', source: 'graph_me' };
  }

  if (config.id === 'tiktok') {
    const body = await bearerJson('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', accessToken);
    const user = body?.data?.user || {};
    if (!user.open_id) throw new Error('Compte TikTok non identifiable.');
    return { id: String(user.open_id), name: String(user.display_name || 'Compte TikTok'), type: 'tiktok_user', source: 'user_info' };
  }

  if (config.id === 'linkedin') {
    try {
      const body = await bearerJson('https://api.linkedin.com/v2/userinfo', accessToken);
      if (body.sub) return { id: String(body.sub), name: String(body.name || `${body.given_name || ''} ${body.family_name || ''}`.trim() || 'Compte LinkedIn'), type: 'linkedin_member', source: 'oidc_userinfo' };
    } catch {
      // Fallback pour les applications disposant encore de r_liteprofile au lieu d'OpenID Connect.
    }
    const body = await bearerJson('https://api.linkedin.com/v2/me', accessToken, { 'X-Restli-Protocol-Version': '2.0.0' });
    if (!body.id) throw new Error('Compte LinkedIn non identifiable avec les scopes accordés.');
    const localized = body.localizedFirstName || body.localizedLastName
      ? `${body.localizedFirstName || ''} ${body.localizedLastName || ''}`.trim()
      : 'Compte LinkedIn';
    return { id: String(body.id), name: localized, type: 'linkedin_member', source: 'v2_me' };
  }

  const body = await bearerJson('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=1', accessToken);
  const channel = body?.items?.[0];
  if (!channel?.id) throw new Error('Aucune chaîne YouTube accessible avec ce compte.');
  return { id: String(channel.id), name: String(channel.snippet?.title || 'Chaîne YouTube'), type: 'youtube_channel', source: 'channels_mine' };
}

function grantedScopes(config, tokenBody) {
  const raw = tokenBody.scope || tokenBody.scopes || '';
  const parsed = scopesFrom(Array.isArray(raw) ? raw.join(' ') : raw);
  return parsed.length ? parsed : config.scopes;
}

async function saveConnection(req, config, tokenBody, identity) {
  const { tenantId, clientId, actor } = requestContext(req);
  const accessAad = `${tenantId}:${clientId}:${config.id}:${identity.id}:access`;
  const refreshAad = `${tenantId}:${clientId}:${config.id}:${identity.id}:refresh`;
  const expiresIn = Number(tokenBody.expires_in || 0);
  const now = new Date();
  const tokenExpiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(now.getTime() + expiresIn * 1000).toISOString()
    : null;
  const scopes = grantedScopes(config, tokenBody);
  const payload = {
    tenant_id: tenantId,
    client_id: clientId,
    provider: config.id,
    provider_account_id: identity.id,
    account_name: identity.name,
    account_type: identity.type,
    connection_status: 'connected',
    scopes,
    capabilities: {
      oauth_connected: true,
      identity_verified: true,
      direct_publish: false,
      scheduling: false,
      meta_page_selection_required: config.id === 'meta',
    },
    token_ciphertext: tokenVault.encrypt(tokenBody.access_token, accessAad),
    refresh_token_ciphertext: tokenBody.refresh_token ? tokenVault.encrypt(tokenBody.refresh_token, refreshAad) : null,
    token_expires_at: tokenExpiresAt,
    last_verified_at: now.toISOString(),
    connected_by: actor,
    disconnected_at: null,
    metadata: {
      identity_source: identity.source,
      token_fingerprint: tokenVault.safeFingerprint(tokenBody.access_token),
      refresh_token_present: Boolean(tokenBody.refresh_token),
      connection_only: true,
    },
  };

  const rows = await supabaseRequest('publisya_social_accounts?on_conflict=tenant_id,client_id,provider,provider_account_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(payload),
  });
  return rows?.[0] || payload;
}

function callbackReturn(req, provider, status, code = null) {
  const url = new URL('/publisya', appBaseUrl(req));
  url.searchParams.set('oauth', provider);
  url.searchParams.set('oauth_status', status);
  if (code) url.searchParams.set('oauth_code', String(code).slice(0, 80));
  return url.pathname + url.search;
}

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});

router.get('/status', async (req, res) => {
  const configs = PROVIDER_IDS.map((provider) => providerConfig(provider, req));
  let accounts = [];
  let databaseReady = false;
  try {
    databaseReady = await oauthStoreReady();
    if (databaseReady) accounts = (await accountsFor(req)).map(safeAccount);
  } catch {
    databaseReady = false;
  }
  res.json({
    success: true,
    publishing_enabled: false,
    scheduling_enabled: false,
    vault_configured: tokenVault.isConfigured(),
    database_ready: databaseReady,
    providers: configs.map(publicProviderConfig),
    accounts,
  });
});

router.get('/start/:provider', async (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  const config = providerConfig(provider, req);
  if (!config) return res.status(404).json({ error: 'Connecteur Publisya inconnu.' });
  if (!providerConfigured(config)) return res.status(503).json({ error: `Le connecteur ${config.label} n’est pas encore configuré côté serveur.`, code: 'PUBLISYA_OAUTH_PROVIDER_NOT_CONFIGURED' });
  if (!tokenVault.isConfigured()) return res.status(503).json({ error: 'Le coffre de jetons Publisya n’est pas configuré.', code: 'PUBLISYA_TOKEN_VAULT_NOT_CONFIGURED' });
  if (!(await oauthStoreReady())) return res.status(503).json({ error: 'Le stockage OAuth Publisya doit encore être initialisé.', code: 'PUBLISYA_OAUTH_SCHEMA_NOT_READY' });

  try {
    const state = await createState(req, provider);
    return res.redirect(authorizationUrl(config, state));
  } catch (error) {
    console.error('[publisya oauth] start:', error.code || error.message);
    return res.status(503).json({ error: 'Impossible de démarrer cette connexion pour le moment.', code: oauthSchemaNotReady(error) ? 'PUBLISYA_OAUTH_SCHEMA_NOT_READY' : 'PUBLISYA_OAUTH_START_FAILED' });
  }
});

router.get('/:provider/callback', async (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  const config = providerConfig(provider, req);
  if (!config) return res.redirect(callbackReturn(req, provider || 'unknown', 'error', 'PUBLISYA_OAUTH_PROVIDER_UNKNOWN'));

  try {
    if (!providerConfigured(config) || !tokenVault.isConfigured()) {
      const error = new Error('Configuration OAuth incomplète.');
      error.code = 'PUBLISYA_OAUTH_NOT_CONFIGURED';
      throw error;
    }
    if (req.query.error) {
      const error = new Error('Autorisation refusée par le fournisseur.');
      error.code = 'PUBLISYA_OAUTH_DENIED';
      throw error;
    }
    const code = String(req.query.code || '').trim();
    const state = String(req.query.state || '').trim();
    if (!code || !state) {
      const error = new Error('Réponse OAuth incomplète.');
      error.code = 'PUBLISYA_OAUTH_CALLBACK_INVALID';
      throw error;
    }

    await consumeState(req, provider, state);
    const tokens = await tokenRequest(config, code);
    const identity = await resolveIdentity(config, tokens.access_token);
    await saveConnection(req, config, tokens, identity);
    return res.redirect(callbackReturn(req, provider, 'connected'));
  } catch (error) {
    console.error('[publisya oauth] callback:', provider, error.code || `HTTP_${error.status || 'ERR'}`);
    const safeCode = error.code || (oauthSchemaNotReady(error) ? 'PUBLISYA_OAUTH_SCHEMA_NOT_READY' : 'PUBLISYA_OAUTH_CALLBACK_FAILED');
    return res.redirect(callbackReturn(req, provider, 'error', safeCode));
  }
});

router.delete('/accounts/:accountId', async (req, res) => {
  const accountId = String(req.params.accountId || '');
  if (!UUID_RE.test(accountId)) return res.status(400).json({ error: 'Identifiant de connexion invalide.' });
  const { tenantId, clientId } = requestContext(req);
  try {
    const rows = await supabaseRequest(
      `publisya_social_accounts?select=id,provider,metadata&id=eq.${encodeURIComponent(accountId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}&limit=1`,
    );
    if (!rows?.[0]) return res.status(404).json({ error: 'Connexion Publisya introuvable.' });
    const metadata = { ...(rows[0].metadata || {}), local_tokens_removed_at: new Date().toISOString(), provider_revocation_required: true };
    const updated = await supabaseRequest(
      `publisya_social_accounts?id=eq.${encodeURIComponent(accountId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          connection_status: 'revoked',
          token_ciphertext: null,
          refresh_token_ciphertext: null,
          token_expires_at: null,
          disconnected_at: new Date().toISOString(),
          metadata,
        }),
      },
    );
    return res.json({ success: true, account: safeAccount(updated?.[0] || rows[0]), provider_revoked: false });
  } catch (error) {
    console.error('[publisya oauth] disconnect:', error.code || error.message);
    return res.status(oauthSchemaNotReady(error) ? 503 : 500).json({ error: oauthSchemaNotReady(error) ? 'Le stockage OAuth Publisya doit encore être initialisé.' : 'Impossible de retirer cette connexion.' });
  }
});

module.exports = {
  router,
  PROVIDER_IDS,
  OAUTH_STATE_TTL_MS,
  providerConfig,
  providerConfigured,
  publicProviderConfig,
  authorizationUrl,
  oauthSchemaNotReady,
};
