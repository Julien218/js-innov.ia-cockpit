const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryRouter, matchRoutes } = require('react-router-dom');
const fs = require('node:fs');
const path = require('node:path');

test('every declared Cockpit path remains matchable after the router security upgrade', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');
  const paths = [...app.matchAll(/<Route path="([^"]+)"/g)].map(match => match[1]).filter(value => value !== '*');
  assert.ok(paths.length > 40);
  const routes = paths.map(routePath => ({path:routePath}));
  for (const routePath of paths) {
    const concrete = routePath.replace(/:[A-Za-z_]+/g, 'audit-example');
    assert.ok(matchRoutes(routes, concrete), concrete);
  }
});

test('programmatic navigation keeps studio parameters, search and back history', async () => {
  const router = createMemoryRouter([{path:'/'},{path:'/templates'},{path:'/video-studio/:id'},{path:'/exports'}], {initialEntries:['/templates']});
  try {
    await router.navigate('/video-studio/fixture-1');
    assert.equal(router.state.matches.at(-1).params.id, 'fixture-1');
    await router.navigate('/exports?search=film');
    assert.equal(router.state.location.search, '?search=film');
    await router.navigate(-1);
    assert.equal(router.state.location.pathname, '/video-studio/fixture-1');
  } finally { router.dispose(); }
});
