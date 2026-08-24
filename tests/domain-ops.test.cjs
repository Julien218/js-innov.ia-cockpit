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
});

test('la route réparation exige un jeton préparé et le consomme avant effet réel', () => {
  const source = fs.readFileSync(path.join(root, 'server-domain-ops.cjs'), 'utf8');
  assert.match(source, /pendingDomainActions/);
  assert.match(source, /\/prepare-repair/);
  assert.match(source, /pendingDomainActions\.delete\(token\)/);
  assert.match(source, /Confirmation de domaine absente ou déjà consommée/);
  assert.match(source, /execution_mode:\s*'confirmed_write'/);
});

test('la réparation crée une tâche puis recontrôle le domaine', () => {
  const source = fs.readFileSync(path.join(root, 'server-domain-ops.cjs'), 'utf8');
  assert.match(source, /createRepairTask\(domain, kind, before\)/);
  assert.match(source, /executeBase44Agent\(agent, domain, kind, before\)/);
  assert.match(source, /const after = await analyzeDomain\(domain\)/);
  assert.match(source, /statut: verified \? 'terminee' : 'bloquee'/);
});

test('l’onglet Domaines utilise des mesures live et expose les trois actions IA', () => {
  const page = fs.readFileSync(path.join(root, 'src/pages/Domaines.jsx'), 'utf8');
  assert.match(page, /\/api\/domain-ops\/analyze/);
  assert.match(page, /\/api\/domain-ops\/prepare-repair/);
  assert.match(page, /\/api\/domain-ops\/repair/);
  assert.match(page, />Analyser</);
  assert.match(page, />Réparer IA</);
  assert.match(page, />SEO auto</);
  assert.doesNotMatch(page, /http:\s*200,\s*www:/);
  assert.match(page, /Confirmer et lancer/);
});

test('server et Docker embarquent le module domaines', () => {
  const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(server, /\/api\/domain-ops/);
  assert.match(server, /requireSession\('admin'\)/);
  assert.match(docker, /server-domain-ops\.cjs/);
});
