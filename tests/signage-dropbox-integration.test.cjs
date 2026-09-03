/**
 * Tests d'intégration : vérification que server-signage.cjs, server-signage-media-delete.cjs,
 * server-player-apk.cjs et le script migration utilisent correctement le helper
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Signage Dropbox Integration', () => {
  it('server-signage.cjs importe le helper et utilise getSignageRoot()', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server-signage.cjs'), 'utf8');
    assert(content.includes("require('./server-signage-dropbox-scope.cjs')"), 'server-signage.cjs doit importer helper');
    assert(content.includes('getSignageRoot'), 'server-signage.cjs doit importer getSignageRoot');
    assert(content.includes('SIGNAGE_DROPBOX_ROOT_PATH = getSignageRoot()'), 'SIGNAGE_DROPBOX_ROOT_PATH doit utiliser getSignageRoot()');
  });

  it('server-signage.cjs n\'a pas de DROPBOX_ROOT_PATH inutilisé', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server-signage.cjs'), 'utf8');
    // Vérifier que DROPBOX_ROOT_PATH n'est pas défini comme const au niveau racine pour Signage
    const lines = content.split('\n');
    const hasDROPBOX_ROOT_PATH_const = lines.some(line =>
      /^const DROPBOX_ROOT_PATH = String\(process\.env\.DROPBOX_ROOT_PATH/.test(line)
    );
    assert(!hasDROPBOX_ROOT_PATH_const, 'DROPBOX_ROOT_PATH const ne doit pas être défini au niveau racine');
  });

  it('server-signage.cjs utilise fetchWithPathRoot() via dropboxJson()', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server-signage.cjs'), 'utf8');
    assert(content.includes('fetchWithPathRoot'), 'server-signage.cjs doit importer fetchWithPathRoot');
    assert(content.includes('async function dropboxJson'), 'dropboxJson doit exister');
    assert(content.includes('fetchWithPathRoot(url, options)'), 'dropboxJson doit appeler fetchWithPathRoot()');
  });

  it('server-signage-media-delete.cjs importe le helper et l\'utilise', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server-signage-media-delete.cjs'), 'utf8');
    assert(content.includes("require('./server-signage-dropbox-scope.cjs')"), 'media-delete doit importer helper');
    assert(content.includes('fetchWithPathRoot'), 'media-delete doit importer fetchWithPathRoot');
    assert(content.includes("fetchWithPathRoot('https://api.dropboxapi.com/2/files/delete_v2'"),
      'delete_v2 doit être appelé via fetchWithPathRoot');
  });

  it('server-player-apk.cjs importe le helper et l\'utilise', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server-player-apk.cjs'), 'utf8');
    assert(content.includes("require('./server-signage-dropbox-scope.cjs')"), 'player-apk doit importer helper');
    assert(content.includes('fetchWithPathRoot'), 'player-apk doit importer fetchWithPathRoot');
    assert(content.includes("fetchWithPathRoot('https://content.dropboxapi.com/2/files/upload'"),
      'upload doit être appelé via fetchWithPathRoot');
  });

  it('server-signage-dropbox-scope.cjs exclut Path-Root sur OAuth et URL externes', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server-signage-dropbox-scope.cjs'), 'utf8');
    // Vérifier OAuth exclusion et domaines Dropbox
    assert(content.includes('oauth2'), 'Module doit gérer /oauth2/');
    assert(content.includes('api.dropboxapi.com') || content.includes('content.dropboxapi.com'),
      'Module doit vérifier domaines Dropbox');
  });

  it('scripts/migrate-signage-dropbox-20260903.cjs utilise SQL paramétré (ILIKE + $1)', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate-signage-dropbox-20260903.cjs'), 'utf8');
    assert(content.includes('ILIKE $1'), 'Migration doit utiliser SQL paramétré avec $1, $2...');
    assert(content.includes('ILIKE $2'), 'Migration doit utiliser SQL paramétré');
    assert(content.includes('await client.query'), 'Migration doit exécuter query via client');
  });

  it('scripts/migrate-signage-dropbox-20260903.cjs gère bigint PostgreSQL', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate-signage-dropbox-20260903.cjs'), 'utf8');
    assert(content.includes('Number(row.size_bytes)'), 'Migration doit convertir bigint en Number');
    assert(content.includes('Number.isSafeInteger'), 'Migration doit vérifier isSafeInteger');
    assert(content.includes('Number(metaData.size || 0)'), 'Migration doit convertir taille Dropbox en Number');
  });

  it('scripts/migrate-signage-dropbox-20260903.cjs exclut les chemins déjà migrés', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate-signage-dropbox-20260903.cjs'), 'utf8');
    assert(content.includes('NOT (dropbox_path ILIKE $3'), 'Migration doit exclure chemins déjà au nouveau préfixe');
  });

  it('scripts/migrate-signage-dropbox-20260903.cjs ne loggue jamais SECRET ou access_token', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate-signage-dropbox-20260903.cjs'), 'utf8');
    // console.log(JSON.stringify()) pour résumé est OK (pas secret)
    // Ne doit pas logger token, DATABASE_URL, ou clés secrets
    assert(!content.includes('console.error(`TOKEN:') && !content.includes('console.log(token'),
      'Ne doit pas afficher token/DATABASE_URL');
    assert(content.includes('process.exitCode'), 'Migration doit utiliser process.exitCode au lieu de process.exit()');
    assert(content.includes('JSON.stringify(summary)'), 'Migration affiche résumé JSON sans secret');
  });

  it('scripts/migrate-signage-dropbox-20260903.cjs gère Dropbox error_summary', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate-signage-dropbox-20260903.cjs'), 'utf8');
    assert(content.includes('error_summary'), 'Migration doit vérifier error_summary au lieu de l\'objet complet');
    assert(content.includes('listFolderAll'), 'Migration doit utiliser helper listFolderAll avec gestion pagination');
  });

  it('.env.example contient les variables SIGNAGE_DROPBOX_*', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
    assert(content.includes('SIGNAGE_DROPBOX_ROOT_PATH'), '.env.example doit contenir SIGNAGE_DROPBOX_ROOT_PATH');
    assert(content.includes('SIGNAGE_DROPBOX_NAMESPACE_ID'), '.env.example doit contenir SIGNAGE_DROPBOX_NAMESPACE_ID');
    assert(content.includes('SIGNAGE_DROPBOX_MIGRATION_20260903'), '.env.example doit contenir SIGNAGE_DROPBOX_MIGRATION_20260903');
  });

  it('scripts/migrate-signage-dropbox-20260903.cjs dispose de rollback fail-closed', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate-signage-dropbox-20260903.cjs'), 'utf8');
    assert(content.includes("await client.query('ROLLBACK')"), 'Migration doit avoir rollback');
    assert(content.includes('SERIALIZABLE'), 'Migration doit utiliser SERIALIZABLE');
    assert(content.includes('COMMIT'), 'Migration doit committer après succès');
  });

  it('scripts/migrate-signage-dropbox-20260903.cjs insère audit sans secret', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate-signage-dropbox-20260903.cjs'), 'utf8');
    assert(content.includes("SIGNAGE_NAMESPACE_ID ? '***'"),
      'Audit doit masquer namespace_id avec ***');
    assert(content.includes('signage_audit_events'), 'Migration doit insérer dans audit');
  });

  it('scripts/migrate-signage-dropbox-20260903.cjs vérifie get_temporary_link avec namespace_id', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate-signage-dropbox-20260903.cjs'), 'utf8');
    assert(content.includes('get_temporary_link'), 'Migration doit vérifier get_temporary_link');
    assert(content.includes('...pathRootHeader'), 'get_temporary_link doit utiliser pathRootHeader (namespace_id)');
  });

  it('scripts/migrate-signage-dropbox-20260903.cjs reconnaît release.json et APK 0.6.1 par .tag file', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate-signage-dropbox-20260903.cjs'), 'utf8');
    assert(content.includes("entry['.tag'] === 'file'"), 'Doit vérifier .tag = file');
    assert(content.includes("entry.name === 'release.json'"), 'Doit chercher release.json par nom exact');
    assert(content.includes("entry.name === 'Pixelium-Player-Olivier-0.6.1-pilot.apk'"), 'Doit chercher APK 0.6.1 par exact match');
  });

  it('serveur-signage-dropbox-scope.cjs fait normalisation robuste', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server-signage-dropbox-scope.cjs'), 'utf8');
    assert(content.includes('.trim()'), 'normalizePath doit trim');
    assert(content.includes("replace(/\\\\/g, '/')"), 'normalizePath doit convertir backslashes');
    assert(content.includes("replace(/\\/+/g, '/')"), 'normalizePath doit remplacer slashes multiples');
    assert(content.includes("!result.startsWith('/')"), 'normalizePath doit ajouter préfixe /');
  });
});

