const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadRoles() {
  const url = pathToFileURL(path.join(process.cwd(), 'src', 'lib', 'roles.js')).href;
  return import(url);
}

test('superadmin and admin can open production media routes', async () => {
  const { hasRouteAccess } = await loadRoles();
  const routes = [
    '/video-studio',
    '/video-studio/new',
    '/video-studio/project-123',
    '/ai-video',
    '/thumbnail',
    '/dour-campaign',
    '/exports',
    '/exported-videos',
    '/templates',
    '/calendar',
  ];

  for (const role of ['superadmin', 'admin']) {
    for (const route of routes) {
      assert.equal(hasRouteAccess(role, route), true, `${role} should access ${route}`);
    }
  }
});

test('client access is not broadened by media route wildcard support', async () => {
  const { hasRouteAccess } = await loadRoles();
  assert.equal(hasRouteAccess('client', '/video-studio'), false);
  assert.equal(hasRouteAccess('client', '/video-studio/new'), false);
  assert.equal(hasRouteAccess('client', '/ai-video'), false);
});

test('wildcard route matching stays segment-bound', async () => {
  const { hasRouteAccess } = await loadRoles();
  assert.equal(hasRouteAccess('superadmin', '/video-studio/new'), true);
  assert.equal(hasRouteAccess('superadmin', '/video-studioevil'), false);
});
