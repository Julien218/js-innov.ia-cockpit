const EXPECTED_TOKEN_SHA256 = '01187789e2e8c3ae47616518eced51ad0c1ad745138c7b53472ef89179771085';
const ALLOWED_TABLES = new Set([
  'client_billing_rules',
  'client_cost_events',
  'client_cost_centers',
  'client_external_mappings',
  'cost_accounting_settings',
  'client_cost_imports',
  'client_invoices',
  'client_invoice_lines',
  'video_generation_jobs',
]);

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const token = request.headers.get('x-cockpit-proxy-token') || '';
  if (!token || await sha256(token) !== EXPECTED_TOKEN_SHA256) return json(401, { error: 'unauthorized' });

  let input: { path?: string; method?: string; headers?: Record<string, string>; body?: string | null };
  try { input = await request.json(); } catch { return json(400, { error: 'invalid_json' }); }
  const path = String(input.path || '').replace(/^\/+/, '');
  const table = decodeURIComponent(path.split(/[?&]/, 1)[0] || '');
  const method = String(input.method || 'GET').toUpperCase();
  if (!ALLOWED_TABLES.has(table)) return json(403, { error: 'table_not_allowed' });
  if (!['GET', 'POST', 'PATCH'].includes(method)) return json(403, { error: 'method_not_allowed' });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) return json(503, { error: 'supabase_runtime_unavailable' });
  const forwardedHeaders: Record<string, string> = {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    'Content-Type': 'application/json',
  };
  const prefer = input.headers?.Prefer || input.headers?.prefer;
  if (prefer) forwardedHeaders.Prefer = String(prefer).slice(0, 300);
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: forwardedHeaders,
    body: method === 'GET' ? undefined : String(input.body || ''),
  });
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
    },
  });
});
