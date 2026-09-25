import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { CONTROL_FILES, classifyPath, auditPaths } from '../scripts/source-protection-audit.mjs';

const script = fileURLToPath(new URL('../scripts/source-protection-audit.mjs', import.meta.url));

test('blocks actual environment filenames, including nested and Windows paths', () => {
  for (const file of ['.env', '.env.production', 'app/.env.local', 'app\\.env.secret', '.ENV']) {
    assert.equal(classifyPath(file), 'environment-file', file);
  }
});

test('allows explicit sample filenames without claiming their contents are safe', () => {
  for (const file of ['.env.example', 'server/.env.production.sample', '.env.template']) {
    assert.equal(classifyPath(file), null, file);
  }
  assert.equal(classifyPath('.env.example.local'), 'environment-file');
});

test('blocks credential stores and private-key container filenames', () => {
  for (const file of ['id_rsa', 'keys/id_ed25519', 'certs/signing.p12', 'signing.PFX', 'api.key', '.git-credentials']) {
    assert.equal(classifyPath(file), 'credential-or-private-key-file', file);
  }
});

test('does not block public SSH keys or public certificate filenames', () => {
  for (const file of ['id_rsa.pub', 'ca.pem', 'public/logo.svg', 'public/elynea.glb']) {
    assert.equal(classifyPath(file), null, file);
  }
});

test('detects maps under potentially public output folders', () => {
  for (const file of ['public/main.js.map', 'dist/assets/main.css.map', 'packages/web/build/main.js.map']) {
    assert.equal(classifyPath(file), 'potentially-public-source-map', file);
  }
  assert.equal(classifyPath('docs/mapping.md'), null);
});

test('reports missing control files instead of silently passing', () => {
  assert.equal(auditPaths([]).length, CONTROL_FILES.length);
  assert.ok(auditPaths([]).every(item => item.category === 'missing-protection-control'));
  assert.deepEqual(auditPaths([...CONTROL_FILES]), []);
});

test('deduplicates tracked paths and preserves honest categories', () => {
  const findings = auditPaths([...CONTROL_FILES, '.env', '.env']);
  assert.deepEqual(findings, [{ path: '.env', category: 'environment-file' }]);
});

test('validates its input', () => {
  assert.throws(() => classifyPath(''), TypeError);
  assert.throws(() => classifyPath(null), TypeError);
  assert.throws(() => auditPaths(null), TypeError);
});

function withIndex(extraFiles, run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsinnovia-source-protection-'));
  try {
    execFileSync('git', ['init', '-q', dir]);
    for (const file of [...CONTROL_FILES, ...extraFiles]) {
      const target = path.join(dir, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, 'fixture-only-not-a-real-secret\n');
    }
    execFileSync('git', ['-C', dir, 'add', '--all']);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('CLI passes a safe Git index without reading or exposing file contents', () => {
  withIndex(['.env.example', 'public/logo.svg'], dir => {
    const result = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).passed, true);
    assert.ok(!result.stdout.includes('fixture-only-not-a-real-secret'));
  });
});

test('CLI fails for a tracked environment file and never prints its value', () => {
  withIndex(['.env'], dir => {
    const result = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.passed, false);
    assert.equal(report.findings[0].category, 'environment-file');
    assert.ok(!result.stdout.includes('fixture-only-not-a-real-secret'));
  });
});

test('CLI treats lack of a Git repository as an error, not a clean audit', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsinnovia-no-git-'));
  try {
    const result = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI rejects unsupported options and supports read-only help', () => {
  assert.equal(spawnSync(process.execPath, [script, '--fix']).status, 2);
  assert.equal(spawnSync(process.execPath, [script, '--help']).status, 0);
});
