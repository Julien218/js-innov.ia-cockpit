const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const leaseSource = read('server-publisya-job-lease.cjs');
const serverSource = read('server.cjs');
const dockerSource = read('Dockerfile');
const migrationSource = read('supabase', 'migrations', '20260905174500_publisya_distributed_leases.sql');

const {
  clampInteger,
  normalizeWorkerId,
  normalizeNextAttemptAt,
  leaseFoundationStatus,
} = require('../server-publisya-job-lease.cjs');

test('distributed lease migration adds expiring ownership without enabling a scheduler', () => {
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS lease_token UUID/);
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ/);
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION public\.publisya_claim_publication_jobs/);
  assert.match(migrationSource, /FOR UPDATE OF j SKIP LOCKED/);
  assert.match(migrationSource, /lease_token = gen_random_uuid\(\)/);
  assert.match(migrationSource, /lease_expires_at = now\(\) \+ make_interval/);
  assert.doesNotMatch(migrationSource, /pg_cron|cron\.schedule|CREATE EXTENSION.*cron/i);
});

test('only approved content and connected social accounts can be claimed', () => {
  assert.match(migrationSource, /c\.status IN \('approved', 'scheduled', 'publishing'\)/);
  assert.match(migrationSource, /v\.status = 'approved'/);
  assert.match(migrationSource, /a\.connection_status = 'connected'/);
  assert.match(migrationSource, /j\.attempt_count < j\.max_attempts/);
  assert.match(migrationSource, /j\.scheduled_at <= now\(\)/);
  assert.match(migrationSource, /j\.next_attempt_at IS NULL OR j\.next_attempt_at <= now\(\)/);
});

test('expired locked jobs can be reclaimed but live leases cannot', () => {
  assert.match(migrationSource, /j\.status = 'locked'/);
  assert.match(migrationSource, /j\.lease_expires_at IS NOT NULL/);
  assert.match(migrationSource, /j\.lease_expires_at <= now\(\)/);
  assert.match(migrationSource, /j\.lease_expires_at > now\(\)/);
});

test('lease renew and release require worker plus exact lease token ownership', () => {
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION public\.publisya_renew_publication_lease/);
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION public\.publisya_release_publication_lease/);
  assert.match(migrationSource, /j\.locked_by = v_worker_id/);
  assert.match(migrationSource, /j\.lease_token = p_lease_token/);
  assert.match(migrationSource, /lease_not_owned_or_expired/);
});

test('lease RPCs are service-role only', () => {
  assert.match(migrationSource, /REVOKE EXECUTE ON FUNCTION public\.publisya_claim_publication_jobs[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migrationSource, /GRANT EXECUTE ON FUNCTION public\.publisya_claim_publication_jobs[\s\S]*TO service_role/);
  assert.match(migrationSource, /REVOKE EXECUTE ON FUNCTION public\.publisya_renew_publication_lease[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migrationSource, /REVOKE EXECUTE ON FUNCTION public\.publisya_release_publication_lease[\s\S]*FROM PUBLIC, anon, authenticated/);
});

test('server lease client allowlists only the three prepared RPCs', () => {
  assert.match(leaseSource, /\^publisya_\(claim\|renew\|release\)_publication_\(jobs\|lease\)\$/);
  assert.match(leaseSource, /publisya_claim_publication_jobs/);
  assert.match(leaseSource, /publisya_renew_publication_lease/);
  assert.match(leaseSource, /publisya_release_publication_lease/);
  assert.match(leaseSource, /PUBLISYA_LEASE_RPC_NOT_ALLOWED/);
});

test('lease bounds and worker identifiers are deterministic', () => {
  assert.equal(clampInteger(0, 1, 20, 1), 1);
  assert.equal(clampInteger(50, 1, 20, 1), 20);
  assert.equal(clampInteger('4', 1, 20, 1), 4);
  assert.equal(normalizeWorkerId('railway:replica-1'), 'railway:replica-1');
  assert.throws(() => normalizeWorkerId('bad worker id with spaces'), /invalide/);
  assert.equal(normalizeNextAttemptAt(null), null);
  assert.equal(normalizeNextAttemptAt('2026-09-05T18:00:00Z'), '2026-09-05T18:00:00.000Z');
});

test('lease foundation is explicitly dormant and non-publishing', () => {
  assert.deepEqual(leaseFoundationStatus(), {
    started: false,
    automatic_claiming: false,
    automatic_refresh: false,
    publishing_enabled: false,
    scheduler_enabled: false,
    lease_seconds_min: 15,
    lease_seconds_max: 300,
    claim_batch_max: 20,
  });
  assert.doesNotMatch(leaseSource, /setInterval|setTimeout|node-cron|scheduleJob/);
  assert.doesNotMatch(leaseSource, /facebook\.com|graph\.facebook|tiktokapis\.com|linkedin\.com|googleapis\.com/);
  assert.doesNotMatch(leaseSource, /publisya_publication_attempts/);
  assert.doesNotMatch(serverSource, /server-publisya-job-lease\.cjs/);
});

test('Docker packages and syntax-checks the lease client without starting it', () => {
  assert.match(dockerSource, /COPY --from=builder \/app\/server-publisya-job-lease\.cjs \.\/server-publisya-job-lease\.cjs/);
  assert.match(dockerSource, /test -f \/app\/server-publisya-job-lease\.cjs/);
  assert.match(dockerSource, /node --check \/app\/server-publisya-job-lease\.cjs/);
  assert.doesNotMatch(dockerSource, /(?:CMD|ENTRYPOINT)[^\n]*server-publisya-job-lease\.cjs/);
  assert.doesNotMatch(dockerSource, /(?:^|\n)\s*node \/app\/server-publisya-job-lease\.cjs(?:\s|&|$)/m);
});