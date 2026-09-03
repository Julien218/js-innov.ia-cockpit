/**
 * server-signage-dropbox-scope.cjs
 * 
 * Gestion centralisée du scope Dropbox pour Digital Signage.
 * - Normalise la racine Signage (SIGNAGE_DROPBOX_ROOT_PATH avec fallbacks)
 * - Ajoute l'en-tête Dropbox-API-Path-Root avec namespace_id quand configuré
 * - NE modifie PAS l'authentification OAuth
 */

const SIGNAGE_ROOT = (process.env.SIGNAGE_DROPBOX_ROOT_PATH || process.env.DROPBOX_ROOT_PATH || '/Clients').replace(/\/$/, '');
const SIGNAGE_NAMESPACE_ID = (process.env.SIGNAGE_DROPBOX_NAMESPACE_ID || '').trim();

/**
 * Normalise un chemin Dropbox : supprime trailing slash, normalise les barres
 */
function normalizePath(path) {
  return String(path || '').trim().replace(/\/$/, '').replace(/\\\\/g, '/');
}

/**
 * Retourne la racine Signage normalisée
 */
function getSignageRoot() {
  return SIGNAGE_ROOT;
}

/**
 * Ajoute l'en-tête Dropbox-API-Path-Root pour tous les appels fichiers,
 * SAUF les appels OAuth token.
 * 
 * @param {Object} headers - objet headers existant
 * @param {string} endpoint - l'URL complète de l'appel (détecte /oauth2/token)
 * @returns {Object} headers modifiés
 */
function addPathRootHeader(headers = {}, endpoint = '') {
  const result = { ...headers };
  
  // Aucun en-tête Path-Root sur OAuth token
  if (endpoint.includes('/oauth2/token')) {
    return result;
  }
  
  // Ajoute Path-Root si namespace_id est défini
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
 * @param {string} url - l'URL de l'appel Dropbox
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

