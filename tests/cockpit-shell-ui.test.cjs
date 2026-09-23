const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('cockpit layout keeps the audio player mounted across route changes', () => {
  const layout = read('src/components/layout/AppLayout.jsx');
  assert.match(layout, /<ElyneaAudioDockSynced\s*\/>/);
  assert.match(layout, /<Outlet\s*\/>/);
  assert.match(layout, /cockpit-shell/);
});

test('desktop navigation auto-expands on hover and is compact otherwise', () => {
  const sidebar = read('src/components/layout/Sidebar.jsx');
  assert.match(sidebar, /desktopHovered/);
  assert.match(sidebar, /onMouseEnter=\{\(\) => setDesktopHovered\(true\)\}/);
  assert.match(sidebar, /onMouseLeave=\{\(\) => setDesktopHovered\(false\)\}/);
  assert.match(sidebar, /const compact = !mobileOpen && !desktopHovered/);
});

test('dashboard exposes an email recap and floating electric surfaces', () => {
  const dashboard = read('src/pages/Dashboard.jsx');
  assert.match(dashboard, /dashboard-email-overview/);
  assert.match(dashboard, /Emails à traiter/);
  assert.match(dashboard, /cockpit-float-panel/);
  assert.match(dashboard, /cockpit-electric-frame/);
});

test('cockpit visual overrides remain scoped and do not introduce feather branding', () => {
  const css = read('src/premium-overrides.css');
  assert.match(css, /\.cockpit-shell/);
  assert.match(css, /cockpit-gold-trace/);
  assert.doesNotMatch(css, /plume|feather/i);
});


test('Mobile Hub inherits the transparent cockpit shell instead of forcing a dark page', () => {
  const mobile = read('src/pages/MobileHub.jsx');
  const css = read('src/premium-overrides.css');
  assert.match(mobile, /mobile-hub-page/);
  assert.match(mobile, /cockpit-float-panel/);
  assert.match(mobile, /<Link/);
  assert.doesNotMatch(mobile, /#0a0a14|background:\s*COLORS\.bg/);
  assert.match(css, /body:has\(\.cockpit-shell\)[\s\S]*background:\s*transparent/);
  assert.match(css, /rgba\(255, 255, 255, 0\.46\)/);
});
