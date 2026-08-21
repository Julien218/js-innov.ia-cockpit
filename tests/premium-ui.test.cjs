const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'src/components/layout/AppLayout.jsx'), 'utf8');
const topbar = fs.readFileSync(path.join(root, 'src/components/layout/TopBar.jsx'), 'utf8');

test('le Cockpit utilise le système visuel dark premium JS-Innov.IA', () => {
  assert.match(css, /JS-Innov\.IA Premium Dark/);
  assert.match(css, /--background:\s*225 28% 5%/);
  assert.match(css, /--primary:\s*43 63% 52%/);
  assert.match(css, /color-scheme:\s*dark/);
  assert.match(css, /radial-gradient/);
});

test('le chrome global utilise le shell premium', () => {
  assert.match(layout, /premium-shell/);
  assert.match(css, /premium-shell > aside/);
  assert.match(css, /premium-shell header/);
  assert.match(css, /backdrop-filter:\s*blur\(20px\)/);
});

test('la messagerie reçoit un cadre dark premium dédié sans modifier sa logique', () => {
  assert.match(layout, /location\.pathname\.startsWith\('\/emails'\)/);
  assert.match(layout, /premium-mail-route/);
  assert.match(css, /\.premium-mail-route main > div/);
  assert.match(css, /Email workspace: dark by design/);
});

test('la top bar premium garde recherche notifications et profil', () => {
  assert.match(topbar, /Rechercher dans le Cockpit/);
  assert.match(topbar, /Bell/);
  assert.match(topbar, /HelpCircle/);
  assert.match(topbar, /gradient-primary/);
});