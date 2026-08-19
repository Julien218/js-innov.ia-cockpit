const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('display manager migrations are additive and never touch player tokens', () => {
  const displaySql = read('migrations/007_signage_display_manager.sql');
  const runtimeSql = read('migrations/008_signage_player_runtime_health.sql');
  assert.match(displaySql, /create table if not exists public\.signage_sites/i);
  assert.match(displaySql, /create table if not exists public\.signage_display_profiles/i);
  assert.match(displaySql, /alter table public\.signage_players add column if not exists site_id/i);
  assert.match(runtimeSql, /runtime_last_seen_at/i);
  assert.match(runtimeSql, /runtime_version/i);
  assert.match(runtimeSql, /runtime_diagnostics jsonb/i);
  assert.doesNotMatch(`${displaySql}\n${runtimeSql}`, /token_hash\s*=/i);
  assert.doesNotMatch(`${displaySql}\n${runtimeSql}`, /drop table|truncate/i);
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

test('playback heartbeat extends the existing scheduling player without reprovisioning it', () => {
  const java = read('player-android/app/src/main/java/ia/jsinnov/pixeliumplayer/ScheduledMainActivity.java');
  assert.match(java, /DisplayTelemetry\.device\(\)/);
  assert.match(java, /DisplayTelemetry\.display\(this\)/);
  assert.match(java, /playbackTelemetry\(\)/);
  assert.match(java, /\/api\/signage\/player\/heartbeat/);
  assert.match(java, /PlayerRuntimeState\.markPlaybackHeartbeat/);
  assert.match(java, /scheduleAware/);
  assert.doesNotMatch(java, /rotate-token|token_hash|enrollmentToken/);
});

test('guardian owns an independent authenticated runtime heartbeat', () => {
  const guardian = read('player-android/app/src/main/java/ia/jsinnov/pixeliumplayer/PixeliumGuardianService.java');
  const runtimeServer = read('server-signage-runtime.cjs');
  const manifest = read('player-android/app/src/main/AndroidManifest.xml');
  assert.match(guardian, /\/api\/signage\/player\/runtime-heartbeat/);
  assert.match(guardian, /START_STICKY/);
  assert.match(guardian, /NetworkCallback/);
  assert.match(guardian, /PlayerRuntimeState\.playbackHeartbeatAt/);
  assert.match(runtimeServer, /token_hash=eq/);
  assert.match(runtimeServer, /runtime_last_seen_at/);
  assert.match(runtimeServer, /runtime_diagnostics/);
  assert.doesNotMatch(runtimeServer, /token_hash\s*:/);
  assert.match(manifest, /FOREGROUND_SERVICE_SPECIAL_USE/);
  assert.match(manifest, /foregroundServiceType="specialUse"/);
  assert.match(manifest, /android\.intent\.category\.HOME/);
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

test('health model distinguishes runtime, player, schedule, publication, HDMI and playback states', () => {
  const server = read('server-signage-display.cjs');
  for (const state of ['PLAYER_OFFLINE','PLAYER_APP_ERROR','DISPLAY_ERROR','DISPLAY_MODE_WARNING','OUT_OF_SCHEDULE','NO_PUBLICATION','WAITING_ACK','CONTENT_UNCONFIRMED']) {
    assert.match(server, new RegExp(state));
  }
  assert.match(server, /TVBOX CONNECTÉ \/ PLAYER NON ACTIF/);
  assert.match(server, /runtimeHeartbeatAgeMs/);
  assert.match(server, /playbackHeartbeatAgeMs/);
  assert.match(server, /PUBLICATION ACK \/ CONTENU EN LECTURE/);
  assert.match(server, /HDMI NON DÉTECTÉ/);
});

test('Super Admin UI exposes separate TVBOX and Player diagnostics', () => {
  const ui = read('src/components/signage/SignageDisplayManager.jsx');
  assert.match(ui, /Display \/ HDMI Manager/);
  assert.match(ui, /GLOBAL HEALTH/);
  assert.match(ui, /TVBOX RUNTIME/);
  assert.match(ui, /PLAYER APP/);
  assert.match(ui, /Heartbeat TVBOX/);
  assert.match(ui, /Heartbeat lecture/);
  assert.match(ui, /Mode accueil \/ kiosk/);
  assert.match(ui, /Manufacturer/);
  assert.match(ui, /EDID/);
  assert.match(ui, /supportedModes\.map/);
  assert.match(ui, /AUTO/);
  assert.match(ui, /PROFILE/);
  assert.match(ui, /MANUAL/);
  assert.match(ui, /Observe only/);
  assert.match(ui, /aucun root, shell, firmware, reset, token ou changement HDMI/i);
});
