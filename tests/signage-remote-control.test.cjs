const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('remote command migration is additive, scoped and secret-free', () => {
  const sql = read('migrations/009_signage_remote_commands.sql');
  const postgres = read('server-postgres.cjs');
  assert.match(sql, /create table if not exists public\.signage_player_commands/i);
  assert.match(sql, /player_id uuid not null references public\.signage_players/i);
  assert.match(sql, /expires_at timestamptz/i);
  assert.match(sql, /enable row level security/i);
  assert.doesNotMatch(sql, /token_hash|drop table|truncate/i);
  assert.match(postgres, /'signage_player_commands'/);
  assert.match(postgres, /009_signage_remote_commands\.sql/);
  assert.match(postgres, /new Set\(\['payload','result'\]\)/);
});

test('only Super Admin can queue validated remote commands', () => {
  const server = read('server-signage-remote-control.cjs');
  assert.match(server, /req\.user\?\.role !== 'superadmin'/);
  assert.match(server, /ALLOWED\.has\(command\)/);
  assert.match(server, /owner_email=eq/);
  assert.match(server, /token_hash=eq/);
  assert.match(server, /signage_audit_events/);
  assert.match(server, /for update skip locked/i);
  assert.doesNotMatch(server, /adb|setprop|Runtime\.getRuntime|ProcessBuilder|\bsu\b/i);
});

test('Player executes supported controls without root or shell access', () => {
  const player = read('player-android/app/src/main/java/ia/jsinnov/pixeliumplayer/MainActivity.java');
  for (const command of ['restart_player','reload_content','pause_playback','resume_playback','set_volume','set_brightness','set_orientation','set_display_mode','update_now']) {
    assert.match(player, new RegExp(`case "${command}"`));
  }
  assert.match(player, /getSupportedModes\(\)/);
  assert.match(player, /preferredDisplayModeId/);
  assert.match(player, /commands\/next/);
  assert.match(player, /commands\/" \+ commandId \+ "\/ack/);
  assert.doesNotMatch(player, /Runtime\.getRuntime|ProcessBuilder|setprop|\bsu\b|\/system\/bin/i);
});

test('Super Admin UI exposes command status and capability limits', () => {
  const ui = read('src/components/signage/SignageDisplayManager.jsx');
  assert.match(ui, /Télécommande Super Admin/);
  assert.match(ui, /pause_playback/);
  assert.match(ui, /restart_player/);
  assert.match(ui, /set_display_mode/);
  assert.match(ui, /Dernières commandes/);
  assert.match(ui, /droits constructeur ou une API réseau/);
});
