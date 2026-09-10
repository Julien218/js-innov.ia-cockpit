const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JSINNOVIA_AGENT_KEY = 'test-only';
const { runAutopilot } = require('../server-task-autopilot.cjs');

test('autopilot preserves conflicting historical claims without starting another execution', async () => {
  const previous = global.fetch;
  const methods = [];
  const tasks = ['a', 'b'].map(id => ({ id, titre: 'Analyser les factures', client_id: 'same-client', statut: 'a_faire' }));
  const runs = tasks.map(task => ({ id: `run-${task.id}`, task_id: task.id, status: task.id === 'a' ? 'pending' : 'awaiting_approval' }));
  global.fetch = async (url, options = {}) => {
    methods.push(options.method || 'GET');
    if (url.includes('/data/Tache')) return new Response(JSON.stringify(tasks));
    if (url.includes('/agent-runs')) return new Response(JSON.stringify(url.includes('&status=') ? runs.filter(run => url.endsWith(`status=${run.status}`)) : []));
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const result = await runAutopilot();
    assert.equal(result.executed.length, 0);
    assert.equal(result.queued.length, 1);
    assert.equal(result.awaiting_authorization.length, 1);
    assert.equal(result.blocked[0].title, 'Analyser les factures');
    assert.equal(result.blocked[0].reason, 'plusieurs_runs_actifs_sur_un_objectif_regroupe');
    assert.equal(result.blocked[0].operational_status, 'TECHNICAL_ERROR');
    assert.ok(methods.every(method => method === 'GET'));
  } finally { global.fetch = previous; }
});
