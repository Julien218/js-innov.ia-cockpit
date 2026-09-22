const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/pages/DigitalSignage.jsx'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server-signage.cjs'), 'utf8');
const services = fs.readFileSync(path.join(root, 'src/config/platformServices.js'), 'utf8');

test('Signelya manager uses the canonical app domain', () => {
  assert.match(page, /https:\/\/app\.signelya\.jsinnovia\.com\/ecran-geant/);
  assert.match(server, /https:\/\/app\.signelya\.jsinnovia\.com/);
  assert.match(services, /domain: "app\.signelya\.jsinnovia\.com"/);
});

test('the old Railway manager URL is no longer exposed by the Cockpit link', () => {
  assert.doesNotMatch(page, /olivier-signage-cockpit-production\.up\.railway\.app\/ecran-geant/);
});
