const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'AvatarFactory.jsx'), 'utf8');

test('Avatar Factory requires and transmits all four reference views', () => {
  for (const field of ['reference_path', 'left_reference_path', 'back_reference_path', 'right_reference_path']) {
    assert.match(page, new RegExp(field));
  }
  for (const label of ['Vue avant · obligatoire', 'Vue arrière · obligatoire', 'Vue gauche · obligatoire', 'Vue droite · obligatoire']) {
    assert.ok(page.includes(label), `missing uploader label: ${label}`);
  }
  assert.ok(page.includes('Lancer la production quatre vues'));
  assert.ok(page.includes('Ajoute les quatre vues : face, gauche, arrière et droite.'));
});
