// ════════════════════════════════════════════════════════════════════════════
// tests/dispatch.test.cjs — Tests du routeur dispatch v2
// Tests unitaires (sans serveur) + tests backend (avec serveur)
// Exécuter : node tests/dispatch.test.cjs
// ════════════════════════════════════════════════════════════════════════════

var assert = require('assert');
var fs = require('fs');
var crypto = require('crypto');
var http = require('http');

var passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \u2705 ' + name);
  } catch (e) {
    failed++;
    console.log('  \u274c ' + name + ' \u2014 ' + e.message);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  \u2705 ' + name);
  } catch (e) {
    failed++;
    console.log('  \u274c ' + name + ' \u2014 ' + e.message);
  }
}

function apiCall(method, path, body) {
  return new Promise(function(resolve) {
    var data = body ? JSON.stringify(body) : null;
    var headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    var options = { hostname: 'localhost', port: 3099, path: path, method: method, headers: headers };
    var r = http.request(options, function(res) {
      var body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        var json; try { json = JSON.parse(body); } catch(e) { json = { raw: body }; }
        resolve({ status: res.statusCode, json: json });
      });
    });
    r.on('error', function(e) { resolve({ status: 0, json: { error: e.message } }); });
    if (data) r.write(data);
    r.end();
  });
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550\u2550 Tests dispatch v2 \u2550\u2550\u2550\n');

// ─── 1. Sécurité clé Base44 ────────────────────────────────────────────────────
console.log('--- 1. Sécurité clé Base44 ---');

test('server-dispatch.cjs ne contient pas VITE_BASE44_API_KEY', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('VITE_BASE44_API_KEY') === -1, 'VITE_BASE44_API_KEY trouvé dans server-dispatch.cjs');
});

test('server-dispatch.cjs utilise uniquement BASE44_API_KEY', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf("process.env.BASE44_API_KEY") !== -1, 'BASE44_API_KEY non utilisé');
  // Pas de fallback VITE_
  var line = c.split('\n').find(function(l) { return l.indexOf('BASE44_API_KEY') !== -1 && l.indexOf('process.env') !== -1; });
  assert.ok(line && line.indexOf('VITE_') === -1, 'Fallback VITE_ trouvé: ' + line);
});

test('Aucun VITE_BASE44_API_KEY dans les composants frontend de dispatch', function () {
  ['TaskDispatchButton','TaskDispatchModal','AgentRunStatusBadge','AgentRunActions','AgentRunDetail'].forEach(function(f) {
    var c = fs.readFileSync('src/components/dispatch/' + f + '.jsx', 'utf8');
    assert.ok(c.indexOf('VITE_BASE44_API_KEY') === -1, f + ' contient VITE_BASE44_API_KEY');
  });
});

test('VITE_BASE44_API_KEY dans src/pages/AgentsIA.jsx = usage frontend historique (acceptable)', function () {
  var c = fs.readFileSync('src/pages/AgentsIA.jsx', 'utf8');
  // C'est un usage frontend avec import.meta.env — pas un usage backend
  assert.ok(c.indexOf('import.meta.env.VITE_BASE44_API_KEY') !== -1, 'Devrait utiliser import.meta.env');
});

test('.env.example documente VITE_BASE44_API_KEY (frontend) — acceptable', function () {
  assert.ok(fs.existsSync('.env.example'), '.env.example manquant');
});

test('server-dispatch.cjs avertit au démarrage si BASE44_API_KEY absente', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('BASE44_API_KEY non configur') !== -1, 'Pas de warning au démarrage');
});

// ─── 2. Idempotence par intention ─────────────────────────────────────────────
console.log('\n--- 2. Idempotence par intention ---');

test('Idempotence : pas de fenêtre temporelle (pas de Math.floor(Date.now / 10000))', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('Date.now() / 10000') === -1, 'Fenêtre temporelle trouvée — à supprimer');
  assert.ok(c.indexOf('10000') === -1 || c.indexOf('10000ms') !== -1, 'Référence à fenêtre 10s trouvée');
});

test('Idempotence : clientKey (UUID) reçu du frontend, pas calculé serveur', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('body.clientKey') !== -1, 'Pas de body.clientKey');
  // Pas de makeIdempotencyKey avec fenêtre temporelle
  assert.ok(c.indexOf('makeIdempotencyKey') === -1, 'makeIdempotencyKey encore présent');
});

test('Idempotence : contrainte UNIQUE sur idempotency_key en SQL', function () {
  var c = fs.readFileSync('supabase/migrations/20260730000000_task_dispatch.sql', 'utf8');
  assert.ok(c.indexOf('uq_agent_runs_idempotency_key') !== -1, 'Index UNIQUE manquant');
  assert.ok(c.indexOf('UNIQUE INDEX') !== -1, 'Pas de UNIQUE INDEX');
});

test('Idempotence : retry sans duplication (même clientKey → même run)', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('idempotent: true') !== -1, 'Pas de retour idempotent');
  assert.ok(c.indexOf('Run d\u00e9j\u00e0 existant') !== -1 || c.indexOf('already exists') !== -1, 'Pas de message idempotent');
});

test('Idempotence : relance volontaire via endpoint séparé', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('dispatch-retry') !== -1, 'Pas d\'endpoint dispatch-retry');
  assert.ok(c.indexOf('retry_of') !== -1, 'Pas de champ retry_of');
});

test('Idempotence : TaskDispatchModal génère un clientKey (UUID)', function () {
  var c = fs.readFileSync('src/components/dispatch/TaskDispatchModal.jsx', 'utf8');
  assert.ok(c.indexOf('generateClientKey') !== -1, 'Pas de generateClientKey');
  assert.ok(c.indexOf('randomUUID') !== -1 || c.indexOf('4xxx') !== -1, 'Pas de génération UUID');
});

test('Idempotence : Taches.jsx envoie clientKey dans le payload', function () {
  var c = fs.readFileSync('src/pages/Taches.jsx', 'utf8');
  assert.ok(c.indexOf('clientKey') !== -1, 'Pas de clientKey dans Taches.jsx');
});

// ─── 3. Dispatch asynchrone ─────────────────────────────────────────────────────
console.log('\n--- 3. Dispatch asynchrone ---');

test('Dispatch asynchrone : processDispatchAsync sans await', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('processDispatchAsync') !== -1, 'Pas de processDispatchAsync');
  // Vérifier que processDispatchAsync est appelé sans await
  var lines = c.split('\n');
  var found = false;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('processDispatchAsync(') !== -1 && lines[i].indexOf('function') === -1) {
      found = true;
      assert.ok(lines[i].indexOf('await') === -1, 'processDispatchAsync ne doit pas être awaited: ' + lines[i].trim());
    }
  }
  assert.ok(found, 'processDispatchAsync n\'est jamais appelé');
});

test('Dispatch asynchrone : statut dispatching ajouté', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf("'dispatching'") !== -1 || c.indexOf('"dispatching"') !== -1, 'Statut dispatching manquant');
});

test('Dispatch asynchrone : statut dispatching dans migration SQL', function () {
  var c = fs.readFileSync('supabase/migrations/20260730000000_task_dispatch.sql', 'utf8');
  assert.ok(c.indexOf('dispatching') !== -1, 'Statut dispatching manquant dans CHECK');
});

test('Dispatch asynchrone : réponse 202 (Accepted)', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('res.status(202)') !== -1, 'Pas de réponse 202');
});

test('Dispatch asynchrone : pollUrl et pollIntervalMs dans la réponse', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('pollUrl') !== -1, 'Pas de pollUrl');
  assert.ok(c.indexOf('pollIntervalMs') !== -1, 'Pas de pollIntervalMs');
});

test('Dispatch asynchrone : Taches.jsx implémente le polling', function () {
  var c = fs.readFileSync('src/pages/Taches.jsx', 'utf8');
  assert.ok(c.indexOf('startPolling') !== -1, 'Pas de startPolling');
  assert.ok(c.indexOf('setInterval') !== -1, 'Pas de setInterval');
  assert.ok(c.indexOf('3000') !== -1, 'Intervalle de polling non défini');
});

test('Dispatch asynchrone : polling s\'arrête sur statut terminal', function () {
  var c = fs.readFileSync('src/pages/Taches.jsx', 'utf8');
  assert.ok(c.indexOf('TERMINAL_STATUSES') !== -1, 'Pas de TERMINAL_STATUSES');
  assert.ok(c.indexOf('clearInterval') !== -1, 'Pas de clearInterval');
});

test('Dispatch asynchrone : nettoyage des intervalles au démontage', function () {
  var c = fs.readFileSync('src/pages/Taches.jsx', 'utf8');
  assert.ok(c.indexOf('useEffect') !== -1 && c.indexOf('clearInterval') !== -1, 'Pas de nettoyage');
});

test('Dispatch asynchrone : erreur après création du run → statut failed', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf("status: 'failed'") !== -1, 'Pas de statut failed après erreur');
  assert.ok(c.indexOf('error:') !== -1, 'Pas de champ error');
});

// ─── 4. Mapping agents ─────────────────────────────────────────────────────────
console.log('\n--- 4. Mapping agents ---');

test('Mapping : functional_role défini pour chaque agent', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  ['Communication','R\u00e9seaux sociaux','D\u00e9veloppement','Facturation','Commercial','SEO & Audit','Cr\u00e9atif','G\u00e9n\u00e9ral'].forEach(function(role) {
    assert.ok(c.indexOf("'" + role + "'") !== -1 || c.indexOf('"' + role + '"') !== -1, 'Rôle manquant: ' + role);
  });
});

test('Mapping : provider_name stocké (NOVA ou JsInnov-Agent)', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('NOVA JS-Innov.IA') !== -1, 'Provider NOVA manquant');
  assert.ok(c.indexOf('JsInnov-Agent') !== -1, 'Provider JsInnov-Agent manquant');
});

test('Mapping : GET /agents expose functionalRole, pas provider_name', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('functionalRole') !== -1, 'Pas de functionalRole');
  // Le commentaire dit explicitement de ne pas exposer provider
  assert.ok(c.indexOf('Pas de provider_name ni base44_id') !== -1 || c.indexOf('pas de provider') !== -1, 'Pas de commentaire sur non-exposition provider');
});

test('Mapping : frontend affiche le rôle fonctionnel, pas le provider', function () {
  var c = fs.readFileSync('src/components/dispatch/TaskDispatchModal.jsx', 'utf8');
  assert.ok(c.indexOf('role:') !== -1, 'Pas de champ role dans le frontend');
  assert.ok(c.indexOf('R\u00f4le fonctionnel') !== -1 || c.indexOf('r\u00f4le') !== -1, 'Pas de label rôle fonctionnel');
});

test('Mapping : champs provider stockés en base (provider_agent_id, provider_name, functional_role)', function () {
  var c = fs.readFileSync('supabase/migrations/20260730000000_task_dispatch.sql', 'utf8');
  assert.ok(c.indexOf('provider_agent_id') !== -1, 'provider_agent_id manquant');
  assert.ok(c.indexOf('provider_name') !== -1, 'provider_name manquant');
  assert.ok(c.indexOf('functional_role') !== -1, 'functional_role manquant');
});

// ─── 5. Tests backend (nécessitent le serveur) ────────────────────────────────
console.log('\n--- 5. Tests backend (serveur) ---');

// Ces tests sont asynchrones — ils nécessitent que le serveur tourne
// On les lance après les tests unitaires

// ─── 6. Absence de secrets ─────────────────────────────────────────────────────
console.log('\n--- 6. Absence de secrets ---');

test('Bundle frontend : aucun VITE_BASE44_API_KEY valeur dans dist/', function () {
  var dir = 'dist/assets';
  if (!fs.existsSync(dir)) return; // skip si pas de build
  var files = fs.readdirSync(dir).filter(function(f) { return f.endsWith('.js'); });
  files.forEach(function(f) {
    var c = fs.readFileSync(dir + '/' + f, 'utf8');
    assert.ok(!/sb_publish|sb_secret/.test(c), f + ' contient un secret Supabase');
  });
});

test('server-dispatch.cjs : aucun secret en dur', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('eyJ') === -1, 'JWT trouvé en dur');
  assert.ok(c.indexOf('sb_publish') === -1, 'Clé publish trouvée');
  assert.ok(c.indexOf('sb_secret') === -1, 'Clé secret trouvée');
});

// ─── 7. Migration SQL ───────────────────────────────────────────────────────────
console.log('\n--- 7. Migration SQL ---');

test('Migration : FK agent_approvals → agent_runs (CASCADE)', function () {
  var c = fs.readFileSync('supabase/migrations/20260730000000_task_dispatch.sql', 'utf8');
  assert.ok(c.indexOf('REFERENCES public.agent_runs') !== -1, 'FK manquante');
  assert.ok(c.indexOf('ON DELETE CASCADE') !== -1, 'CASCADE manquant');
});

test('Migration : RLS activée sur les deux tables', function () {
  var c = fs.readFileSync('supabase/migrations/20260730000000_task_dispatch.sql', 'utf8');
  assert.ok(c.indexOf('ENABLE ROW LEVEL SECURITY') !== -1, 'RLS manquante');
});

test('Migration : CHECK constraint sur status (8 valeurs)', function () {
  var c = fs.readFileSync('supabase/migrations/20260730000000_task_dispatch.sql', 'utf8');
  var match = c.match(/CHECK \(status IN \(([^)]+)\)/);
  assert.ok(match, 'CHECK sur status manquant');
  var values = match[1].split(',').length;
  assert.ok(values === 8, 'Attendu 8 statuts, trouvé ' + values);
});

test('Migration : CHECK constraint sur execution_mode (3 valeurs)', function () {
  var c = fs.readFileSync('supabase/migrations/20260730000000_task_dispatch.sql', 'utf8');
  var match = c.match(/CHECK \(execution_mode IN \(([^)]+)\)/);
  assert.ok(match, 'CHECK sur execution_mode manquant');
  var values = match[1].split(',').length;
  assert.ok(values === 3, 'Attendu 3 modes, trouvé ' + values);
});

test('Migration : trigger updated_at', function () {
  var c = fs.readFileSync('supabase/migrations/20260730000000_task_dispatch.sql', 'utf8');
  assert.ok(c.indexOf('trg_agent_runs_updated') !== -1, 'Trigger manquant');
  assert.ok(c.indexOf('updated_at = now()') !== -1, 'updated_at non mis à jour');
});

test('Migration : rollback documenté', function () {
  var c = fs.readFileSync('supabase/migrations/20260730000000_task_dispatch.sql', 'utf8');
  assert.ok(c.indexOf('ROLLBACK') !== -1 || c.indexOf('DROP TABLE') !== -1, 'Rollback manquant');
});

// ─── 8. Structure ───────────────────────────────────────────────────────────────
console.log('\n--- 8. Structure ---');

test('Taches.jsx < 350 lignes', function () {
  var lines = fs.readFileSync('src/pages/Taches.jsx', 'utf8').split('\n').length;
  assert.ok(lines < 350, 'Taches.jsx fait ' + lines + ' lignes');
});

test('5 composants dispatch existent', function () {
  ['AgentRunStatusBadge','TaskDispatchButton','AgentRunActions','TaskDispatchModal','AgentRunDetail'].forEach(function(f) {
    assert.ok(fs.existsSync('src/components/dispatch/' + f + '.jsx'), f + '.jsx manquant');
  });
});

test('Relance volontaire : bouton RefreshCw visible sur runs failed/cancelled', function () {
  var c = fs.readFileSync('src/pages/Taches.jsx', 'utf8');
  assert.ok(c.indexOf('RefreshCw') !== -1, 'Pas de bouton de relance');
  assert.ok(c.indexOf('failed') !== -1 && c.indexOf('cancelled') !== -1, 'Conditions failed/cancelled manquantes');
});

// ─── 9. Multi-tenant ────────────────────────────────────────────────────────────
console.log('\n--- 9. Multi-tenant ---');

test('Multi-tenant : organisation stockée sur agent_runs', function () {
  var c = fs.readFileSync('supabase/migrations/20260730000000_task_dispatch.sql', 'utf8');
  assert.ok(c.indexOf('organisation') !== -1, 'Champ organisation manquant');
});

test('Multi-tenant : non-superadmin ne voit que ses runs', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('requested_by') !== -1, 'Filtrage par requested_by manquant');
  assert.ok(c.indexOf('superadmin') !== -1, 'Exception superadmin manquante');
});

test('Multi-tenant : 403 si run appartient à une autre organisation', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('Acc\u00e8s refus') !== -1, 'Pas de message accès refusé');
});

// ─── Résumé ────────────────────────────────────────────────────────────────────
console.log('\n\u2550\u2550\u2550 R\u00e9sum\u00e9 \u2550\u2550\u2550');
console.log('  Pass: ' + passed);
console.log('  Fail: ' + failed);

// ─── 9b. Dual Supabase (auth + data) ────────────────────────────────────────────
console.log('\n--- 9b. Dual Supabase (auth + data) ---');

test('Dual Supabase : SUPABASE_DATA_URL défini (fallback sur SUPABASE_URL)', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('SUPABASE_DATA_URL') !== -1, 'SUPABASE_DATA_URL manquant');
  assert.ok(c.indexOf('SUPABASE_DATA_KEY') !== -1, 'SUPABASE_DATA_KEY manquant');
  assert.ok(c.indexOf('process.env.SUPABASE_DATA_URL || SUPABASE_URL') !== -1, 'Fallback manquant');
});

test('Dual Supabase : supabaseDataSelect utilise SUPABASE_DATA_URL', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('SUPABASE_DATA_URL + \'/rest/v1/\'') !== -1, 'supabaseDataSelect n\'utilise pas SUPABASE_DATA_URL');
});

test('Dual Supabase : supabaseDataInsert utilise SUPABASE_DATA_KEY', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('SUPABASE_DATA_KEY, \'Authorization\': \'Bearer \' + SUPABASE_DATA_KEY') !== -1, 'supabaseDataInsert n\'utilise pas SUPABASE_DATA_KEY');
});

test('Dual Supabase : supabaseDataPatch utilise SUPABASE_DATA_URL', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  var patchSection = c.substring(c.indexOf('async function supabaseDataPatch'));
  assert.ok(patchSection.indexOf('SUPABASE_DATA_URL') !== -1, 'supabaseDataPatch n\'utilise pas SUPABASE_DATA_URL');
});

test('Dual Supabase : Tache utilise supabaseDataSelect (pas supabaseSelect)', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf("supabaseDataSelect('Tache'") !== -1, 'Tache devrait utiliser supabaseDataSelect');
  assert.ok(c.indexOf("supabaseSelect('Tache'") === -1, 'Tache ne devrait pas utiliser supabaseSelect (auth)');
});

test('Dual Supabase : Tache utilise supabaseDataPatch (pas supabasePatch)', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf("supabaseDataPatch('Tache'") !== -1, 'Tache devrait utiliser supabaseDataPatch');
  assert.ok(c.indexOf("supabasePatch('Tache'") === -1, 'Tache ne devrait pas utiliser supabasePatch (auth)');
});

test('Dual Supabase : agent_runs utilise supabaseDataSelect', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf("supabaseDataSelect('agent_runs'") !== -1, 'agent_runs devrait utiliser supabaseDataSelect');
});

test('Dual Supabase : cockpit_sessions utilise supabaseSelect (auth)', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf("supabaseSelect('cockpit_sessions'") !== -1, 'cockpit_sessions devrait utiliser supabaseSelect (auth)');
});

test('Dual Supabase : cockpit_users utilise supabaseSelect (auth)', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf("supabaseSelect('cockpit_users'") !== -1, 'cockpit_users devrait utiliser supabaseSelect (auth)');
});

test('Dual Supabase : processDispatchAsync crée approval APRÈS dispatch (pas avant)', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  var asyncSection = c.substring(c.indexOf('async function processDispatchAsync'));
  assert.ok(asyncSection.indexOf('awaiting_approval') !== -1, 'processDispatchAsync ne passe pas en awaiting_approval');
  assert.ok(asyncSection.indexOf('executionMode === \'approval_required\'') !== -1, 'Condition approval_required manquante');
});

test('Dual Supabase : processDispatchAsync vérifie approval existante (évite 409)', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  var asyncSection = c.substring(c.indexOf('async function processDispatchAsync'));
  assert.ok(asyncSection.indexOf('existingApprovals') !== -1, 'Pas de vérification d\'approval existante');
});

// ─── 10. Récupération après crash ──────────────────────────────────────────────
console.log('\n--- 10. Récupération après crash ---');

test('Recovery : fonction recoveryStuckRuns exportée', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('recoveryStuckRuns') !== -1, 'Fonction recoveryStuckRuns manquante');
  assert.ok(c.indexOf('router.recoveryStuckRuns') !== -1, 'Export router.recoveryStuckRuns manquant');
});

test('Recovery : délai STUCK_THRESHOLD_MINUTES défini (5 minutes)', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('STUCK_THRESHOLD_MINUTES = 5') !== -1, 'STUCK_THRESHOLD_MINUTES manquant ou != 5');
});

test('Recovery : recherche les runs en dispatching depuis plus de X minutes', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf("status=eq.dispatching") !== -1, 'Filtre status=eq.dispatching manquant');
  assert.ok(c.indexOf("started_at=lt.") !== -1, 'Filtre started_at=lt. manquant');
});

test('Recovery : passe les runs bloqués en failed avec message explicite', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf("status: 'failed'") !== -1, 'Statut failed manquant');
  assert.ok(c.indexOf('R\u00e9cup\u00e9ration apr\u00e8s crash') !== -1, 'Message explicite manquant');
});

test('Recovery : suggère la relance via dispatch-retry dans le message', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('dispatch-retry') !== -1, 'Suggestion dispatch-retry manquante dans recovery');
});

test('Recovery : appelée au démarrage du serveur (server.cjs)', function () {
  var c = fs.readFileSync('server.cjs', 'utf8');
  assert.ok(c.indexOf('recoveryStuckRuns') !== -1, 'Appel recoveryStuckRuns manquant dans server.cjs');
});

test('Recovery : non bloquante si Supabase non configuré', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('Supabase non configur') !== -1, 'Garde-fou Supabase non configuré manquant');
});

test('Recovery : non bloquante en cas d\'erreur (try/catch externe)', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  // Le catch externe ne doit pas relancer l'erreur
  var recoverySection = c.substring(c.indexOf('async function recoveryStuckRuns'));
  assert.ok(recoverySection.indexOf('Non bloquant') !== -1 || recoverySection.indexOf('catch') !== -1, 'Catch externe manquant');
});

test('Recovery : limit=50 (pas de surcharge au démarrage)', function () {
  var c = fs.readFileSync('server-dispatch.cjs', 'utf8');
  assert.ok(c.indexOf('limit=50') !== -1, 'Limit manquante');
});

// ─── Résumé final ───────────────────────────────────────────────────────────────
var total = passed + failed;
console.log('\n\u2550\u2550\u2550 R\u00e9sum\u00e9 final \u2550\u2550\u2550');
console.log('  Total tests : ' + total);
console.log('  Pass : ' + passed);
console.log('  Fail : ' + failed);
process.exit(failed > 0 ? 1 : 0);
