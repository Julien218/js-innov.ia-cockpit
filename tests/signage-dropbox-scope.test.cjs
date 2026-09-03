/**
 * Tests : server-signage-dropbox-scope.cjs
 * 
 * Vérifie :
 * - Normalisation de la racine Signage
 * - Présence/absence de l'en-tête Dropbox-API-Path-Root selon namespace_id
 * - Exclusion de l'en-tête sur les appels OAuth
 */

const assert = require('assert');

describe('server-signage-dropbox-scope.cjs', () => {
  let scope;

  beforeEach(() => {
    // Réinitialiser require() cache pour chaque test (simule des env vars différentes)
    delete require.cache[require.resolve('../server-signage-dropbox-scope.cjs')];
  });

  it('normalizeePath() supprime les trailing slashes', () => {
    scope = require('../server-signage-dropbox-scope.cjs');
    assert.strictEqual(scope.normalizePath('/Cockpit/'), '/Cockpit');
    assert.strictEqual(scope.normalizePath('/Cockpit'), '/Cockpit');
    assert.strictEqual(scope.normalizePath(''), '');
  });

  it('getSignageRoot() retourne la racine normalisée avec fallbacks', () => {
    // Test avec SIGNAGE_DROPBOX_ROOT_PATH défini
    process.env.SIGNAGE_DROPBOX_ROOT_PATH = '/Custom/Root/';
    delete require.cache[require.resolve('../server-signage-dropbox-scope.cjs')];
    scope = require('../server-signage-dropbox-scope.cjs');
    assert.strictEqual(scope.getSignageRoot(), '/Custom/Root');

    // Test avec fallback à DROPBOX_ROOT_PATH
    delete process.env.SIGNAGE_DROPBOX_ROOT_PATH;
    process.env.DROPBOX_ROOT_PATH = '/Cockpit/';
    delete require.cache[require.resolve('../server-signage-dropbox-scope.cjs')];
    scope = require('../server-signage-dropbox-scope.cjs');
    assert.strictEqual(scope.getSignageRoot(), '/Cockpit');

    // Test avec fallback au défaut
    delete process.env.DROPBOX_ROOT_PATH;
    delete require.cache[require.resolve('../server-signage-dropbox-scope.cjs')];
    scope = require('../server-signage-dropbox-scope.cjs');
    assert.strictEqual(scope.getSignageRoot(), '/Clients');
  });

  it('addPathRootHeader() ajoute l\'en-tête quand namespace_id est défini', () => {
    process.env.SIGNAGE_DROPBOX_NAMESPACE_ID = 'test-namespace-123';
    delete require.cache[require.resolve('../server-signage-dropbox-scope.cjs')];
    scope = require('../server-signage-dropbox-scope.cjs');

    const headers = scope.addPathRootHeader({}, 'https://api.dropboxapi.com/2/files/get_metadata');
    assert(headers['Dropbox-API-Path-Root']);
    const pathRoot = JSON.parse(headers['Dropbox-API-Path-Root']);
    assert.strictEqual(pathRoot['.tag'], 'namespace_id');
    assert.strictEqual(pathRoot.namespace_id, 'test-namespace-123');
  });

  it('addPathRootHeader() n\'ajoute pas l\'en-tête si namespace_id est vide', () => {
    process.env.SIGNAGE_DROPBOX_NAMESPACE_ID = '';
    delete require.cache[require.resolve('../server-signage-dropbox-scope.cjs')];
    scope = require('../server-signage-dropbox-scope.cjs');

    const headers = scope.addPathRootHeader({}, 'https://api.dropboxapi.com/2/files/get_metadata');
    assert.strictEqual(headers['Dropbox-API-Path-Root'], undefined);
  });

  it('addPathRootHeader() exclut l\'en-tête sur les appels OAuth token', () => {
    process.env.SIGNAGE_DROPBOX_NAMESPACE_ID = 'test-namespace-123';
    delete require.cache[require.resolve('../server-signage-dropbox-scope.cjs')];
    scope = require('../server-signage-dropbox-scope.cjs');

    const headers = scope.addPathRootHeader({}, 'https://api.dropboxapi.com/oauth2/token');
    assert.strictEqual(headers['Dropbox-API-Path-Root'], undefined);
  });

  it('addPathRootHeader() préserve les headers existants', () => {
    process.env.SIGNAGE_DROPBOX_NAMESPACE_ID = 'test-ns';
    delete require.cache[require.resolve('../server-signage-dropbox-scope.cjs')];
    scope = require('../server-signage-dropbox-scope.cjs');

    const existingHeaders = { Authorization: 'Bearer token', 'X-Custom': 'value' };
    const headers = scope.addPathRootHeader(existingHeaders, 'https://api.dropboxapi.com/2/files/delete_v2');
    assert.strictEqual(headers.Authorization, 'Bearer token');
    assert.strictEqual(headers['X-Custom'], 'value');
    assert(headers['Dropbox-API-Path-Root']);
  });
});

