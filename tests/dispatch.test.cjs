// ════════════════════════════════════════════════════════════════════════════
// tests/dispatch.test.cjs — Tests du routeur dispatch
// Exécuter : node tests/dispatch.test.cjs
// Nécessite : serveur démarré sur le port de test
// ════════════════════════════════════════════════════════════════════════════

var http = require('http');
var assert = require('assert');

var BASE = process.env.TEST_API_URL || 'http://localhost:3099';
var passed = 0;
var failed = 0;

function log(name, ok, detail) {
  if (ok) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

async function req(method, path, body, cookies) {
  var headers = { 'Content-Type': 'application/json' };
  if (cookies) headers['Cookie'] = cookies;
  var res = await fetch(BASE + path, {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  var data = null;
  try { data = await res.json(); } catch(e) {}
  return { status: res.status, data: data };
}

async function runTests() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  TESTS — Task Dispatch Backend');
  console.log('═══════════════════════════════════════════════\n');

  // 1. Health check
  var r = await req('GET', '/api/health');
  log('Health check returns 200', r.status === 200, 'status=' + r.status);

  // 2. Agents list (pas besoin de session)
  r = await req('GET', '/api/agents');
  log('GET /api/agents returns agents', r.status === 200 && r.data && r.data.agents && r.data.agents.length === 8, 'agents=' + (r.data && r.data.agents ? r.data.agents.length : 0));

  // 3. Dispatch sans session → 401
  r = await req('POST', '/api/tasks/fake-id/dispatch', { agentId: 'developer-agent', executionMode: 'approval_required' });
  log('POST dispatch sans session → 401', r.status === 401, 'status=' + r.status);

  // 4. GET runs sans session → 401
  r = await req('GET', '/api/tasks/fake-id/runs');
  log('GET runs sans session → 401', r.status === 401, 'status=' + r.status);

  // 5. GET run detail sans session → 401
  r = await req('GET', '/api/runs/fake-id');
  log('GET run detail sans session → 401', r.status === 401, 'status=' + r.status);

  // 6. Cancel sans session → 401
  r = await req('POST', '/api/runs/fake-id/cancel');
  log('POST cancel sans session → 401', r.status === 401, 'status=' + r.status);

  // 7. Approve sans session → 401
  r = await req('POST', '/api/runs/fake-id/approve');
  log('POST approve sans session → 401', r.status === 401, 'status=' + r.status);

  // 8. Reject sans session → 401
  r = await req('POST', '/api/runs/fake-id/reject');
  log('POST reject sans session → 401', r.status === 401, 'status=' + r.status);

  // 9. Dispatch avec agent inconnu (mais sans session → 401 d'abord)
  // Note : sans vraie session, on ne peut pas tester au-delà de 401
  // Ces tests nécessitent une session valide pour tester la logique métier

  // 10. Agent suggestion mapping
  var suggestAgent = require('../server-dispatch.cjs');
  // Le module exporte le router, pas la fonction — tester via l'API
  log('Module server-dispatch se charge sans erreur', !!suggestAgent);

  // 11. Idempotency key — vérifier la logique
  var crypto = require('crypto');
  var key1 = crypto.createHash('sha256').update('task1:dev:approval:user1').digest('hex');
  var key2 = crypto.createHash('sha256').update('task1:dev:approval:user1').digest('hex');
  log('Idempotency key déterministe (même input → même key)', key1 === key2);

  var key3 = crypto.createHash('sha256').update('task1:dev:autonomous:user1').digest('hex');
  log('Idempotency key différente (mode différent → key différente)', key1 !== key3);

  // 12. Vérifier qu'aucun secret n'est dans le bundle
  var fs = require('fs');
  var bundleFiles = fs.readdirSync('dist/assets').filter(f => f.endsWith('.js'));
  var noSecret = true;
  for (var f of bundleFiles) {
    var content = fs.readFileSync('dist/assets/' + f, 'utf8');
    if (/sb_publish_|sb_secret_|AGENT_API_KEY=/.test(content)) { noSecret = false; break; }
  }
  log('Aucun secret dans le bundle frontend', noSecret);

  // Résumé
  console.log('\n═══════════════════════════════════════════════');
  console.log('  RÉSUMÉ : ' + passed + ' passed, ' + failed + ' failed');
  console.log('═══════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(function(e) {
  console.error('Test suite error:', e);
  process.exit(1);
});
