const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const helperPath = path.join(__dirname, '..', 'src', 'lib', 'avatarFactoryProgress.js');
const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'AvatarFactory.jsx'), 'utf8');

test('Avatar Factory progress follows the five real pipeline stages', async () => {
  const { getAvatarProductionProgress } = await import(pathToFileURL(helperPath));
  assert.deepEqual(getAvatarProductionProgress({ status: 'queued' }).percent, 5);
  assert.deepEqual(getAvatarProductionProgress({ status: 'running', current_stage: 'shape_3d' }).percent, 40);
  assert.deepEqual(getAvatarProductionProgress({ status: 'awaiting_approval', current_stage: 'human_approval' }).percent, 95);
  assert.deepEqual(getAvatarProductionProgress({ status: 'completed' }).percent, 100);
});

test('a failed quality gate is never presented as a completed production', async () => {
  const { formatAvatarFactoryError, getAvatarProductionProgress } = await import(pathToFileURL(helperPath));
  const progress = getAvatarProductionProgress({ status: 'failed', current_stage: 'runtime_qa' });
  assert.equal(progress.percent, 80);
  assert.equal(progress.tone, 'error');
  assert.match(progress.title, /échec/i);
  assert.match(formatAvatarFactoryError('Runtime QA failed: mesh_fragmented_too_many_components'), /maillage est trop fragmenté/i);
});

test('Avatar Factory renders accessible live production progress', () => {
  assert.ok(page.includes('role="progressbar"'));
  assert.ok(page.includes('Progression par étapes réelles, sans estimation du temps restant'));
  assert.ok(page.includes('<ProductionProgress job={selectedJob} prominent />'));
  assert.ok(page.includes('<ProductionProgress job={job} compact />'));
});
