/**
 * Tests runtime : vérification que migrate-signage-dropbox-20260903.cjs 
 * exporte listFolderAll et gère pagination/erreurs correctement
 */

const assert = require('assert');

describe('migrate-signage-dropbox-20260903 runtime', () => {
  let listFolderAll, normalizePath;

  before(() => {
    // Importer le script en tant que module
    const mod = require('../scripts/migrate-signage-dropbox-20260903.cjs');
    listFolderAll = mod.listFolderAll;
    normalizePath = mod.normalizePath;
  });

  it('exporte listFolderAll et normalizePath', () => {
    assert(typeof listFolderAll === 'function', 'listFolderAll doit être une fonction');
    assert(typeof normalizePath === 'function', 'normalizePath doit être une fonction');
  });

  it('normalizePath normalise correctement', () => {
    assert.strictEqual(normalizePath('/Cockpit/'), '/Cockpit');
    assert.strictEqual(normalizePath('Cockpit'), '/Cockpit');
    assert.strictEqual(normalizePath('/'), '/');
  });

  it('listFolderAll gère pagination complète (2 pages)', async () => {
    // Mock fetch pour simuler 2 pages
    let callCount = 0;
    const originalFetch = global.fetch;
    global.fetch = async (url, init) => {
      callCount++;

      if (url.includes('/list_folder') && !url.includes('/continue')) {
        // Première page
        return {
          ok: true,
          json: () => Promise.resolve({
            entries: [{ name: 'file1.txt', '.tag': 'file' }],
            has_more: true,
            cursor: 'cursor-page-1'
          })
        };
      } else if (url.includes('/list_folder/continue')) {
        // Deuxième page
        return {
          ok: true,
          json: () => Promise.resolve({
            entries: [{ name: 'file2.txt', '.tag': 'file' }],
            has_more: false,
            cursor: 'cursor-page-2'
          })
        };
      }
      return { ok: false, json: () => Promise.resolve({}) };
    };

    try {
      const result = await listFolderAll('test-token', '/test-folder', {});
      assert(result.ok, 'Résultat doit être ok:true');
      assert.strictEqual(result.entries.length, 2, 'Doit avoir 2 entrées de 2 pages');
      assert.strictEqual(result.entries[0].name, 'file1.txt', 'Première entrée correcte');
      assert.strictEqual(result.entries[1].name, 'file2.txt', 'Deuxième entrée correcte');
      assert(callCount >= 2, 'Doit avoir appelé fetch au moins 2 fois');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('listFolderAll échoue si list_folder/continue échoue (page 2 erreur)', async () => {
    let callCount = 0;
    const originalFetch = global.fetch;
    global.fetch = async (url, init) => {
      callCount++;

      if (url.includes('/list_folder') && !url.includes('/continue')) {
        // Première page OK
        return {
          ok: true,
          json: () => Promise.resolve({
            entries: [{ name: 'file1.txt', '.tag': 'file' }],
            has_more: true,
            cursor: 'cursor-page-1'
          })
        };
      } else if (url.includes('/list_folder/continue')) {
        // Deuxième page échoue
        return {
          ok: false,
          json: () => Promise.resolve({
            error_summary: 'not_found/...',
          })
        };
      }
      return { ok: false, json: () => Promise.resolve({}) };
    };

    try {
      const result = await listFolderAll('test-token', '/test-folder', {});
      assert(!result.ok, 'Résultat doit être ok:false si continue échoue');
      assert.strictEqual(result.entries.length, 0, 'Doit retourner 0 entrées en cas d\'erreur');
      assert(result.error, 'Doit avoir un message d\'erreur');
      assert(callCount >= 2, 'Doit avoir appelé fetch au moins 2 fois');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('listFolderAll gère exception fetch', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url, init) => {
      throw new Error('Network error');
    };

    try {
      const result = await listFolderAll('test-token', '/test-folder', {});
      assert(!result.ok, 'Résultat doit être ok:false sur exception');
      assert.strictEqual(result.entries.length, 0, 'Doit retourner 0 entrées');
      assert(result.error, 'Doit avoir un message d\'erreur');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

