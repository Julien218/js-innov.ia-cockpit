const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const domainOps = require(path.join(root, 'server-domain-ops.cjs'));

const { safeDomain, verifiedImprovement, MANAGED_DOMAINS } = domainOps;

test('domain ops refuse tout domaine hors inventaire géré', () => {
  assert.equal(safeDomain('https://synergiedour.be/foo'), 'synergiedour.be');
  assert.equal(safeDomain('evil.example'), null);
  assert.ok(MANAGED_DOMAINS['missetmisterdour.be']);
});

test('jsinnovia.store est un domaine email réservé tant que la vitrine WebXR n’est pas activée', () => {
  const store = MANAGED_DOMAINS['jsinnovia.store'];
  assert.equal(store.purpose, 'email_reserved');
  assert.equal(store.web_required, false);
  assert.equal(store.mail_required, true);
  assert.equal(store.future_use, 'immersive_webxr_store');
  assert.match(store.future_label, /WebXR/i);
});

test('un domaine email réservé surveille MX SPF DMARC sans incident HTTPS obligatoire', () => {
  const source = fs.readFileSync(path.join(root, 'server-domain-ops.cjs'), 'utf8');
  assert.match(source, /inspectMailDns/);
  assert.match(source, /mail_mx_missing/);
  assert.match(source, /mail_spf_missing/);
  assert.match(source, /mail_dmarc_missing/);
  assert.match(source, /web_not_required/);
  assert.match(source, /Aucune réparation web à lancer/);
});

test('chaque diagnostic de domaine reçoit un outil et un journal vérifiables', () => {
  const source = fs.readFileSync(path.join(root, 'server-domain-ops.cjs'), 'utf8');
  assert.match(source, /tool:\s*'cockpit_domain_probe'/);
  assert.match(source, /run_id:\s*`domain-\$\{crypto\.randomUUID\(\)\}`/);
});

test('une réparation n’est déclarée réussie que si une amélioration est mesurable', () => {
  const before = {
    http: { apex: { ok: false } },
    seo: { score: 40 },
    issues: [{ severity: 'critical' }, { severity: 'warning' }],
  };
  const after = {
    http: { apex: { ok: true } },
    seo: { score: 40 },
    issues: [{ severity: 'warning' }],
  };
  assert.equal(verifiedImprovement('repair', before, after), true);
  assert.equal(verifiedImprovement('seo', before, after), false);
  assert.equal(verifiedImprovement('seo', before, { ...after, seo: { score: 75 } }), true);
  assert.equal(verifiedImprovement('repair', { ...before, web_required: false }, { ...after, web_required: false }), false);
});

test('la route réparation exige un jeton préparé et le consomme avant effet réel', () => {
  const source = fs.readFileSync(path.join(root, 'server-domain-ops.cjs'), 'utf8');
  assert.match(source, /pendingDomainActions/);
  assert.match(source, /\/prepare-repair/);
  assert.match(source, /pendingDomainActions\.delete\(token\)/);
  assert.match(source, /Confirmation de domaine absente ou déjà consommée/);
  assert.match(source, /runDomainRepair/);
});

test('la réparation crée une tâche et la transmet au moteur interne NOVA uniquement quand une réparation web est requise', () => {
  const source = fs.readFileSync(path.join(root, 'server-domain-ops.cjs'), 'utf8');
  assert.match(source, /executeTaskBatch/);
  assert.match(source, /domain-objective-/);
  assert.match(source, /before\?\.web_required === false/);
  assert.doesNotMatch(source, /status: 'queued_internal'/);
  assert.doesNotMatch(source, /executeBase44Agent/);
});

test('l’onglet Domaines utilise des mesures live et expose les actions IA seulement pour les sites web', () => {
  const page = fs.readFileSync(path.join(root, 'src/pages/Domaines.jsx'), 'utf8');
  assert.match(page, /\/api\/domain-ops\/analyze/);
  assert.match(page, /\/api\/domain-ops\/prepare-repair/);
  assert.match(page, /\/api\/domain-ops\/repair/);
  assert.match(page, />Analyser</);
  assert.match(page, />Réparer IA</);
  assert.match(page, />SEO auto</);
  assert.match(page, /Email actif · Web réservé/);
  assert.match(page, /Vitrine 3D immersive \/ WebXR/);
  assert.match(page, /disabled=\{webReserved\}/);
  assert.doesNotMatch(page, /http:\s*200,\s*www:/);
  assert.match(page, /Confirmer et lancer/);
});

test('server et Docker embarquent le module domaines', () => {
  const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(server, /\/api\/domain-ops/);
  assert.match(server, /requireSession\('admin'\)/);
  assert.match(docker, /server-domain-ops\.cjs/);
  assert.match(docker, /server-ionos-dns\.cjs/);
});

test('les écritures IONOS sont limitées, préparées, confirmées et vérifiées', () => {
  const source = fs.readFileSync(path.join(root, 'server-domain-ops.cjs'), 'utf8');
  assert.match(source, /\/ionos\/status/);
  assert.match(source, /\/ionos\/prepare-change/);
  assert.match(source, /\/ionos\/apply-change/);
  assert.match(source, /pendingDnsActions\.delete\(token\)/);
  assert.match(source, /applyPreparedChangeSet/);
});
