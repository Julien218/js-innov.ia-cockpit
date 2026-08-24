const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('NOVA locale reconnaît uniquement les intentions d’outils autorisées', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-tools-'));
  const previous = {
    noListen: process.env.LOCAL_AGENT_NO_LISTEN,
    roots: process.env.LOCAL_AGENT_ALLOWED_ROOTS,
    logDir: process.env.LOCAL_AGENT_LOG_DIR,
  };
  process.env.LOCAL_AGENT_NO_LISTEN = '1';
  process.env.LOCAL_AGENT_ALLOWED_ROOTS = root;
  process.env.LOCAL_AGENT_LOG_DIR = root;
  try {
    const module = await import(`../local-agent/server.js?test=${Date.now()}`);
    assert.deepEqual(module.requestedTool('lance ffmpeg -version'), { tool: 'ffmpeg_version', args: {} });
    assert.equal(module.requestedTool('supprime tous mes fichiers'), null);
    assert.equal(module.pathInsideAllowedRoot(path.join(root, 'video.mp4')), path.resolve(root, 'video.mp4'));
    assert.equal(module.pathInsideAllowedRoot(path.resolve(root, '..', 'secret.txt')), null);
  } finally {
    if (previous.noListen === undefined) delete process.env.LOCAL_AGENT_NO_LISTEN; else process.env.LOCAL_AGENT_NO_LISTEN = previous.noListen;
    if (previous.roots === undefined) delete process.env.LOCAL_AGENT_ALLOWED_ROOTS; else process.env.LOCAL_AGENT_ALLOWED_ROOTS = previous.roots;
    if (previous.logDir === undefined) delete process.env.LOCAL_AGENT_LOG_DIR; else process.env.LOCAL_AGENT_LOG_DIR = previous.logDir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('le moteur local emploie execFile sans shell ni commande arbitraire', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'local-agent', 'server.js'), 'utf8');
  assert.match(source, /execFileAsync\(command, commandArgs, execOptions\)/);
  assert.doesNotMatch(source, /exec\(|shell:\s*true|child_process[^\n]*exec[^F]/);
  assert.match(source, /tool_not_allowed/);
  assert.match(source, /tool-runs\.jsonl/);
});
