#!/usr/bin/env node
/**
 * Read-only guard for accidentally tracked sensitive files and public source maps.
 * This is NOT a general secret scanner, access-control mechanism or anti-copy DRM.
 * It examines Git's index, not untracked files, history or deployed services.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONTROL_FILES = Object.freeze([
  '.github/CODEOWNERS',
  '.github/workflows/source-protection.yml',
  'scripts/source-protection-audit.mjs',
  'tests/source-protection.test.mjs',
]);

/** Return a category, never file contents or secret values. */
export function classifyPath(filePath) {
  if (typeof filePath !== 'string' || !filePath) {
    throw new TypeError('Expected a non-empty repository path.');
  }
  const normalized = filePath.replaceAll('\\', '/');
  const name = path.posix.basename(normalized).toLowerCase();
  const envTemplate = /^\.env(?:\.[a-z0-9_-]+)*\.(?:example|sample|template)$/.test(name);
  if ((name === '.env' || name.startsWith('.env.')) && !envTemplate) {
    return 'environment-file';
  }
  if (['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', '.git-credentials'].includes(name)
      || /\.(?:p12|pfx|jks|keystore|key)$/.test(name)) {
    return 'credential-or-private-key-file';
  }
  if (/(?:^|\/)(?:public|dist|dist-ssr|build)\/.*\.map$/i.test(normalized)) {
    return 'potentially-public-source-map';
  }
  return null;
}

/** Pure, deterministic path audit. Does not read file contents or change files. */
export function auditPaths(paths, { requireControls = true } = {}) {
  if (!Array.isArray(paths)) throw new TypeError('Expected an array of paths.');
  const findings = [];
  const tracked = new Set(paths);
  for (const filePath of [...tracked].sort()) {
    const category = classifyPath(filePath);
    if (category) findings.push({ path: filePath, category });
  }
  if (requireControls) {
    for (const filePath of CONTROL_FILES) {
      if (!tracked.has(filePath)) findings.push({ path: filePath, category: 'missing-protection-control' });
    }
  }
  return findings;
}

export function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/source-protection-audit.mjs\nRead-only audit of tracked paths in the current Git index. No network requests or writes.');
    return 0;
  }
  if (args.length) {
    console.error('Unsupported arguments. Use --help. No files were changed.');
    return 2;
  }
  try {
    const index = execFileSync('git', ['ls-files', '--cached', '-z'], {
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const paths = index.split('\0').filter(Boolean);
    const findings = auditPaths(paths);
    // JSON escaping prevents a crafted filename from injecting log lines.
    console.log(JSON.stringify({
      check: 'source-protection',
      scope: 'git-index-paths-only',
      trackedFiles: new Set(paths).size,
      passed: findings.length === 0,
      findings,
      limitations: 'Does not inspect contents, past commits, repository visibility, deployed builds or server permissions.',
    }, null, 2));
    return findings.length ? 1 : 0;
  } catch {
    console.error('Source-protection audit could not read the Git index. Run from a Git repository with Git installed.');
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main();
}
