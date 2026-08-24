const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const autopilot = require(path.join(root, 'server-task-autopilot.cjs'));

test('l’autopilote regroupe les titres dupliqués', () => {
  assert.equal(autopilot.canonicalTaskTitle('SEO automatique — jsinnovia.com (duplicata)'), autopilot.canonicalTaskTitle('SEO automatique — jsinnovia.com'));
});

test('une preuve canonique clôt uniquement les doublons non terminés du même objectif', () => {
  const canonical = { id: 't1', titre: 'Recenser les fonctionnalités non opérationnelles dans le module vidéo IA', statut: 'terminee' };
  const copies = autopilot.duplicateTasksForCanonical([
    canonical,
    { id: 't2', titre: 'Recenser les fonctionnalités non opérationnelles dans le module vidéo IA (duplicata)', statut: 'a_faire' },
    { id: 't3', titre: 'Recenser les fonctionnalités non opérationnelles dans le module vidéo IA', statut: 'terminee' },
    { id: 't4', titre: 'Lancer une campagne de tests vidéo IA', statut: 'a_faire' },
  ], canonical);
  assert.deepEqual(copies.map((task) => task.id), ['t2']);
});

test('les diagnostics de domaine sont exécutables sans effet métier', () => {
  const item = autopilot.classifyTask({ titre: 'Contrôler DNS et TLS — jsinnovia.com' });
  assert.equal(item.kind, 'domain_diagnostic');
  assert.equal(item.domain, 'jsinnovia.com');
  assert.equal(item.executable, true);
});

test('les réparations DNS et SEO ne sont jamais lancées sans connecteur d’écriture', () => {
  for (const title of ['Réparation IA — jsinnovia.com', 'SEO automatique — jsinnovia.com']) {
    const item = autopilot.classifyTask({ titre: title });
    assert.equal(item.kind, 'sensitive_domain_write');
    assert.equal(item.executable, false);
  }
});

test('les tâches locales et métier restent bloquées avec une cause exacte', () => {
  assert.equal(autopilot.classifyTask({ titre: 'Vérifier workflow MiniMax H3 local' }).reason, 'agent_windows_local_requis');
  assert.equal(autopilot.classifyTask({ titre: 'Compléter les données TVA du client' }).reason, 'donnees_metier_ou_validation_humaine_requises');
});

test('les audits clients et factures sont exécutables en lecture seule', () => {
  assert.equal(autopilot.classifyTask({ titre: 'Analyser les factures et leur rattachement' }).kind, 'business_data_audit');
  assert.equal(autopilot.classifyTask({ titre: 'Vérifier les rattachements clients, sites, sociétés ou ASBL' }).executable, true);
});

test('l’audit métier compte les rattachements et TVA manquants sans modifier les données', () => {
  const result = autopilot.summarizeBusinessData({
    clients: [{ id: 'c1', numero_tva: 'BE1' }, { id: 'c2' }],
    invoices: [{ id: 'f1', client_id: 'c1' }, { id: 'f2' }],
    projects: [{ id: 'p1', client_nom: 'Client' }, { id: 'p2' }],
  });
  assert.equal(result.clients_missing_vat_count, 1);
  assert.equal(result.invoices_without_client_count, 1);
  assert.equal(result.projects_without_client_count, 1);
  assert.deepEqual(result.affected_ids.invoices_without_client, ['f2']);
});

test('le serveur et Docker embarquent l’autopilote permanent', () => {
  const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(server, /startTaskAutopilotScheduler/);
  assert.match(server, /\/api\/task-autopilot/);
  assert.match(server, /task_autopilot:/);
  assert.match(server, /duplicate_groups:/);
  assert.match(docker, /server-task-autopilot\.cjs/);
  assert.match(docker, /node --check \/app\/server-task-autopilot\.cjs/);
});

test('les preuves locales sont synchronisées sans accepter de commande arbitraire', () => {
  const source = fs.readFileSync(path.join(root, 'server-task-autopilot.cjs'), 'utf8');
  assert.match(source, /LOCAL_TOOLS = new Set/);
  assert.match(source, /\/local-results/);
  assert.match(source, /provider_name: 'local-agent'/);
  assert.match(source, /task_id absent du Cockpit/);
  assert.match(source, /Doublon regroupé avec la tâche/);
});
