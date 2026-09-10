const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JSINNOVIA_AGENT_KEY = 'test-only';
const { completeLinkedExecution } = require('../server-video-generation.cjs');

test('video completion supplies backend proof, retries only PATCH and preserves task notes', async () => {
  const previous = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response('{}', { status: calls.length === 1 ? 502 : 200 });
  };
  try {
    const outcome = await completeLinkedExecution({ metadata: { task_id: 't1', agent_run_id: 'r1' } }, { id: 'v1', completed_at: '2026-09-11T00:00:00Z', dropbox_path: '/video.mp4', sha256: 'a'.repeat(64) });
    assert.equal(outcome.linked, true);
    assert.equal(calls.length, 3);
    assert.equal(calls[1].body.result.proof_status, 'verified');
    assert.equal(calls[1].body.result.evidence[0].sha256, 'a'.repeat(64));
    assert.deepEqual(calls[2].body, { statut: 'terminee' });
  } finally { global.fetch = previous; }
});

test('video without archived artifact proof cannot close a task', async () => {
  await assert.rejects(completeLinkedExecution({ metadata: { task_id: 't1', agent_run_id: 'r1' } }, { id: 'v1' }), /preuve_video_finale_incomplete/);
});
