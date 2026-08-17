const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('display manager migration is additive and never touches player tokens', () => {
  const sql = read('migrations/007_signage_display_manager.sql');
  assert.match(sql, /create table if not exists public\.signage_sites/i);
  assert.match(sql, /create table if not exists public\.signage_display_profiles/i);
  assert.match(sql, /alter table public\.signage_players add column if not exists site_id/i);
  assert.doesNotMatch(sql, /token_hash\s*=/i);
  assert.doesNotMatch(sql, /drop table|truncate/i);
});

test('Android telemetry reports real Build and Display values without EDID fabrication', () => {
  const java = read('player-android/app/src/main/java/ia/jsinnov/pixeliumplayer/DisplayTelemetry.java');
  for (const field of ['Build.MANUFACTURER','Build.MODEL','Build.DEVICE','Build.PRODUCT','Build.HARDWARE','Build.BOARD','Build.VERSION.SDK_INT']) {
    assert.match(java, new RegExp(field.replace('.', '\\.')));
  }
  assert.match(java, /getSupportedModes\(\)/);
  assert.match(java, /getPhysicalWidth\(\)/);
  assert.match(java, /getPhysicalHeight\(\)/);
  assert.match(java, /getRefreshRate\(\)/);
  assert.match(java, /getHdrCapabilities\(\)/);
  assert.match(java, /"edidAvailable", false/);
  assert.match(java, /unavailable_public_sdk/);
  assert.match(java, /"physicalConnector", "unknown"/);
  assert.doesNotMatch(java, /Runtime\.getRuntime|ProcessBuilder|su\b|setprop|sys\/class\/drm/);
});

test('heartbeat extends the existing scheduling player instead of reprovisioning it', () => {
  const java = read('player-android/app/src/main/java/ia/jsinnov/pixeliumplayer/ScheduledMainActivity.java');
  assert.match(java, /DisplayTelemetry\.device\(\)/);
  assert.match(java, /DisplayTelemetry\.display\(this\)/);
  assert.match(java, /playbackTelemetry\(\)/);
  assert.match(java, /\/api\/signage\/player\/heartbeat/);
  assert.match(java, /scheduleAware/);
  assert.doesNotMatch(java, /rotate-token|token_hash|enrollmentToken/);
});

test('display profile API is observe-only and rejects unadvertised MANUAL modes', () => {
  const server = read('server-signage-display.cjs');
  assert.match(server, /controlEnabled: false/);
  assert.match(server, /control_capability: 'observe_only'/);
  assert.match(server, /mode === 'MANUAL'/);
  assert.match(server, /advertised\.some/);
  assert.match(server, /Aucun forçage ne sera effectué/);
  assert.match(server, /Super Admin requis/);
  assert.doesNotMatch(server, /adb|setprop|wm size|wm density|su\b|root/i);
});

test('health model distinguishes player, schedule, publication, HDMI and playback states', () => {
  const server = read('server-signage-display.cjs');
  for (const state of ['PLAYER_OFFLINE','DISPLAY_ERROR','DISPLAY_MODE_WARNING','OUT_OF_SCHEDULE','NO_PUBLICATION','WAITING_ACK','CONTENT_UNCONFIRMED']) {
    assert.match(server, new RegExp(state));
  }
  assert.match(server, /PUBLICATION ACK \/ CONTENU EN LECTURE/);
  assert.match(server, /HDMI NON DÉTECTÉ/);
});

test('Super Admin UI exposes diagnostics and only advertised display modes', () => {
  const ui = read('src/components/signage/SignageDisplayManager.jsx');
  assert.match(ui, /Display \/ HDMI Manager/);
  assert.match(ui, /GLOBAL HEALTH/);
  assert.match(ui, /Manufacturer/);
  assert.match(ui, /EDID/);
  assert.match(ui, /supportedModes\.map/);
  assert.match(ui, /AUTO/);
  assert.match(ui, /PROFILE/);
  assert.match(ui, /MANUAL/);
  assert.match(ui, /Observe only/);
  assert.match(ui, /aucun root, shell, firmware, reset, token ou changement HDMI/i);
});
