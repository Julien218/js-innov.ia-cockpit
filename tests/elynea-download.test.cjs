const test = require('node:test');
const assert = require('node:assert/strict');
test('download validates the secured route and successful binary response before starting', async () => {
  const { finishElyneaResponse } = await import('../src/lib/elyneaRuntime.js');
  let clicked = false, revoked = false, removed = false;
  const runtime = { fetch: async () => new Response(new Blob(['pdf']), { headers: { 'Content-Disposition': 'attachment; filename=x.pdf' } }),
    document: { createElement: () => ({ click: () => { clicked = true; }, remove: () => { removed = true; } }), body: { appendChild() {} } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => { revoked = true; } }, setTimeout: fn => fn() };
  await assert.rejects(finishElyneaResponse({ download: { url: 'https://evil.test' } }, runtime));
  assert.equal(clicked, false);
  const result = await finishElyneaResponse({ download: { url: '/api/documents/id-1/download', filename: 'x.pdf' } }, runtime);
  assert.equal(result.download_started, true); assert.ok(clicked && removed && revoked);
  assert.doesNotMatch(result.message, /enregistré|terminé/);
  runtime.fetch = async () => new Response('{"error":"denied"}', { status: 403 });
  await assert.rejects(finishElyneaResponse({ download: { url: '/api/documents/id-1/download' } }, runtime));
});
