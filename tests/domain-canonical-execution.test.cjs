const test = require('node:test');
const assert = require('node:assert/strict');
const { persistedRunState } = require('../server-task-batch.cjs');
const { runDomainRepair } = require('../server-domain-ops.cjs');

const legacy = (id='run-old', task_id='old') => ({id,task_id,status:'pending',provider_name:'cockpit-server',execution_mode:'confirmed_write',requested_by:'cockpit-domaines',input:{kind:'seo',domain:'jsinnovia.com'},result:{summary:'{"domain":"jsinnovia.com"}',conversation_id:null}});

function fixture(tasks = [], runs = []) {
  const writes = [];
  const fetch = async (path, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    if (method !== 'GET') writes.push({path,method,body});
    if (path.startsWith('/data/Tache?')) return Response.json(tasks);
    if (path.startsWith('/agent-runs?')) return Response.json(runs.filter(r => r.task_id === new URL('http://test'+path).searchParams.get('task_id')));
    if (path === '/data/Tache' && method === 'POST') { const row={...body,id:'new-task'};tasks.push(row);return Response.json(row); }
    if (path === '/agent-runs' && method === 'POST') { const row={...body,id:'new-run'};runs.push(row);return Response.json(row); }
    if (method === 'PATCH') {
      const rows = path.startsWith('/data/Tache/') ? tasks : runs;
      const row=rows.find(x => x.id === path.split('/').pop());
      assert.ok(row);Object.assign(row,body);return Response.json(row);
    }
    throw new Error('Unexpected request '+method+' '+path);
  };
  return {fetch,writes,tasks,runs};
}
const args = {domain:'jsinnovia.com',kind:'seo',before:{app:'test',issues:[]},user:{organisation:'jsinnovia',id:'test'}};

test('legacy phantom domain queues are NO_EXECUTOR, missing sources precede old approval flags', () => {
  assert.equal(persistedRunState(legacy()).operational_status,'NO_EXECUTOR');
  assert.equal(persistedRunState({...legacy(),requested_by:'another-worker'}).operational_status,'WAITING_INPUT');
  assert.equal(persistedRunState({status:'awaiting_approval',result:{missing_fields:['audio']}}).operational_status,'WAITING_INPUT');
  assert.equal(persistedRunState({status:'running'}).operational_status,'RUNNING');
  assert.equal(persistedRunState({...legacy(),result:{operational_status:'RUNNING'}}).operational_status,'RUNNING');
  assert.equal(persistedRunState({status:'completed',completed_at:'now',result:{}}).operational_status,'TECHNICAL_ERROR');
});

test('domain repair preserves reservations on any duplicate and never creates a new task/run', async () => {
  const tasks = ['canonical','duplicate'].map((id,i)=>({id,titre:'SEO automatique — jsinnovia.com',statut:'en_cours',created_at:`2026-09-0${i+1}`}));
  const f = fixture(tasks,[legacy('old-run','duplicate')]);
  const snapshot = JSON.stringify([f.tasks,f.runs]);
  const result = await runDomainRepair({...args,agentFetch:f.fetch});
  assert.equal(result.task.id,'canonical');
  assert.equal(result.run_id,'old-run');
  assert.equal(result.operational_status,'NO_EXECUTOR');
  assert.equal(result.verified,false);
  assert.equal(f.writes.length,0);
  assert.equal(JSON.stringify([f.tasks,f.runs]),snapshot);
});

test('concurrent domain confirmations execute exactly once and retain final proof', async () => {
  const f = fixture(); let calls = 0;
  const options = {...args,agentFetch:f.fetch,executionHandlers:{site:async()=>{calls++;return {completed:true,result:{verified:true,probe:{status:200}}};}}};
  const [a,b] = await Promise.all([runDomainRepair(options),runDomainRepair(options)]);
  assert.equal(a.run_id,b.run_id);
  assert.equal(a.verified,true);
  assert.equal(f.tasks.length,1);assert.equal(f.runs.length,1);assert.equal(calls,1);
  assert.equal(f.runs[0].result.proof_status,'verified');
  assert.ok(f.runs[0].result.evidence.length);
});

test('no executor produces an explicit block instead of a phantom pending queue', async () => {
  const f = fixture();
  const result = await runDomainRepair({...args,agentFetch:f.fetch,executionHandlers:{site:async()=>({completed:false,reason:'correction_repertoire_interne_a_executer',result:{dispatched:false}})}});
  assert.equal(result.operational_status,'NO_EXECUTOR');
  assert.equal(result.verified,false);
  assert.equal(f.runs[0].status,'failed');
  assert.equal(f.tasks[0].statut,'bloquee');
});

test('task filters follow operational evidence rather than stale CRM statuses', async () => {
  const {isTaskInProgress,isTaskBlocked,isTaskCompleted} = await import('../src/lib/taskStatus.js');
  const task={statut:'en_cours',operational_status:'NO_EXECUTOR'};
  assert.equal(isTaskInProgress(task),false);assert.equal(isTaskBlocked(task),true);
  assert.equal(isTaskCompleted({statut:'terminee',operational_status:'TECHNICAL_ERROR'}),false);
  assert.equal(isTaskInProgress({statut:'bloquee',operational_status:'RUNNING'}),true);
});
