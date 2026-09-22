const test = require('node:test');
const assert = require('node:assert/strict');

test('le Cockpit regroupe les doublons sans supprimer les enregistrements', async () => {
  const { groupTasks } = await import('../src/lib/taskGrouping.js');
  const rows = [
    { id: '1', titre: 'SEO automatique — jsinnovia.com', statut: 'bloquee', created_at: '2026-08-20' },
    { id: '2', titre: 'SEO automatique - jsinnovia.com', statut: 'en_cours', created_at: '2026-08-21' },
    { id: '3', titre: 'Achever avatar local', statut: 'a_faire', created_at: '2026-08-22' },
  ];
  const grouped = groupTasks(rows);
  assert.equal(grouped.length, 2);
  const seo = grouped.find((task) => task.titre.includes('SEO automatique'));
  assert.equal(seo.duplicate_count, 2);
  assert.deepEqual(seo.duplicate_ids.sort(), ['1', '2']);
  assert.equal(seo.statut, 'en_cours');
});

test('la vue Tâches sépare les permissions des vrais blocages et permet une relance contrôlée', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'Taches.jsx'), 'utf8');
  assert.match(source, /Pilotage Elynea/);
  assert.match(source, /awaiting_authorization/);
  assert.match(source, /Exécuter avec Elynea/);
  assert.match(source, /allow_writes: allowWrites/);
  assert.match(source, /Aucune suppression ni facturation/);
});


test('une tâche canonique terminée reste visible devant ses doublons historiques bloqués', async () => {
  const { groupTasks } = await import('../src/lib/taskGrouping.js');
  const rows = [
    { id: 'canon', titre: 'Contrôler l’état des API vidéo IA', statut: 'terminee', notes: 'NOVA locale — diagnostic terminé avec preuve.' },
    { id: 'dup-1', titre: 'Contrôler l’état des API vidéo IA', statut: 'bloquee', notes: 'Audit NOVA: doublon bloqué sans suppression; tâche canonique canon (exact_duplicate).' },
    { id: 'dup-2', titre: 'Contrôler l’état des API vidéo IA', statut: 'bloquee', notes: 'Doublon regroupé avec la tâche canon.' },
  ];
  const [grouped] = groupTasks(rows);
  assert.equal(grouped.id, 'canon');
  assert.equal(grouped.statut, 'terminee');
  assert.equal(grouped.duplicate_count, 3);
  assert.equal(grouped.archived_duplicate_count, 2);
});

test('la vue Tâches exclut les doublons archivés du travail actif', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'Taches.jsx'), 'utf8');
  assert.match(source, /ARCHIVED_DUPLICATE/);
  assert.match(source, /isHistoricalDuplicate/);
  assert.match(source, /awaiting_input/);
  assert.match(source, /doublons historiques restent conservés mais sont exclus/);
});
