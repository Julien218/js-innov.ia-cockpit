const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src', 'pages', 'DigitalSignage.jsx'), 'utf8');
const wrapper = fs.readFileSync(path.join(root, 'src', 'pages', 'DigitalSignageScheduled.jsx'), 'utf8');

test('the client signage page follows a clear three-step workflow', () => {
  const add = page.indexOf('Ajoutez vos médias');
  const prepare = page.indexOf('Préparez votre programme');
  const launch = page.indexOf('Lancez la diffusion');
  assert.ok(add > 0);
  assert.ok(prepare > add);
  assert.ok(launch > prepare);
  assert.match(page, /Ajouter une vidéo ou une image/);
  assert.match(page, /Enregistrer ce programme/);
  assert.match(page, /Diffuser maintenant/);
});

test('technical wording is translated for the client', () => {
  assert.match(page, /Prêt à diffuser/);
  assert.match(page, /Programmée/);
  assert.match(page, /Revenir à cette diffusion/);
  assert.match(page, /Votre écran est bien connecté/);
  assert.doesNotMatch(page, />Rollback</);
});

test('maintenance and advanced diagnostics stay collapsed and role-gated', () => {
  assert.match(page, /<details className="group rounded-2xl border bg-card">/);
  assert.match(page, /isAdmin && <details className="rounded-2xl border bg-card">/);
  assert.match(wrapper, /Définir les horaires automatiques/);
  assert.match(wrapper, /Gérer ou supprimer des fichiers/);
  assert.match(wrapper, /isAdmin && player && <details/);
  assert.match(wrapper, /Diagnostic avancé de l’écran/);
});

test('the responsive status grid does not force four columns in the narrow cockpit content area', () => {
  assert.match(page, /sm:grid-cols-2 xl:grid-cols-4/);
  assert.doesNotMatch(page, /sm:grid-cols-2 lg:grid-cols-4/);
});

test('the redesign preserves the existing media and publication APIs', () => {
  assert.match(page, /\/manage\/media\/upload/);
  assert.match(page, /\/manage\/playlists/);
  assert.match(page, /\/manage\/publications/);
});

test('the client page carries the SIGNELYA visual identity', () => {
  assert.match(page, /src="\/signelya-symbol-approved-512\.png" alt="Logo SIGNELYA"/);
  assert.match(page, /SignelyaWordmark/);
  assert.match(page, /#070B1C/);
  assert.match(page, /#101B3D/);
  assert.match(page, /#8A2BE2/);
  assert.match(page, /#00D4FF/);
  assert.match(page, /#2563EB/);
  assert.match(page, /#0891B2/);
});

test('the client can preview every scheduled playlist exactly like the Android Player', () => {
  assert.match(page, /Boucle programmée · aperçu fidèle à l’écran/);
  assert.match(page, /Toutes les diffusions programmées/);
  assert.match(page, /Ordre exact de la boucle/);
  assert.match(page, /requestFullscreen/);
  assert.match(page, /style=\{\{ left: "1\.5%", right: "1\.5%" \}\}/);
  assert.match(page, /object-contain/);
  assert.match(page, /onEnded=\{handleVideoEnd\}/);
  assert.match(page, /Math\.max\(3, Number\(current\?\.durationSeconds/);
});

test('program media names remain fully readable on mobile', () => {
  assert.match(page, /min-w-0 break-words/);
  assert.match(page, /Touchez un média pour le visualiser immédiatement/);
});
