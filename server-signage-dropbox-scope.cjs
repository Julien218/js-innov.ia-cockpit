/**
 * server-signage-dropbox-scope.cjs
 *
 * Gestion centralisée du scope Dropbox pour Digital Signage.
 * - Normalise la racine Signage (SIGNAGE_DROPBOX_ROOT_PATH avec fallbacks)
 * - Ajoute l'en-tête Dropbox-API-Path-Root avec namespace_id UNIQUEMENT sur api.dropboxapi.com et content.dropboxapi.com
 * - NE modifie PAS l'authentification OAuth ni les appels externes
 */

/**
 * Normalise un chemin Dropbox de façon robuste
 * - Trim
 * - Convertit les backslashes en slashes
 * - Remplace les slashes multiples par un seul
 * - Ajoute préfixe `/` si absent
 * - Supprime trailing slash sauf pour `/` uniquement
 */
function normalizePath(path) {
  let result = String(path || '').trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');

  if (!result.startsWith('/')) {
    result = '/' + result;
  }

  if (result !== '/' && result.endsWith('/')) {
    result = result.slice(0, -1);
  }

  return result;
}

const SIGNAGE_ROOT_PATH = process.env.SIGNAGE_DROPBOX_ROOT_PATH || process.env.DROPBOX_ROOT_PATH || '/Clients';
const SIGNAGE_ROOT = normalizePath(SIGNAGE_ROOT_PATH);
const SIGNAGE_NAMESPACE_ID = (process.env.SIGNAGE_DROPBOX_NAMESPACE_ID || '').trim();

/**
 * Retourne la racine Signage normalisée
 */
function getSignageRoot() {
  return SIGNAGE_ROOT;
}

/**
 * Ajoute l'en-tête Dropbox-API-Path-Root UNIQUEMENT pour api.dropboxapi.com et content.dropboxapi.com
 * Ne l'ajoute PAS pour OAuth token ni URL externe
 *
 * @param {Object} headers - objet headers existant
 * @param {string} endpoint - l'URL complète de l'appel (détecte domaine et path)
 * @returns {Object} headers modifiés ou originaux
 */
function addPathRootHeader(headers = {}, endpoint = '') {
  const result = { ...headers };

  // Vérifier que c'est un appel Dropbox FILES (pas OAuth, pas externe)
  const isDropboxFilesApi =
    (endpoint.includes('api.dropboxapi.com/') || endpoint.includes('content.dropboxapi.com/')) &&
    !endpoint.includes('/oauth2/');

  if (!isDropboxFilesApi) {
    return result;
  }

  // Ajouter Path-Root si namespace_id est défini
  if (SIGNAGE_NAMESPACE_ID) {
    result['Dropbox-API-Path-Root'] = JSON.stringify({
      ".tag": "namespace_id",
      "namespace_id": SIGNAGE_NAMESPACE_ID
    });
  }

  return result;
}

/**
 * Wrapper pour fetch() qui injecte l'en-tête Path-Root automatiquement
 * @param {string} url - l'URL de l'appel
 * @param {Object} init - options fetch()
 * @returns {Promise<Response>}
 */
async function fetchWithPathRoot(url, init = {}) {
  const headers = addPathRootHeader(init.headers || {}, url);
  return fetch(url, { ...init, headers });
}

module.exports = {
  getSignageRoot,
  normalizePath,
  addPathRootHeader,
  fetchWithPathRoot,
  SIGNAGE_NAMESPACE_ID
};

