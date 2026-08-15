const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.cjs', 'utf8');
const data = fs.readFileSync('server-business-data.cjs', 'utf8');

test('general cockpit business counters use the local secured Supabase API', () => {
  assert.match(server, /requireSession\('client'\)[\s\S]*businessDataRouter/);
  assert.ok(server.indexOf("app.use('/api/data', businessDataRouter)") < server.indexOf('const targetUrl = `${AGENT_PROXY_URL}/data${req.url}`'));
  for (const mapping of [
    "['Lead', 'leads_fr']", "['Projet', 'projets']", "['Tache', 'taches']",
    "['Devis', 'devis']", "['Facture', 'factures']", "['Commission', 'commissions_fr']",
    "['Demande', 'demandes']",
  ]) assert.match(data, new RegExp(mapping.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('native business API keeps a strict table allowlist and server-only service key', () => {
  assert.match(data, /const TABLES = new Map/);
  assert.match(data, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(data, /VITE_SUPABASE/);
  assert.match(data, /if \(!table\) return next\(\)/);
  assert.match(data, /cleanIdentifier/);
});

