const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isPortfolioMedia, normalizeDocumentClientId } = require('../server-documents.cjs');

test('la bibliothèque Dropbox ne retient que les images et vidéos', () => {
  assert.equal(isPortfolioMedia({ filename: 'campagne.mp4', mime_type: 'video/mp4' }), true);
  assert.equal(isPortfolioMedia({ filename: 'visuel.png', mime_type: 'image/png' }), true);
  assert.equal(isPortfolioMedia({ filename: 'archive.MOV', mime_type: 'application/octet-stream' }), true);
  assert.equal(isPortfolioMedia({ filename: 'reference.json', mime_type: 'application/json' }), false);
  assert.equal(isPortfolioMedia({ filename: 'facture.pdf', mime_type: 'application/pdf' }), false);
});

test('le rattachement client refuse les identifiants vides ou dangereux', () => {
  assert.equal(normalizeDocumentClientId('client_rougraff-01'), 'client_rougraff-01');
  assert.throws(() => normalizeDocumentClientId(''), /Sélectionne un client/);
  assert.throws(() => normalizeDocumentClientId('../client'), /invalide/);
});

test('le Portfolio charge Dropbox via une route privée et propose les aperçus sans lien public', () => {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server-documents.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src', 'pages', 'Portfolio.jsx'), 'utf8');

  assert.match(server, /router\.get\('\/portfolio-assets'/);
  assert.match(server, /router\.patch\('\/portfolio-assets\/:id\/client'/);
  assert.match(server, /getAssignableClient\(req\.user, clientId\)/);
  assert.match(server, /'x-organisation-id': tenant/);
  assert.match(server, /router\.get\('\/:id\/content'/);
  assert.match(server, /Aucun lien Dropbox public ni jeton/);
  assert.match(ui, /Médias Dropbox/);
  assert.match(ui, /\/api\/documents\/portfolio-assets\?limit=500/);
  assert.match(ui, /Client à identifier/);
  assert.match(ui, /Enregistrer le client/);
  assert.match(ui, /portfolio-assets\/\$\{encodeURIComponent\(asset\.id\)\}\/client/);
  assert.match(ui, /Les fichiers restent dans Dropbox/);
});

test('le hub Production utilise les vrais médias Dropbox au lieu de compteurs codés en dur', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'Production.jsx'), 'utf8');
  assert.match(ui, /production-dropbox-assets/);
  assert.match(ui, /portfolio-assets\?limit=500/);
  assert.match(ui, /Assets rattachés/);
  assert.match(ui, /client=unclassified/);
  assert.doesNotMatch(ui, /count:\s*0/);
});
