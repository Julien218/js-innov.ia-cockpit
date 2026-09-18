const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { extractVisualManifest, trackingUrl } = require('../server-social-command.cjs');

test('Social Command extrait une identité visuelle depuis le site dédié', () => {
  const html = `<!doctype html>
  <html><head>
    <title>Miss & Mister Dour</title>
    <meta name="theme-color" content="#0b1437">
    <meta property="og:image" content="/assets/share.jpg">
    <link rel="icon" href="/favicon.png">
    <style>:root{--brand-gold:#d8b25c;--brand-night:#0b1437} body{font-family:'Playfair Display', serif;color:#ffffff}</style>
  </head></html>`;
  const manifest = extractVisualManifest(html, 'https://missetmisterdour.be/');
  assert.equal(manifest.source, 'site-html');
  assert.equal(manifest.source_title, 'Miss & Mister Dour');
  assert.equal(manifest.theme_color, '#0b1437');
  assert.equal(manifest.css_variables['--brand-gold'], '#d8b25c');
  assert.equal(manifest.favicon, 'https://missetmisterdour.be/favicon.png');
  assert.equal(manifest.social_image, 'https://missetmisterdour.be/assets/share.jpg');
  assert.equal(manifest.visual_rules.source_of_truth, 'dedicated_site');
});

test('Social Command génère une URL de conversion traçable', () => {
  const url = trackingUrl('https://missetmisterdour.be/inscription?lang=fr', {
    platform: 'tiktok',
    campaignId: 'campaign-2027',
    postId: 'post-004',
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('lang'), 'fr');
  assert.equal(parsed.searchParams.get('utm_source'), 'tiktok');
  assert.equal(parsed.searchParams.get('utm_medium'), 'social');
  assert.equal(parsed.searchParams.get('jsi_campaign_id'), 'campaign-2027');
  assert.equal(parsed.searchParams.get('jsi_post_id'), 'post-004');
});

test('Social Command est déclaré dans les permissions et le runtime Railway', () => {
  const root = path.join(__dirname, '..');
  const permissions = JSON.parse(fs.readFileSync(path.join(root, 'permission-catalog.json'), 'utf8'));
  const social = permissions.find((item) => item.code === 'social_command');
  assert.ok(social);
  assert.ok(social.routes.includes('/social-command'));
  assert.ok(social.roles.includes('admin'));

  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /server-social-command\.cjs/);
  const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
  assert.match(server, /\/api\/social/);
});

test('Le bridge local utilise un polling adaptatif et non un intervalle cloud fixe', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'LocalAgentQueueBridge.jsx'), 'utf8');
  assert.match(source, /IDLE_INTERVAL_MS = 5 \* 60_000/);
  assert.match(source, /HIDDEN_INTERVAL_MS = 15 \* 60_000/);
  assert.match(source, /ERROR_BACKOFF_MS/);
  assert.doesNotMatch(source, /setInterval\(/);
});
