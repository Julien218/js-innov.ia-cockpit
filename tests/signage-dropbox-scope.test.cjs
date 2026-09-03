/**
 * Tests : server-signage-dropbox-scope.cjs
 *
 * Vérifie :
 * - Normalisation robuste des chemins (trim, backslashes, slashes multiples, trailing slash)
 * - Présence/absence de l'en-tête Dropbox-API-Path-Root selon namespace_id
 * - Exclusion de l'en-tête sur OAuth et URL externes
 * - Préservation des headers existants
 */

const assert = require('assert');

describe('server-signage-dropbox-scope.cjs', () => {
  let scope;

  beforeEach(() => {
    delete require.cache[require.resolve('../server-signage-dropbox-scope.cjs')];
  });

  describe('normalizePath()', () => {
    beforeEach(() => {
      scope = require('../server-signage-dropbox-scope.cjs');
    });

    it('supprime les leading/trailing espaces', () => {
      assert.strictEqual(scope.normalizePath('  /Cockpit  '), '/Cockpit');
    });

    it('convertit les backslashes en slashes', () => {
      assert.strictEqual(scope.normalizePath('\\Cockpit\\Olivier'), '/Cockpit/Olivier');
    });

    it('remplace les slashes multiples par un seul', () => {
      assert.strictEqual(scope.normalizePath('/Cockpit///Olivier'), '/Cockpit/Olivier');
    });

    it('ajoute le préfixe / si absent', () => {
      assert.strictEqual(scope.normalizePath('Cockpit'), '/Cockpit');
    });

    it('supprime le trailing slash sauf pour /', () => {
      assert.strictEqual(scope.normalizePath('/Cockpit/'), '/Cockpit');
      assert.strictEqual(scope.normalizePath('/'), '/');
    });

    it('combine trim + backslash + slashes multiples + trailing slash', () => {
      assert.strictEqual(scope.normalizePath('  \\Cockpit\\\\Olivier\\  '), '/Cockpit/Olivier');
    });

    it('gère string vide en retournant /', () => {
      assert.strictEqual(scope.normalizePath(''), '/');
    });
  });

  describe('getSignageRoot()', () => {
    it('retourne la racine normalisée avec SIGNAGE_DROPBOX_ROOT_PATH', () => {
      process.env.SIGNAGE_DROPBOX_ROOT_PATH = '/Custom/Root/';
      delete require.cache[require.resolve('../server-signage-dropbox-scope.cjs')];
      scope = require('../server-signage-dropbox-scope.cjs');
      assert.strictEqual(scope.getSignageRoot(), '/Custom/Root');

      delete process.env.SIGNAGE_DROPBOX_ROOT_PATH;
    });

    it('fallback à DROPBOX_ROOT_PATH si SIGNAGE_DROPBOX_ROOT_PATH absent', () => {
      delete process.env.SIGNAGE_DROPBOX_ROOT_PATH;
      process.env.DROPBOX_ROOT_PATH = '/Cockpit/';
      delete require.cache[require.resolve('../server-signage-dropbox-scope.cjs')];
      scope = require('../server-signage-dropbox-scope.cjs');
      assert.strictEqual(scope.getSignageRoot(), '/Cockpit');

      delete process.env.DROPBOX_ROOT_PATH;
    });

    it('fallback au défaut /Clients si rien défini', () => {
      delete process.env.SIGNAGE_DROPBOX_ROOT_PATH;
      delete process.env.DROPBOX_ROOT_PATH;
      delete require.cache[require.resolve('../server-signage-dropbox-scope.cjs')];
      scope = require('../server-signage-dropbox-scope.cjs');
      assert.strictEqual(scope.getSignageRoot(), '/Clients');
    });
  });

  describe('addPathRootHeader()', () => {
    beforeEach(() => {
      process.env.SIGNAGE_DROPBOX_NAMESPACE_ID = 'test-namespace-123';
      delete require.cache[require.resolve('../server-signage-dropbox-scope.cjs')];
      scope = require('../server-signage-dropbox-scope.cjs');
    });

    afterEach(() => {
      delete process.env.SIGNAGE_DROPBOX_NAMESPACE_ID;
    });

    it('ajoute l\'en-tête pour api.dropboxapi.com/2/files/', () => {
      const headers = scope.addPathRootHeader({}, 'https://api.dropboxapi.com/2/files/get_metadata');
      assert(headers['Dropbox-API-Path-Root']);
      const pathRoot = JSON.parse(headers['Dropbox-API-Path-Root']);
      assert.strictEqual(pathRoot['.tag'], 'namespace_id');
      assert.strictEqual(pathRoot.namespace_id, 'test-namespace-123');
    });

    it('ajoute l\'en-tête pour content.dropboxapi.com/', () => {
      const headers = scope.addPathRootHeader({}, 'https://content.dropboxapi.com/2/files/upload');
      assert(headers['Dropbox-API-Path-Root']);
    });

    it('n\'ajoute PAS l\'en-tête pour /oauth2/token', () => {
      const headers = scope.addPathRootHeader({}, 'https://api.dropboxapi.com/oauth2/token');
      assert.strictEqual(headers['Dropbox-API-Path-Root'], undefined);
    });

    it('n\'ajoute PAS l\'en-tête pour URL externe non-Dropbox', () => {
      const headers = scope.addPathRootHeader({}, 'https://example.com/api');
      assert.strictEqual(headers['Dropbox-API-Path-Root'], undefined);
    });

    it('n\'ajoute pas l\'en-tête si namespace_id est vide', () => {
      process.env.SIGNAGE_DROPBOX_NAMESPACE_ID = '';
      delete require.cache[require.resolve('../server-signage-dropbox-scope.cjs')];
      scope = require('../server-signage-dropbox-scope.cjs');
      const headers = scope.addPathRootHeader({}, 'https://api.dropboxapi.com/2/files/get_metadata');
      assert.strictEqual(headers['Dropbox-API-Path-Root'], undefined);
    });

    it('préserve les headers existants et ajoute Path-Root', () => {
      const existingHeaders = { Authorization: 'Bearer token', 'X-Custom': 'value' };
      const headers = scope.addPathRootHeader(existingHeaders, 'https://api.dropboxapi.com/2/files/delete_v2');
      assert.strictEqual(headers.Authorization, 'Bearer token');
      assert.strictEqual(headers['X-Custom'], 'value');
      assert(headers['Dropbox-API-Path-Root']);
    });
  });

  describe('fetchWithPathRoot()', () => {
    beforeEach(() => {
      process.env.SIGNAGE_DROPBOX_NAMESPACE_ID = 'test-ns';
      delete require.cache[require.resolve('../server-signage-dropbox-scope.cjs')];
      scope = require('../server-signage-dropbox-scope.cjs');
    });

    afterEach(() => {
      delete process.env.SIGNAGE_DROPBOX_NAMESPACE_ID;
    });

    it('ajoute Path-Root header pour les appels Dropbox', async () => {
      // Mock fetch pour capturer l'appel
      const originalFetch = global.fetch;
      let capturedInit = null;
      global.fetch = async (url, init) => {
        capturedInit = init;
        return { ok: true, json: () => ({}), text: () => '', headers: new Map() };
      };

      try {
        await scope.fetchWithPathRoot('https://api.dropboxapi.com/2/files/get_metadata', {
          headers: { Authorization: 'Bearer token' }
        });

        assert(capturedInit);
        assert(capturedInit.headers['Dropbox-API-Path-Root']);
        assert.strictEqual(capturedInit.headers.Authorization, 'Bearer token');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('n\'ajoute pas Path-Root pour OAuth', async () => {
      const originalFetch = global.fetch;
      let capturedInit = null;
      global.fetch = async (url, init) => {
        capturedInit = init;
        return { ok: true, json: () => ({}), text: () => '', headers: new Map() };
      };

      try {
        await scope.fetchWithPathRoot('https://api.dropboxapi.com/oauth2/token', {
          headers: { Authorization: 'Basic creds' }
        });

        assert(capturedInit);
        assert.strictEqual(capturedInit.headers['Dropbox-API-Path-Root'], undefined);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});

