const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('navigation identifies child routes without activating sibling prefixes', async () => {
  const { isNavigationActive } = await import('../src/lib/navigation.js');
  assert.equal(isNavigationActive('/emails-core', '/emails'), false);
  assert.equal(isNavigationActive('/emails/inbox', '/emails'), true);
  assert.equal(isNavigationActive('/clients', '/'), false);
  assert.equal(isNavigationActive('/', '/'), true);
});

test('calendar uses the CRM entity and real routes; music studio remains admin scoped', () => {
  const calendar = fs.readFileSync(path.join(__dirname, '../src/pages/ProjectCalendar.jsx'), 'utf8');
  assert.match(calendar, /entities\.Projet\.list/);
  assert.doesNotMatch(calendar, /entities\.Project\.|\/project\//);
  assert.doesNotMatch(calendar, /toISOString/);
  assert.match(calendar, /date_fin_prevue/);
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../permission-catalog.json'), 'utf8'));
  const module = catalog.find(item => item.routes.includes('/music-motion'));
  assert.equal(module.code, 'production');
  assert.deepEqual(module.roles, ['admin']);
  const app = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');
  assert.match(app, /path="\/exported-videos" element=\{<Navigate to="\/exports" replace/);
});

test('page search handles accents, permissions, client routes and insurance restrictions', async () => {
  const { searchNavigation } = await import('../src/lib/navigation.js');
  const groups = [{label:'Finance', items:[{label:'Devis',path:'/devis'},{label:'Factures',path:'/factures'}]}, {label:'Projets', items:[{label:'Tâches',path:'/taches'},{label:'Assurances',path:'/assurances',insuranceOnly:true}]}];
  const options = { role:'client', canAccess: path => path === '/mes-devis' };
  assert.deepEqual(searchNavigation(groups, '', options).map(x=>x.path), ['/mes-devis']);
  assert.equal(searchNavigation(groups, 'taches', {...options,canAccess:()=>true})[0].path, '/taches');
  assert.equal(searchNavigation(groups, 'assurances', {...options,canAccess:()=>true}).length, 0);
  assert.equal(searchNavigation(groups, 'assurances', {...options,insuranceAllowed:true}).length, 1);
  assert.equal(searchNavigation(groups, 'introuvable', options).length, 0);
});
