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
