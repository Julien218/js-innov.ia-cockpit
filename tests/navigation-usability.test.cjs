const test = require('node:test');
const assert = require('node:assert/strict');

test('navigation identifies child routes without activating sibling prefixes', async () => {
  const { isNavigationActive } = await import('../src/lib/navigation.js');
  assert.equal(isNavigationActive('/emails-core', '/emails'), false);
  assert.equal(isNavigationActive('/emails/inbox', '/emails'), true);
  assert.equal(isNavigationActive('/clients', '/'), false);
  assert.equal(isNavigationActive('/', '/'), true);
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
