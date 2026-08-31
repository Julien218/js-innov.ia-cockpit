const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const main = read('player-android/app/src/main/java/ia/jsinnov/pixeliumplayer/MainActivity.java');
const scheduled = read('player-android/app/src/main/java/ia/jsinnov/pixeliumplayer/ScheduledMainActivity.java');

test('Player 0.6.1 hides the status overlay and keeps a symmetric safe area', () => {
  assert.match(main, /status\.setVisibility\(View\.GONE\)/);
  assert.match(main, /SAFE_HORIZONTAL_INSET_RATIO\s*=\s*0\.015f/);
  assert.match(main, /mediaLayout\.setMargins\(horizontalInset, 0, horizontalInset, 0\)/);
  assert.match(main, /mediaSurface\.addView\(image/);
  assert.match(main, /mediaSurface\.addView\(video/);
});

test('Player 0.6.1 reports the exact media it is actually rendering', () => {
  assert.match(main, /markCurrentMedia\(pendingVideoMedia\)/);
  assert.match(main, /currentMediaName\s*=\s*media\.optString\("name"/);
  assert.match(main, /currentMediaUploadedAt\s*=\s*media\.optString\("created_at"/);
  assert.match(main, /void clearCurrentMedia\(\)/);
  for (const field of ['currentMediaId', 'currentMediaName', 'currentMediaMimeType', 'currentMediaUploadedAt', 'currentMediaStartedAt']) {
    assert.match(scheduled, new RegExp(`playback\\.put\\("${field}"`));
  }
  assert.match(scheduled, /clearCurrentMedia\(\)/);
});
