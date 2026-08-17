const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || '';
const ALLOWED_TABLES = new Set([
  'commerce_orders','commerce_events','client_module_entitlements','commerce_onboarding_tasks',
  'signage_players','signage_media','signage_playlists','signage_publications','camera_gateways','cameras',
  'camera_recordings','signage_audit_events','signage_player_schedule_settings','signage_player_schedule_ranges',
  'signage_player_schedule_exceptions','signage_schedule_audit'
]);
const JSON_COLUMNS = new Map([
  ['signage_players', new Set(['diagnostics'])],
  ['signage_media', new Set(['rendition'])],
  ['signage_playlists', new Set(['items'])],
  ['signage_publications', new Set(['manifest','recurrence'])],
  ['camera_gateways', new Set(['diagnostics'])],
  ['signage_audit_events', new Set(['details'])],
  ['signage_player_schedule_exceptions', new Set(['ranges'])],
  ['signage_schedule_audit', new Set(['details'])]
]);
const postgresValue = (table, column, value) => {
  if (!JSON_COLUMNS.get(table)?.has(column) || value === null || value === undefined) return value;
  return typeof value === 'string' ? value : JSON.stringify(value);
};
const ident = value => {
  const name = String(value || '');
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error('Identifiant SQL invalide');
  return `"${name}"`;
};

let pool;
let ready;
function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) pool = new Pool({ connectionString: DATABASE_URL, max: 10, idleTimeoutMillis: 30000 });
  return pool;
}

async function migrate() {
  const client = await getPool().connect();
  try {
    await client.query('select pg_advisory_lock($1)', [2182026]);
    await client.query('create table if not exists pilot_schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    for (const file of ['002_commerce_signage.sql', '003_signage_runtime.sql', '004_pilot_sponsorship.sql', '005_signage_camera_finalization.sql', '006_signage_scheduling.sql']) {
      const exists = await client.query('select 1 from pilot_schema_migrations where name=$1', [file]);
      if (exists.rowCount) continue;
      await client.query('begin');
      try {
        await client.query(fs.readFileSync(path.join(__dirname, 'migrations', file), 'utf8'));
        await client.query('insert into pilot_schema_migrations(name) values($1)', [file]);
        await client.query('commit');
      } catch (error) { await client.query('rollback'); throw error; }
    }
    const pilotEmail = String(process.env.PILOT_GRANT_EMAIL || '').trim().toLowerCase();
    const billingAccount = String(process.env.PILOT_USAGE_BILLING_ACCOUNT || '').trim();
    if (pilotEmail && billingAccount) {
      for (const moduleCode of ['digital_signage', 'videosurveillance']) {
        await client.query(
          `insert into client_module_entitlements
            (email, module_code, enabled, grant_reason, recurring_fee_cents, usage_billing_account, usage_billing_enabled, updated_at)
           values ($1, $2, true, 'pilot_gift', 0, $3, true, now())
           on conflict (email, module_code) do update set
             enabled=true, grant_reason='pilot_gift', recurring_fee_cents=0,
             usage_billing_account=excluded.usage_billing_account,
             usage_billing_enabled=true, updated_at=now()`,
          [pilotEmail, moduleCode, billingAccount]
        );
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [2182026]).catch(() => {});
    client.release();
  }
}

async function ensureReady() {
  if (!getPool()) throw new Error('DATABASE_URL non configure');
  if (!ready) ready = migrate().catch(error => { ready = null; throw error; });
  return ready;
}

function parseResource(resource) {
  const [table, raw=''] = String(resource).split('?');
  if (!ALLOWED_TABLES.has(table)) throw new Error('Table non autorisee');
  return { table, params: new URLSearchParams(raw) };
}
function whereFrom(params, values) {
  const ignored = new Set(['select','order','limit','on_conflict']);
  const clauses=[];
  for (const [key, raw] of params) {
    if (ignored.has(key)) continue;
    const [op,...rest]=raw.split('.');
    if (op !== 'eq') throw new Error('Filtre non supporte');
    values.push(rest.join('.')); clauses.push(`${ident(key)}=$${values.length}`);
  }
  return clauses.length ? ` where ${clauses.join(' and ')}` : '';
}

async function postgresRest(resource, options={}) {
  await ensureReady();
  const { table, params } = parseResource(resource);
  const method = String(options.method || 'GET').toUpperCase();
  const payload = options.body ? JSON.parse(options.body) : null;
  const prefer = String(options.headers?.Prefer || options.headers?.prefer || '');
  if (method === 'GET') {
    const values=[]; const where=whereFrom(params, values);
    const selected=(params.get('select')||'*').split(',').map(x=>x==='*'?'*':ident(x)).join(',');
    let sql=`select ${selected} from ${ident(table)}${where}`;
    const order=params.get('order'); if(order){const [col,dir='asc']=order.split('.');sql+=` order by ${ident(col)} ${dir==='desc'?'desc':'asc'}`;}
    const limit=Number(params.get('limit')); if(Number.isInteger(limit)&&limit>0){values.push(limit);sql+=` limit $${values.length}`;}
    return (await pool.query(sql,values)).rows;
  }
  if (method === 'POST') {
    const rows=Array.isArray(payload)?payload:[payload]; if(!rows.length)return [];
    const columns=Object.keys(rows[0]); const values=[];
    const groups=rows.map(row=>`(${columns.map(c=>{values.push(postgresValue(table,c,row[c]));return `$${values.length}`;}).join(',')})`);
    let sql=`insert into ${ident(table)} (${columns.map(ident).join(',')}) values ${groups.join(',')}`;
    const conflict=params.get('on_conflict');
    if(conflict){const cols=conflict.split(',').map(ident).join(',');if(prefer.includes('ignore-duplicates'))sql+=` on conflict (${cols}) do nothing`;else sql+=` on conflict (${cols}) do update set ${columns.map(c=>`${ident(c)}=excluded.${ident(c)}`).join(',')}`;}
    sql += prefer.includes('return=representation') ? ' returning *' : '';
    return (await pool.query(sql,values)).rows;
  }
  if (method === 'PATCH') {
    const values=[]; const sets=Object.entries(payload||{}).map(([k,v])=>{values.push(postgresValue(table,k,v));return `${ident(k)}=$${values.length}`;});
    if(!sets.length) return [];
    const where=whereFrom(params,values); if(!where)throw new Error('PATCH sans filtre refuse');
    let sql=`update ${ident(table)} set ${sets.join(',')}${where}`;
    if(prefer.includes('return=representation'))sql+=' returning *';
    return (await pool.query(sql,values)).rows;
  }
  if (method === 'DELETE') {
    const values=[]; const where=whereFrom(params,values); if(!where)throw new Error('DELETE sans filtre refuse');
    let sql=`delete from ${ident(table)}${where}`;
    if(prefer.includes('return=representation'))sql+=' returning *';
    return (await pool.query(sql,values)).rows;
  }
  throw new Error('Methode non supportee');
}

module.exports = { postgresRest, ensureReady, getPool };
