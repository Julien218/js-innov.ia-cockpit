const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('the dashboard starts in the approved Jarvis-first work area', () => {
  const source = read('src/pages/Dashboard.jsx');
  assert.match(source, /Mode Jarvis/);
  assert.match(source, /Appeler Elynea/);
  assert.match(source, /Priorités/);
  assert.match(source, /Projets récents/);
  assert.match(source, /elynea:open/);
  assert.doesNotMatch(source, /Actions rapides/);
  assert.doesNotMatch(source, /cockpit-reference-elynea-portrait/);
});

test('the task workspace supports search, filters and progressive display', () => {
  const source = read('src/pages/Taches.jsx');
  assert.match(source, /statusFilter/);
  assert.match(source, /search=\{search\}/);
  assert.match(source, /Priorité aux blocages réels et aux échéances/);
  assert.match(source, /Afficher 25 de plus/);
  assert.match(source, /filteredTasks\.slice\(0, visibleCount\)/);
});

test('clients remain readable without a horizontal table on smaller screens', () => {
  const source = read('src/pages/Clients.jsx');
  assert.match(source, /fiches à compléter/);
  assert.match(source, /hidden lg:block data-surface/);
  assert.match(source, /grid gap-3 lg:hidden/);
  assert.match(source, /TVA manquante/);
});

test('production emphasizes the two primary services', () => {
  const source = read('src/pages/Production.jsx');
  assert.match(source, /Que veux-tu produire maintenant/);
  assert.match(source, /Créer une vidéo/);
  assert.match(source, /Piloter l’écran géant/);
  assert.match(source, /ACTIONS\.slice\(2\)/);
});

test('the navigation stays compact by default, expands on hover and exposes the active item', () => {
  const source = read('src/components/layout/Sidebar.jsx');
  assert.match(source, /desktopHovered/);
  assert.match(source, /const compact = !mobileOpen && !desktopHovered/);
  assert.match(source, /onMouseEnter=\{\(\) => setDesktopHovered\(true\)\}/);
  assert.match(source, /onMouseLeave=\{\(\) => setDesktopHovered\(false\)\}/);
  assert.match(source, /\? "active"/);
});

