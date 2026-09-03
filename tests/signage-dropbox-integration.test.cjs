/**
 * Tests d'intégration : vérification que server-signage.cjs, server-signage-media-delete.cjs
 * et server-player-apk.cjs utilisent correctement le helper et les appels Dropbox
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Signage Dropbox Integration', () => {
  it('server-signage.cjs importe le helper', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server-signage.cjs'), 'utf8');
    assert(content.includes('server-signage-dropbox-scope.cjs'), 'server-signage.cjs doit importer server-signage-dropbox-scope.cjs');
    assert(content.includes('getSignageRoot'), 'server-signage.cjs doit importer getSignageRoot');
    assert(content.includes('fetchWithPathRoot'), 'server-signage.cjs doit importer fetchWithPathRoot');
  });

  it('server-signage.cjs utilise SIGNAGE_DROPBOX_ROOT_PATH', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server-signage.cjs'), 'utf8');
    assert(content.includes('SIGNAGE_DROPBOX_ROOT_PATH'), 'SIGNAGE_DROPBOX_ROOT_PATH doit être défini');
    assert(content.includes('mediaRoot') && content.includes('SIGNAGE_DROPBOX_ROOT_PATH'), 'mediaRoot doit utiliser SIGNAGE_DROPBOX_ROOT_PATH');
    assert(content.includes('cameraRecordingRoot') && content.includes('SIGNAGE_DROPBOX_ROOT_PATH'), 'cameraRecordingRoot doit utiliser SIGNAGE_DROPBOX_ROOT_PATH');
  });

  it('server-signage.cjs : dropboxJson() utilise fetchWithPathRoot', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server-signage.cjs'), 'utf8');
    assert(content.includes('fetchWithPathRoot(url, options)'), 'dropboxJson doit appeler fetchWithPathRoot()');
    assert(content.includes('async function dropboxJson'), 'dropboxJson doit exister');
  });

  it('server-signage-media-delete.cjs importe le helper', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server-signage-media-delete.cjs'), 'utf8');
    assert(content.includes('server-signage-dropbox-scope.cjs'), 'server-signage-media-delete.cjs doit importer server-signage-dropbox-scope.cjs');
    assert(content.includes('fetchWithPathRoot'), 'server-signage-media-delete.cjs doit importer fetchWithPathRoot');
  });

  it('server-signage-media-delete.cjs : delete_v2 utilise fetchWithPathRoot', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server-signage-media-delete.cjs'), 'utf8');
    assert(content.includes("fetchWithPathRoot('https://api.dropboxapi.com/2/files/delete_v2'"), 
      'delete_v2 doit être appelé via fetchWithPathRoot');
  });

  it('server-player-apk.cjs importe le helper', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server-player-apk.cjs'), 'utf8');
    assert(content.includes('server-signage-dropbox-scope.cjs'), 'server-player-apk.cjs doit importer server-signage-dropbox-scope.cjs');
    assert(content.includes('fetchWithPathRoot'), 'server-player-apk.cjs doit importer fetchWithPathRoot');
  });

  it('server-player-apk.cjs : uploadDropboxFile utilise fetchWithPathRoot', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server-player-apk.cjs'), 'utf8');
    assert(content.includes("fetchWithPathRoot('https://content.dropboxapi.com/2/files/upload'"), 
      'upload doit être appelé via fetchWithPathRoot');
  });

  it('server-signage-dropbox-scope.cjs exclut Path-Root sur OAuth token', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server-signage-dropbox-scope.cjs'), 'utf8');
    assert(content.includes('/oauth2/token'), 'Le module doit vérifier /oauth2/token');
    assert(content.includes('return result'), 'Le module doit retourner sans Path-Root sur OAuth');
  });

  it('.env.example contient SIGNAGE_DROPBOX_ROOT_PATH', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
    assert(content.includes('SIGNAGE_DROPBOX_ROOT_PATH'), '.env.example doit contenir SIGNAGE_DROPBOX_ROOT_PATH');
    assert(content.includes('SIGNAGE_DROPBOX_NAMESPACE_ID'), '.env.example doit contenir SIGNAGE_DROPBOX_NAMESPACE_ID');
    assert(content.includes('SIGNAGE_DROPBOX_MIGRATION_20260903'), '.env.example doit contenir SIGNAGE_DROPBOX_MIGRATION_20260903');
  });

  it('scripts/migrate-signage-dropbox-20260903.cjs existe et est idempotent', () => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'migrate-signage-dropbox-20260903.cjs');
    assert(fs.existsSync(scriptPath), 'Script de migration doit exister');
    const content = fs.readFileSync(scriptPath, 'utf8');
    assert(content.includes('SIGNAGE_DROPBOX_MIGRATION_20260903'), 'Script doit vérifier la variable activation');
    assert(content.includes('ROLLBACK'), 'Script doit implémenter le rollback');
    assert(content.includes('console.error'), 'Script doit utiliser console.error, jamais console.log pour secrets');
    assert(!content.includes('console.log(DATABASE_URL') && !content.includes('console.log(token'), 'Script ne doit pas logger DATABASE_URL ou token');
  });
});

