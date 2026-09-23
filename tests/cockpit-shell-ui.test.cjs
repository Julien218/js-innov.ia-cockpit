const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('cockpit layout keeps exactly one persistent audio player across route changes', () => {
  const layout = read('src/components/layout/AppLayout.jsx');
  const companion = read('src/components/RoleAwareFloatingAgent.jsx');
  assert.match(layout, /<ElyneaAudioDockSynced\s*\/>/);
  assert.match(layout, /<Outlet\s*\/>/);
  assert.match(layout, /cockpit-shell/);
  assert.doesNotMatch(companion, /ElyneaAudioDockSynced/);
});

test('desktop navigation auto-expands on hover and is compact otherwise', () => {
  const sidebar = read('src/components/layout/Sidebar.jsx');
  assert.match(sidebar, /desktopHovered/);
  assert.match(sidebar, /onMouseEnter=\{\(\) => setDesktopHovered\(true\)\}/);
  assert.match(sidebar, /onMouseLeave=\{\(\) => setDesktopHovered\(false\)\}/);
  assert.match(sidebar, /const compact = !mobileOpen && !desktopHovered/);
});

test('dashboard follows the approved reference composition', () => {
  const dashboard = read('src/pages/Dashboard.jsx');
  assert.match(dashboard, /dashboard-email-overview/);
  assert.match(dashboard, /Emails à traiter/);
  assert.match(dashboard, /Actions rapides/);
  assert.match(dashboard, /Projets récents/);
  assert.match(dashboard, /Tâches prioritaires/);
  assert.match(dashboard, /Activité & Notifications/);
  assert.match(dashboard, /Pipeline leads/);
  assert.match(dashboard, /cockpit-reference-elynea/);
  assert.match(dashboard, /OFFICIAL_ELYNEA_AVATAR/);
  assert.match(dashboard, /elynea:open/);
});

test('cockpit reference background and gold tracer remain scoped without feather branding', () => {
  const css = read('src/premium-overrides.css');
  const backdrop = read('public/cockpit-sunset.svg');
  assert.match(css, /\.cockpit-shell/);
  assert.match(css, /url\("\/cockpit-sunset\.svg"\)/);
  assert.match(css, /cockpit-gold-run/);
  assert.match(css, /animation:\s*cockpit-gold-run\s+5\.4s\s+linear\s+infinite/);
  assert.match(css, /cockpit-reference-elynea/);
  assert.match(backdrop, /panoramique JS-Innov\.IA/);
  assert.doesNotMatch(css, /plume|feather/i);
  assert.doesNotMatch(backdrop, /plume|feather/i);
});

test('Mobile Hub inherits the same floating cockpit system', () => {
  const mobile = read('src/pages/MobileHub.jsx');
  const css = read('src/premium-overrides.css');
  assert.match(mobile, /mobile-hub-page/);
  assert.match(mobile, /cockpit-float-panel/);
  assert.match(mobile, /<Link/);
  assert.doesNotMatch(mobile, /#0a0a14|background:\s*COLORS\.bg/);
  assert.match(css, /body:has\(\.cockpit-shell\)[\s\S]*cockpit-sunset\.svg/);
});


test('gold tracer remains animated and cockpit buttons react on hover', () => {
  const css = read('src/premium-overrides.css');
  const dashboard = read('src/pages/Dashboard.jsx');
  assert.match(css, /@keyframes cockpit-gold-run/);
  assert.match(css, /\.cockpit-shell button:not\(:disabled\):hover/);
  assert.match(css, /transform:\s*translateY\(-2px\) scale\(1\.025\)/);
  assert.match(css, /@keyframes cockpit-icon-response/);
  assert.match(css, /prefers-reduced-motion:[\s\S]*animation-duration:\s*11s/);
  assert.doesNotMatch(css, /prefers-reduced-motion:[\s\S]*cockpit-electric-frame::before[\s\S]*animation:\s*none/);
  assert.match(dashboard, /cockpit-reference-kpi cockpit-electric-frame/);
});
