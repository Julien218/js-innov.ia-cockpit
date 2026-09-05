const express = require('express');
const { resolveTenant } = require('./server-tenant.cjs');
const tokenVault = require('./server-publisya-token-vault.cjs');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PROVIDER_TIMEOUT_MS = 12_000;
const LINKEDIN_VERSION_RE = /^20\d{4}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function context(req) {
  const tenantId = resolveTenant(req);
  return { tenantId, clientId: tenantId };
}

function env(name) {
  return String(process.env[name] || '').trim();
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
    const error = new Error(`Publisya target storage HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function accountFor(req, accountId) {
  if (!UUID_RE.test(String(accountId || ''))) return null;
  const { tenantId, clientId } = context(req);
  const rows = await supabaseRequest(
    `publisya_social_accounts?select=id,tenant_id,client_id,provider,provider_account_id,account_name,account_type,connection_status,scopes,token_ciphertext,token_expires_at,metadata&id=eq.${encodeURIComponent(accountId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}&connection_status=eq.connected&limit=1`,
  );
  return rows?.[0] || null;
}

function accessTokenFor(account) {
  const aad = `${account.tenant_id}:${account.client_id}:${account.provider}:${account.provider_account_id}:access`;
  return tokenVault.decrypt(account.token_ciphertext, aad);
}

async function bearerJson(url, accessToken, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Provider verification HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function baseResult(account) {
  return {
    account_id: account.id,
    provider: account.provider,
    account_name: account.account_name,
    verified: false,
    token_valid: false,
    publish_ready: false,
    publishing_enabled: false,
    targets: [],
    notes: [],
  };
}

function tokenAlreadyExpired(account) {
  const value = Date.parse(String(account.token_expires_at || ''));
  return Number.isFinite(value) && value <= Date.now();
}

async function verifyTikTok(account, accessToken) {
  const result = baseResult(account);
  const body = await bearerJson(
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',
    accessToken,
  );
  const user = body?.data?.user || {};
  if (!user.open_id || String(user.open_id) !== String(account.provider_account_id)) {
    result.notes.push('L’identité TikTok retournée ne correspond pas au compte enregistré.');
    return result;
  }
  result.verified = true;
  result.token_valid = true;
  result.targets.push({
    target_id: String(user.open_id),
    target_type: 'profile',
    display_name: String(user.display_name || account.account_name || 'Compte TikTok'),
    identity_verified: true,
    permission_verified: false,
  });
  result.notes.push('Profil TikTok relu avec succès. Les droits de publication ne sont pas testés dans ce lot.');
  return result;
}

async function verifyYouTube(account, accessToken) {
  const result = baseResult(account);
  const body = await bearerJson(
    'https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=1',
    accessToken,
  );
  const channel = body?.items?.[0];
  if (!channel?.id || String(channel.id) !== String(account.provider_account_id)) {
    result.notes.push('La chaîne YouTube retournée ne correspond pas au compte enregistré.');
    return result;
  }
  result.verified = true;
  result.token_valid = true;
  result.targets.push({
    target_id: String(channel.id),
    target_type: 'channel',
    display_name: String(channel.snippet?.title || account.account_name || 'Chaîne YouTube'),
    identity_verified: true,
    permission_verified: false,
  });
  result.notes.push('Chaîne YouTube relue avec succès. Les droits d’upload ne sont pas testés dans ce lot.');
  return result;
}

function linkedInOrganizationUrn(element) {
  return String(element?.organizationTarget || element?.organization || '').trim();
}

async function verifyLinkedInIdentity(account, accessToken) {
  const source = String(account.metadata?.identity_source || '');
  if (source === 'v2_me') {
    const body = await bearerJson(
      'https://api.linkedin.com/v2/me',
      accessToken,
      { 'X-Restli-Protocol-Version': '2.0.0' },
    );
    return {
      id: String(body?.id || ''),
      name: String(`${body?.localizedFirstName || ''} ${body?.localizedLastName || ''}`.trim() || account.account_name || 'Compte LinkedIn'),
      source: 'v2_me',
    };
  }
  const body = await bearerJson('https://api.linkedin.com/v2/userinfo', accessToken);
  return {
    id: String(body?.sub || ''),
    name: String(body?.name || account.account_name || 'Compte LinkedIn'),
    source: 'oidc_userinfo',
  };
}

async function verifyLinkedIn(account, accessToken) {
  const result = baseResult(account);
  const identity = await verifyLinkedInIdentity(account, accessToken);
  if (!identity.id || identity.id !== String(account.provider_account_id)) {
    result.notes.push('L’identité LinkedIn retournée ne correspond pas au compte enregistré.');
    return result;
  }

  result.verified = true;
  result.token_valid = true;
  result.targets.push({
    target_id: identity.id,
    target_type: 'member_identity',
    display_name: identity.name,
    identity_verified: true,
    permission_verified: false,
  });

  const scopes = new Set(Array.isArray(account.scopes) ? account.scopes : []);
  const canReadOrganizations = scopes.has('r_organization_admin') || scopes.has('rw_organization_admin');
  const version = env('PUBLISYA_LINKEDIN_VERSION');
  if (!canReadOrganizations) {
    result.notes.push('Membre LinkedIn relu avec succès. Aucun scope d’administration d’organisation n’est présent.');
    return result;
  }
  if (!LINKEDIN_VERSION_RE.test(version)) {
    result.notes.push('Membre LinkedIn relu avec succès. PUBLISYA_LINKEDIN_VERSION doit être configurée au format YYYYMM avant de relire les organisations.');
    return result;
  }

  const body = await bearerJson(
    'https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&state=APPROVED',
    accessToken,
    {
      'X-Restli-Protocol-Version': '2.0.0',
      'Linkedin-Version': version,
      'Content-Type': 'application/json',
    },
  );
  const seen = new Set();
  for (const element of Array.isArray(body?.elements) ? body.elements : []) {
    const urn = linkedInOrganizationUrn(element);
    if (!urn || seen.has(urn)) continue;
    seen.add(urn);
    result.targets.push({
      target_id: urn,
      target_type: 'organization',
      display_name: urn,
      identity_verified: true,
      permission_verified: false,
      observed_role: String(element.role || '').trim() || null,
      observed_state: String(element.state || '').trim() || null,
    });
  }
  result.notes.push(`${seen.size} organisation(s) LinkedIn accessible(s) détectée(s). Une autorisation de publication devra encore être vérifiée avant tout envoi.`);
  return result;
}

async function verifyMeta(account) {
  const result = baseResult(account);
  result.notes.push('Connexion Meta enregistrée. La sélection Page Facebook / compte Instagram professionnel reste volontairement verrouillée tant que le contrat de découverte Meta n’est pas validé.');
  return result;
}

async function verifyAccount(account) {
  const result = baseResult(account);
  if (!tokenVault.isConfigured()) {
    result.notes.push('Coffre de jetons non configuré.');
    return result;
  }
  if (!account.token_ciphertext) {
    result.notes.push('Aucun jeton chiffré disponible.');
    return result;
  }
  if (tokenAlreadyExpired(account)) {
    result.notes.push('Le jeton enregistré est arrivé à expiration. Aucun rafraîchissement automatique n’est activé dans ce lot.');
    return result;
  }

  let token;
  try {
    token = accessTokenFor(account);
  } catch {
    result.notes.push('Le jeton chiffré ne peut pas être ouvert avec le contexte de ce compte.');
    return result;
  }

  try {
    if (account.provider === 'tiktok') return await verifyTikTok(account, token);
    if (account.provider === 'youtube') return await verifyYouTube(account, token);
    if (account.provider === 'linkedin') return await verifyLinkedIn(account, token);
    if (account.provider === 'meta') return await verifyMeta(account);
    result.notes.push('Fournisseur non pris en charge.');
    return result;
  } catch (error) {
    result.notes.push(error?.status === 401 || error?.status === 403
      ? 'Le fournisseur refuse ce jeton ou les permissions demandées.'
      : 'La vérification distante n’a pas abouti.');
    return result;
  }
}

router.get('/accounts/:accountId', async (req, res) => {
  const accountId = String(req.params.accountId || '');
  if (!UUID_RE.test(accountId)) return res.status(400).json({ error: 'Identifiant de connexion invalide.' });
  try {
    const account = await accountFor(req, accountId);
    if (!account) return res.status(404).json({ error: 'Connexion Publisya introuvable.' });
    const verification = await verifyAccount(account);
    return res.json({ success: true, verification });
  } catch (error) {
    console.error('[publisya targets] verify:', error.code || error.message);
    return res.status(error.code === 'PUBLISYA_DATABASE_NOT_CONFIGURED' ? 503 : 500).json({
      error: error.code === 'PUBLISYA_DATABASE_NOT_CONFIGURED'
        ? 'Le stockage Publisya n’est pas configuré.'
        : 'Impossible de vérifier les cibles de ce compte.',
    });
  }
});

module.exports = {
  router,
  LINKEDIN_VERSION_RE,
  tokenAlreadyExpired,
  linkedInOrganizationUrn,
  verifyLinkedInIdentity,
  verifyAccount,
};
