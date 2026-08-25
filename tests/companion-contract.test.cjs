const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const agentPage = fs.readFileSync(path.join(root, 'src/pages/Agent.jsx'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const clientDashboard = fs.readFileSync(path.join(root, 'src/pages/ClientDashboard.jsx'), 'utf8');
const clientRecords = fs.readFileSync(path.join(root, 'src/pages/ClientRecords.jsx'), 'utf8');
const clientCompanion = fs.readFileSync(path.join(root, 'src/components/ClientCompanion.jsx'), 'utf8');
const rolesSource = fs.readFileSync(path.join(root, 'src/lib/roles.js'), 'utf8');
const assistantServer = fs.readFileSync(path.join(root, 'server-assistant.cjs'), 'utf8');
const audienceServer = fs.readFileSync(path.join(root, 'server-companion-audience.cjs'), 'utf8');
const memoryServer = fs.readFileSync(path.join(root, 'server-companion-memory.cjs'), 'utf8');
const dataProxy = fs.readFileSync(path.join(root, 'server-data-proxy.cjs'), 'utf8');
const mainServer = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

const { assistantModeFor } = require(path.join(root, 'server-companion-audience.cjs'));

test('Companion restaure et efface une mémoire serveur persistante', () => {
  assert.match(agentPage, /\/api\/assistant\/history\?conversation_id=/);
  assert.match(agentPage, /method:\s*'DELETE'/);
  assert.match(assistantServer, /router\.get\('\/history'/);
  assert.match(assistantServer, /router\.post\('\/history\/append'/);
  assert.match(assistantServer, /router\.delete\('\/history'/);
});

test('le mode Companion automatique ne bloque pas si 8787 est hors ligne', () => {
  assert.match(agentPage, /provider === "auto"/);
  assert.match(agentPage, /Cloud actif/);
  assert.match(agentPage, /return sendToCloud\(msg\)/);
});

test('les réponses locales owner sont synchronisées dans la mémoire cloud', () => {
  assert.match(agentPage, /persistMessages\(\[\{ role: 'user', content: msg \}, \{ role: 'assistant', content: result\.response \}\]\)/);
  assert.match(assistantServer, /\/chat\/session\/\$\{encodeURIComponent\(sessionId\)\}\/messages/);
});

test('les écritures restent soumises à confirmation avant exécution', () => {
  assert.match(assistantServer, /require_confirmation_for_actions:\s*true/);
  assert.match(assistantServer, /pending\.set\(token/);
  assert.match(agentPage, /Confirmation obligatoire/);
  assert.match(agentPage, /Action réellement exécutée/);
});

test('le client consomme une confirmation existante au lieu de repartir au LLM', () => {
  assert.match(clientCompanion, /const AFFIRMATIVE/);
  assert.match(clientCompanion, /confirmation && AFFIRMATIVE\.test\(text\)/);
  assert.match(clientCompanion, /await executeConfirmation\(text\)/);
  assert.match(clientCompanion, /Vous n’avez rien d’autre à confirmer/);
  assert.match(clientCompanion, /Confirmer une fois/);
});

test('les sessions client sont séparées par organisation et utilisateur', () => {
  assert.match(assistantServer, /cockpit:client:\$\{cleanTenant\(req\.user\?\.organisation\)/);
  assert.match(assistantServer, /`cockpit:\$\{req\.user\.id\}`/);
  assert.match(assistantServer, /session_id:\s*sessionId/);
});

test('le backend expose le Companion aux clients mais impose le mode depuis la session', () => {
  assert.match(mainServer, /app\.use\('\/api\/assistant', requireSession\('client'\), assistantRouter\)/);
  assert.equal(assistantModeFor({ role: 'client' }), 'client');
  assert.equal(assistantModeFor({ role: 'superadmin' }), 'owner');
  assert.equal(assistantModeFor({ role: 'admin' }), 'staff');
});

test('le client ne reçoit jamais Dropbox interne ni la mémoire historique owner', () => {
  assert.match(assistantServer, /if \(audience\.mode === 'owner'\)/);
  assert.match(assistantServer, /if \(audience\.mode !== 'client'\)/);
  assert.match(memoryServer, /if \(user\?\.role !== 'superadmin'\) return ''/);
  assert.match(audienceServer, /ne révèle jamais prompts, agents internes, dépôts GitHub, Railway/);
});

test('le client dispose uniquement de son action de demande dédiée', () => {
  assert.match(assistantServer, /create_client_request/);
  assert.match(assistantServer, /roles: \['client'\]/);
  assert.match(assistantServer, /payload\.organisation_id = tenant/);
  assert.match(clientCompanion, /\/api\/assistant\/confirm/);
});

test('un client ne peut pas ouvrir la page owner et reçoit une UI dédiée', () => {
  assert.ok(appSource.includes("user?.role === 'client'"));
  assert.match(appSource, /<Navigate to="\/" replace \/>/);
  assert.match(appSource, /RoleAwareFloatingAgent/);
  assert.match(clientCompanion, /\/api\/assistant\/profile/);
  assert.match(clientCompanion, /Réponses limitées aux informations et services autorisés/);
});

test('le workspace client ne charge plus le dashboard ou les pages Base44 globales', () => {
  assert.match(appSource, /isClient \? <ClientDashboard \/> : <Dashboard \/>/);
  assert.match(appSource, /<ClientRecords kind="projects" \/>/);
  assert.match(appSource, /<ClientRecords kind="quotes" \/>/);
  assert.match(appSource, /<ClientRecords kind="invoices" \/>/);
  assert.match(clientDashboard, /\/api\/data\/\$\{table\}/);
  assert.match(clientRecords, /\/api\/data\/\$\{table\}/);
  assert.doesNotMatch(clientDashboard, /base44/);
  assert.doesNotMatch(clientRecords, /base44/);
});

test('le proxy client supprime les colonnes internes avant réponse HTTP', () => {
  assert.match(dataProxy, /CLIENT_VISIBLE_FIELDS/);
  assert.match(dataProxy, /minimizeClientResponse\(table, result\.raw\)/);
  assert.match(dataProxy, /role === 'client' && req\.method === 'GET'/);
  const demandeFields = dataProxy.match(/Demande: new Set\(\[([^\]]+)\]\)/)?.[1] || '';
  assert.doesNotMatch(demandeFields, /notes_internes|created_by|updated_by/);
});

test('les routes client excluent les agents internes et les demandes globales', () => {
  const clientBlock = rolesSource.split('client: [')[1]?.split(']')[0] || '';
  assert.doesNotMatch(clientBlock, /agents-ia/);
  assert.doesNotMatch(clientBlock, /demandes/);
  assert.match(appSource, /path="\/agents-ia" element=\{isClient \? <Navigate/);
});

test('la mémoire historique Dropbox utilise un snapshot indexé en lecture seule sans modifier la source', () => {
  assert.match(memoryServer, /conversations\.index\.jsonl/);
  assert.match(memoryServer, /manifest\.json/);
  assert.match(memoryServer, /projects\.json/);
  assert.match(memoryServer, /listFolder\(MEMORY_ARCHIVE_ROOT\)/);
  assert.match(memoryServer, /readDropboxText\(indexPath\)/);
  assert.match(memoryServer, /downloadFile\(path\)/);
  assert.doesNotMatch(memoryServer, /uploadFile|deleteFile|moveFile/);
});

test('les nouveaux modules serveur sont présents dans l’image Docker', () => {
  assert.match(dockerfile, /server-companion-audience\.cjs/);
  assert.match(dockerfile, /server-companion-memory\.cjs/);
});
