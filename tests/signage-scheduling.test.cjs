const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  belgianHolidayName,
  zonedParts,
  evaluatePlayerAdSchedule,
} = require('../server-signage-schedule.cjs');

function makeDb({ settings, exception = null, ranges = [] }) {
  return async resource => {
    if (resource.startsWith('signage_player_schedule_settings?')) return settings ? [settings] : [];
    if (resource.startsWith('signage_player_schedule_exceptions?')) return exception ? [exception] : [];
    if (resource.startsWith('signage_player_schedule_ranges?')) return ranges;
    throw new Error(`Unexpected resource ${resource}`);
  };
}

test('Belgian legal holidays include fixed and movable dates', () => {
  assert.equal(belgianHolidayName('2026-01-01'), 'Nouvel An');
  assert.equal(belgianHolidayName('2026-05-01'), 'Fête du Travail');
  assert.equal(belgianHolidayName('2026-07-21'), 'Fête nationale');
  assert.equal(belgianHolidayName('2026-08-15'), 'Assomption');
  assert.equal(belgianHolidayName('2026-11-01'), 'Toussaint');
  assert.equal(belgianHolidayName('2026-11-11'), 'Armistice');
  assert.equal(belgianHolidayName('2026-12-25'), 'Noël');
  assert.equal(belgianHolidayName('2026-04-06'), 'Lundi de Pâques');
  assert.equal(belgianHolidayName('2026-05-14'), 'Ascension');
  assert.equal(belgianHolidayName('2026-05-25'), 'Lundi de Pentecôte');
  assert.equal(belgianHolidayName('2026-08-17'), null);
});

test('Brussels timezone is used for local schedule decisions', () => {
  const local = zonedParts(new Date('2026-08-17T06:30:00.000Z'));
  assert.equal(local.dateKey, '2026-08-17');
  assert.equal(local.hour, 8);
  assert.equal(local.minute, 30);
  assert.equal(local.dayOfWeek, 1);
});

test('legacy players remain allowed until a schedule is configured', async () => {
  const decision = await evaluatePlayerAdSchedule({
    db: makeDb({ settings: null }),
    playerId: 'player-1',
    ownerEmail: 'client@example.com',
    now: new Date('2026-08-17T06:30:00.000Z'),
  });
  assert.deepEqual(decision, { adsAllowed: true, reason: 'legacy_unconfigured', nextChangeAt: null });
});

test('manual closed exception wins over weekly hours', async () => {
  const decision = await evaluatePlayerAdSchedule({
    db: makeDb({
      settings: { configured: true, block_belgian_holidays: true },
      exception: { mode: 'closed', ranges: [] },
      ranges: [{ start_time: '08:00', end_time: '18:00' }],
    }),
    playerId: 'player-1',
    ownerEmail: 'client@example.com',
    now: new Date('2026-08-17T08:00:00.000Z'),
  });
  assert.equal(decision.adsAllowed, false);
  assert.equal(decision.reason, 'date_exception_closed');
});

test('normal exception bypasses Belgian holiday block but still uses weekly schedule', async () => {
  const decision = await evaluatePlayerAdSchedule({
    db: makeDb({
      settings: { configured: true, block_belgian_holidays: true },
      exception: { mode: 'normal', ranges: [] },
      ranges: [{ start_time: '08:00', end_time: '18:00' }],
    }),
    playerId: 'player-1',
    ownerEmail: 'client@example.com',
    now: new Date('2026-07-21T08:00:00.000Z'),
  });
  assert.equal(decision.adsAllowed, true);
  assert.equal(decision.reason, 'weekly_schedule');
});

test('Belgian holiday blocks ads when no manual exception exists', async () => {
  const decision = await evaluatePlayerAdSchedule({
    db: makeDb({
      settings: { configured: true, block_belgian_holidays: true },
      ranges: [{ start_time: '00:00', end_time: '23:59' }],
    }),
    playerId: 'player-1',
    ownerEmail: 'client@example.com',
    now: new Date('2026-07-21T08:00:00.000Z'),
  });
  assert.equal(decision.adsAllowed, false);
  assert.match(decision.reason, /^belgian_holiday:/);
});

test('weekly schedule allows inside range and blocks outside range', async () => {
  const db = makeDb({
    settings: { configured: true, block_belgian_holidays: false },
    ranges: [{ start_time: '08:00', end_time: '18:00' }],
  });
  const inside = await evaluatePlayerAdSchedule({ db, playerId: 'p', ownerEmail: 'a@b.be', now: new Date('2026-08-17T10:00:00.000Z') });
  const outside = await evaluatePlayerAdSchedule({ db, playerId: 'p', ownerEmail: 'a@b.be', now: new Date('2026-08-17T19:00:00.000Z') });
  assert.equal(inside.adsAllowed, true);
  assert.equal(outside.adsAllowed, false);
});

test('cockpit and Android player are wired for schedule-aware operation without token reprovisioning', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const wrapper = fs.readFileSync(path.join(root, 'src', 'pages', 'DigitalSignageScheduled.jsx'), 'utf8');
  const panel = fs.readFileSync(path.join(root, 'src', 'components', 'signage', 'SignageSchedulePanel.jsx'), 'utf8');
  const android = fs.readFileSync(path.join(root, 'player-android', 'app', 'src', 'main', 'java', 'ia', 'jsinnov', 'pixeliumplayer', 'ScheduledMainActivity.java'), 'utf8');
  const manifest = fs.readFileSync(path.join(root, 'player-android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');

  assert.match(app, /DigitalSignageScheduled/);
  assert.match(wrapper, /SignageSchedulePanel/);
  assert.match(panel, /blockBelgianHolidays/);
  assert.match(panel, /exceptions/);
  assert.match(android, /optBoolean\("adsAllowed", true\)/);
  assert.match(android, /blockAdvertising/);
  assert.match(android, /cachedBlockStillActive/);
  assert.match(android, /0\.5\.0-pilot/);
  assert.match(manifest, /ScheduledMainActivity/);
  assert.doesNotMatch(android, /rotate-token|token_hash|enrollmentToken/);
});
