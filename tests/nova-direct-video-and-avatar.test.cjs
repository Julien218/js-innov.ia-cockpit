const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('direct video route is mounted before the generic assistant routers', () => {
  const server = read('server.cjs');
  const direct = server.indexOf("require('./server-nova-video-direct.cjs')");
  const batch = server.indexOf("require('./server-assistant-batch.cjs')");
  const adaptive = server.indexOf("require('./server-assistant.cjs')");
  assert.ok(direct >= 0, 'direct video router must be mounted');
  assert.ok(batch > direct, 'direct video router must run before batch assistant');
  assert.ok(adaptive > direct, 'direct video router must run before adaptive assistant');
});

test('direct video route returns only real server job identifiers', () => {
  const direct = read('server-nova-video-direct.cjs');
  assert.match(direct, /createVideoGenerationJob\(payload, req\.user\)/);
  assert.match(direct, /if \(!job\?\.id\) throw new Error/);
  assert.match(direct, /simulated: false/);
  assert.match(direct, /reference_document_ids: referenceIds/);
  assert.match(direct, /end_source_document_id: referenceIds\[1\]/);
});

test('Docker runtime contains the direct video executor', () => {
  const docker = read('Dockerfile');
  assert.match(docker, /COPY --from=builder \/app\/server-nova-video-direct\.cjs \.\/server-nova-video-direct\.cjs/);
  assert.match(docker, /node --check \/app\/server-nova-video-direct\.cjs/);
});

test('Cockpit Elynea uses one canonical JS-Innov.IA 3D companion avatar with legacy NOVA compatibility', () => {
  const roleAware = read('src/components/RoleAwareFloatingAgent.jsx');
  const scope = read('src/components/ElyneaBrandScope.jsx');
  assert.match(scope, /avatar:\s*'https:\/\/www\.jsinnovia\.com\/brand\/companion\/companion-avatar-256\.webp'/);
  assert.match(scope, /export const OFFICIAL_ELYNEA_AVATAR = ELYNEA_COMPANION\.avatar/);
  assert.match(roleAware, /OFFICIAL_ELYNEA_AVATAR/);
  assert.match(roleAware, /img\[alt="NOVA"\], img\[alt="Elynea"\]/);
  assert.match(roleAware, /ElyneaBrandScope/);
  assert.match(scope, /replaceLegacyName/);
});
