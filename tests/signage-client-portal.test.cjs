const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const portalSource = fs.readFileSync(path.join(root, 'server-client-signage-portal.cjs'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'src/pages/ClientSignageRequests.jsx'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/009_signage_client_portal.sql'), 'utf8');
const proposalMigration = fs.readFileSync(path.join(root, 'migrations/010_signage_three_proposal_approval.sql'), 'utf8');
const staffPageSource = fs.readFileSync(path.join(root, 'src/components/signage/StaffClientRequests.jsx'), 'utf8');
const postgresSource = fs.readFileSync(path.join(root, 'server-postgres.cjs'), 'utf8');
const onboarding = fs.readFileSync(path.join(root, 'server-client-onboarding.cjs'), 'utf8');
const { owner } = require('../server-client-signage-portal.cjs');

test('a client can never select another client account through a header', () => {
  const req = {
    user: { role: 'client', email: 'alice@example.be' },
    headers: { 'x-client-email': 'bob@example.be' },
  };
  assert.equal(owner(req), 'alice@example.be');
});

test('an administrator can explicitly manage a selected client account', () => {
  const req = {
    user: { role: 'admin', email: 'admin@jsinnovia.com' },
    headers: { 'x-client-email': 'client@example.be' },
  };
  assert.equal(owner(req), 'client@example.be');
});

test('request media and reviews are always filtered by owner email', () => {
  assert.match(portalSource, /signage_media\?select=.*owner_email=eq\./);
  assert.match(portalSource, /client_signage_requests\?select=.*owner_email=eq\./);
  assert.match(portalSource, /client_content_reviews\?select=.*owner_email=eq\./);
  assert.match(portalSource, /appartient à un autre client/);
});

test('staff-approved publication requires entitlement, ready media and a player', () => {
  assert.match(portalSource, /module_code=eq\.digital_signage&enabled=eq\.true/);
  assert.match(portalSource, /media\.status !== 'ready'/);
  assert.match(portalSource, /player_non_associe/);
  assert.match(portalSource, /status: 'pending'/);
  assert.match(portalSource, /publication\.staff_approved/);
  assert.match(portalSource, /review\.status !== 'client_selected'/);
  assert.match(portalSource, /staff_approved_by/);
});

test('a client cannot use the request portal without the subscribed signage service', () => {
  assert.match(portalSource, /Le service Écran géant n’est pas actif pour ce compte/);
  assert.match(portalSource, /client_module_entitlements\?select=id&email=eq\./);
});

test('client portal tables are private and protected by RLS', () => {
  for (const table of ['client_signage_requests', 'client_signage_request_assets', 'client_content_reviews']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.doesNotMatch(migration, /create policy/i);
  assert.match(proposalMigration, /alter table public\.client_content_review_proposals enable row level security/);
  assert.doesNotMatch(proposalMigration, /create policy/i);
  assert.match(postgresSource, /010_signage_three_proposal_approval\.sql/);
});

test('the client chooses one of exactly three labelled proposals', () => {
  assert.match(pageSource, /\/api\/signage\/manage\/media\/upload/);
  assert.match(pageSource, /Mes demandes vidéo/);
  assert.match(pageSource, /Demander une correction/);
  assert.match(pageSource, /PROPOSITION \{proposal\.proposal_slot\}/);
  assert.match(pageSource, /Valider la proposition/);
  assert.match(portalSource, /Choisissez exactement trois vidéos différentes/);
  assert.match(proposalMigration, /proposal_slot between 1 and 3/);
});

test('staff sends three candidates then performs the final broadcast approval', () => {
  assert.match(staffPageSource, /Envoyer les 3 propositions/);
  assert.match(staffPageSource, /Valider définitivement et diffuser/);
  assert.match(staffPageSource, /reviews\/\$\{review\.id\}\/finalize/);
  assert.match(portalSource, /client_choice_submitted/);
  assert.match(portalSource, /selected_media_id/);
  assert.match(portalSource, /canva\.link\/vps9laitxuyp8c8/);
  assert.match(portalSource, /finalOutput: 'selected_proposal_only'/);
});

test('client invitations activate on the Signage application by default', () => {
  assert.match(onboarding, /CLIENT_PORTAL_URL/);
  assert.match(onboarding, /olivier-signage-cockpit-production\.up\.railway\.app/);
});
