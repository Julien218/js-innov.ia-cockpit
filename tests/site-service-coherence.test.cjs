const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('le site officiel pointe vers le bon domaine, dépôt et service Railway', () => {
  const config = read('src/config/platformServices.js');
  assert.match(config, /url:\s*"https:\/\/www\.jsinnovia\.com"/);
  assert.match(config, /service:\s*"js-innovia-site"/);
  assert.match(config, /repository:\s*"Julien218\/jsinnovia"/);
  assert.match(config, /branch:\s*"main"/);
});

test('le service Signelya reste un module produit séparé du site général', () => {
  const config = read('src/config/platformServices.js');
  assert.match(config, /signageManager/);
  assert.match(config, /service:\s*"olivier-signage-cockpit"/);
  assert.match(config, /signageProductSite/);
  assert.match(config, /service:\s*"olivier-signage-site"/);
  assert.match(config, /Vitrine produit Signage/);
  assert.match(config, /Ce n’est pas le site général JS-Innov\.IA/);
});

test('les écrans Cockpit n’annoncent plus Base44 ou le dépôt Signage comme vitrine officielle', () => {
  const domains = read('src/pages/Domaines.jsx');
  const settings = read('src/pages/Parametres.jsx');
  const inventory = read('src/pages/Rangement.jsx');

  assert.match(domains, /dest:\s*"Railway"/);
  assert.match(domains, /app:\s*"js-innovia-site"/);
  assert.doesNotMatch(domains, /name:\s*"jsinnovia\.com",\s*dest:\s*"Base44"/);
  assert.match(settings, /PLATFORM_SERVICES\.publicSite\.repositoryUrl/);
  assert.match(inventory, /jsinnovia\.com \(apex TLS\/DNS\)/);
});

test('le diagnostic expose la cible publique et le dépôt réellement reliés', () => {
  const domainOps = require(path.join(root, 'server-domain-ops.cjs'));
  const meta = domainOps.MANAGED_DOMAINS['jsinnovia.com'];
  assert.equal(meta.app, 'js-innovia-site');
  assert.equal(meta.hosting, 'Railway');
  assert.equal(meta.primary_url, 'https://www.jsinnovia.com');
  assert.equal(meta.repository, 'Julien218/jsinnovia');
});
