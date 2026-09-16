const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const helper = fs.readFileSync(path.join(root, 'server-dropbox-helper.cjs'), 'utf8');
const documents = fs.readFileSync(path.join(root, 'server-documents.cjs'), 'utf8');
const floating = fs.readFileSync(path.join(root, 'src/components/FloatingAgent.jsx'), 'utf8');

test('Elynea file picker is not restricted to image/video MIME types', () => {
  assert.ok(floating.includes('type="file"'));
  assert.equal(/accept="image\//.test(floating), false);
  assert.ok(floating.includes('/api/assistant/upload-media'));
});

test('Dropbox classifier recognises audio, archives, documents, data and code', () => {
  for (const category of ['Audio', 'Archives', 'Documents', 'Donnees', 'Code', 'Fichiers']) {
    assert.ok(helper.includes(`'${category}'`), `missing ${category}`);
  }
  assert.ok(helper.includes('jamais exécutés ou interprétés'));
});

test('Document vault accepts generic filenames and keeps secure download route', () => {
  assert.equal(documents.includes('ALLOWED_EXTENSIONS'), false);
  assert.ok(documents.includes("router.get('/:id/download'"));
  assert.ok(documents.includes("Content-Disposition', `attachment;"));
  assert.ok(documents.includes('100 * 1024 * 1024'));
});
