const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isPortfolioMedia } = require('../server-documents.cjs');

test('la bibliothèque Dropbox ne retient que les images et vidéos', () => {
  assert.equal(isPortfolioMedia({ filename: 'campagne.mp4', mime_type: 'video/mp4' }), true);
  assert.equal(isPortfolioMedia({ filename: 'visuel.png', mime_type: 'image/png' }), true);
  assert.equal(isPortfolioMedia({ filename: 'archive.MOV', mime_type: 'application/octet-stream' }), true);
  assert.equal(isPortfolioMedia({ filename: 'reference.json', mime_type: 'application/json' }), false);
  assert.equal(isPortfolioMedia({ filename: 'facture.pdf', mime_type: 'application/pdf' }), false);
});

test('le Portfolio charge Dropbox via une route privée et propose les aperçus sans lien public', () => {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server-documents.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src', 'pages', 'Portfolio.jsx'), 'utf8');

  assert.match(server, /router\.get\('\/portfolio-assets'/);
  assert.match(server, /router\.get\('\/:id\/content'/);
  assert.match(server, /Aucun lien Dropbox public ni jeton/);
  assert.match(ui, /Médias Dropbox/);
  assert.match(ui, /\/api\/documents\/portfolio-assets\?limit=500/);
  assert.match(ui, /Client à identifier/);
  assert.match(ui, /Les fichiers restent dans Dropbox/);
});
