const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'AvatarFactory.jsx'), 'utf8');

test('Avatar Factory supports one required view or one complete four-view set', () => {
  for (const field of ['reference_path', 'left_reference_path', 'back_reference_path', 'right_reference_path']) {
    assert.match(page, new RegExp(field));
  }
  for (const label of ['Vue avant · obligatoire', 'Vue arrière · optionnelle', 'Vue gauche · optionnelle', 'Vue droite · optionnelle']) {
    assert.ok(page.includes(label), `missing uploader label: ${label}`);
  }
  assert.ok(page.includes("auxCount === 0 || auxCount === 3"));
  assert.ok(page.includes('Lancer la production 3D'));
  assert.ok(page.includes('Ajoute au minimum une image principale.'));
  assert.ok(page.includes('ajoute ensemble les vues gauche, arrière et droite'));
});

test('Avatar Factory keeps generated IDs synchronized until manual override', () => {
  assert.ok(page.includes('characterIdEditedRef'));
  assert.ok(page.includes("character_id: characterIdEditedRef.current ? value.character_id : slug(subjectName, '')"));
});

test('Avatar Factory enforces Olivier technical-cost-only billing', () => {
  assert.ok(page.includes("form.client_id.trim().toLowerCase() === 'olivier'"));
  assert.ok(page.includes("? 'technical_costs_only'"));
  assert.ok(page.includes("disabled={form.client_id.trim().toLowerCase() === 'olivier'}"));
  assert.ok(page.includes('Olivier : coûts techniques uniquement'));
});
