const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const topBarSource = fs.readFileSync(path.join(root, 'src', 'components', 'layout', 'TopBar.jsx'), 'utf8');

test('un incident critique restauré ne reste plus visible comme panne active', async () => {
  const { filterActiveNotifications } = await import('../src/lib/notificationLifecycle.js');
  const events = [
    {
      id: 'down',
      event_type: 'site.down',
      severity: 'critical',
      title: 'Incident critique — jsinnovia.com',
      created_at: '2026-09-16T18:00:00.000Z',
    },
    {
      id: 'restored',
      event_type: 'site.restored',
      severity: 'success',
      title: 'Service rétabli — jsinnovia.com',
      created_at: '2026-09-16T18:05:00.000Z',
    },
  ];

  assert.deepEqual(filterActiveNotifications(events).map(event => event.id), ['restored']);
});

test('une nouvelle panne après un rétablissement reste visible', async () => {
  const { filterActiveNotifications } = await import('../src/lib/notificationLifecycle.js');
  const events = [
    {
      id: 'old-down',
      event_type: 'site.down',
      title: 'Incident critique — jsinnovia.com',
      created_at: '2026-09-16T18:00:00.000Z',
    },
    {
      id: 'restored',
      event_type: 'site.restored',
      title: 'Service rétabli — jsinnovia.com',
      created_at: '2026-09-16T18:05:00.000Z',
    },
    {
      id: 'new-down',
      event_type: 'site.down',
      title: 'Incident critique — jsinnovia.com',
      created_at: '2026-09-16T18:10:00.000Z',
    },
  ];

  assert.deepEqual(filterActiveNotifications(events).map(event => event.id), ['restored', 'new-down']);
});

test('un événement explicitement résolu reste dans l’historique brut mais sort du flux actif', async () => {
  const { filterActiveNotifications } = await import('../src/lib/notificationLifecycle.js');
  const events = [
    {
      id: 'resolved-down',
      event_type: 'site.down',
      active: false,
      title: 'Incident critique — example.test',
      created_at: '2026-09-16T18:00:00.000Z',
      resolved_at: '2026-09-16T18:02:00.000Z',
    },
    { id: 'info', event_type: 'project.updated', created_at: '2026-09-16T18:03:00.000Z' },
  ];

  assert.equal(events.length, 2);
  assert.deepEqual(filterActiveNotifications(events).map(event => event.id), ['info']);
});

test('la TopBar filtre le cycle de vie avant d’afficher les notifications', () => {
  assert.match(topBarSource, /filterActiveNotifications/);
  assert.match(topBarSource, /setNotifications\(filterActiveNotifications\(/);
});
