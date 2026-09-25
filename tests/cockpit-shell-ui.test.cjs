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

test('dashboard is Jarvis-first instead of duplicating the Elynea assistant panel', () => {
  const dashboard = read('src/pages/Dashboard.jsx');
  assert.match(dashboard, /jarvis-home/);
  assert.match(dashboard, /Mode Jarvis/);
  assert.match(dashboard, /Appeler Elynea/);
  assert.match(dashboard, /Projets récents/);
  assert.match(dashboard, /Priorités/);
  assert.match(dashboard, /elynea:open/);
  assert.doesNotMatch(dashboard, /cockpit-reference-elynea-portrait/);
  assert.doesNotMatch(dashboard, /Actions rapides/);
  assert.doesNotMatch(dashboard, /Pipeline leads/);
});

test('cockpit uses real Electron transparency while keeping the gold tracer', () => {
  const css = read('src/premium-overrides.css');
  const layout = read('src/components/layout/AppLayout.jsx');
  assert.match(css, /html\.electron-cockpit[\s\S]*background:\s*transparent/);
  assert.match(css, /background-image:\s*none/);
  assert.doesNotMatch(css, /cockpit-sunset\.svg/);
  assert.match(css, /cockpit-gold-run/);
  assert.match(css, /animation:\s*cockpit-gold-run\s+5\.4s\s+linear\s+infinite/);
  assert.match(css, /cockpit-reference-elynea/);
  assert.doesNotMatch(layout, /cockpit-ambient/);
  assert.doesNotMatch(css, /plume|feather/i);
});

test('Mobile Hub inherits the same floating cockpit system', () => {
  const mobile = read('src/pages/MobileHub.jsx');
  const css = read('src/premium-overrides.css');
  assert.match(mobile, /mobile-hub-page/);
  assert.match(mobile, /cockpit-float-panel/);
  assert.match(mobile, /<Link/);
  assert.doesNotMatch(mobile, /#0a0a14|background:\s*COLORS\.bg/);
  assert.match(css, /body:has\(\.cockpit-shell\)[\s\S]*background:\s*transparent/);
  assert.doesNotMatch(css, /cockpit-sunset\.svg/);
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
  assert.match(dashboard, /quiet-home-metrics/);
  const audio = read('src/components/audio/ElyneaAudioDock.jsx');
  assert.match(audio, /cockpit-audio-dock cockpit-electric-frame/);
});


test('Elynea audio player can persist and apply an explicit Windows output device', () => {
  const audio = read('src/components/audio/ElyneaAudioDock.jsx');
  assert.match(audio, /elynea_audio_output_device/);
  assert.match(audio, /enumerateDevices\(\)/);
  assert.match(audio, /device\.kind === 'audiooutput'/);
  assert.match(audio, /audio\.setSinkId\(sinkId\)/);
  assert.match(audio, /Sortie système Windows/);
  assert.match(audio, /Périphérique de sortie audio/);
});


test('Jarvis-first home uses darker transparent glass instead of milky panels', () => {
  const css = read('src/premium-overrides.css');
  assert.match(css, /\.jarvis-home \.cockpit-reference-kpi/);
  assert.match(css, /rgba\(7, 15, 28, \.58\)/);
  assert.match(css, /backdrop-filter:\s*blur\(16px\)/);
});

test('Elynea player recovers a legacy 1 percent volume and exposes a visible 100 percent reset', () => {
  const audio = read('src/components/audio/ElyneaAudioDock.jsx');
  assert.match(audio, /stored > 0\.02/);
  assert.match(audio, /return 1;/);
  assert.match(audio, /resetVolume/);
  assert.match(audio, /Volume Elynea/);
  assert.match(audio, />100 %</);
});
