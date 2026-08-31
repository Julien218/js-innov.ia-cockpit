const test = require('node:test');
const assert = require('node:assert/strict');
const { invoiceScope, visibleInvoice, readClientInvoices } = require('../server-client-invoices.cjs');
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'recipient@example.invalid', role: 'client', organisation: 'Pixelium' };
const recipient = '22222222-2222-4222-8222-222222222222';
const otherRecipient = '33333333-3333-4333-8333-333333333333';
const invoiceId = '44444444-4444-4444-8444-444444444444';
const raw = JSON.stringify({ [user.id]: { email: user.email, recipients: { [recipient]: 'Starlight ASBL' } } });
const scope = invoiceScope(user, raw);
const row = { id: invoiceId, client_id: recipient, organisation_id: 'jsinnovia', statut: 'envoyee', numero: 'TEST-LOCAL', montant_ttc: 100, notes: 'PRIVATE', marge: 25, pdf_dropbox_path: '/private.pdf', lignes: [{ internal_cost: 12 }] };
const response = rows => ({ response: { ok: true }, raw: JSON.stringify(rows) });

test('cache de consultation séparé par compte, purgé au démontage et masqué en cas de refus', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/pages/ClientRecords.jsx'), 'utf8');
  assert.match(source, /queryKey: \['client-records', user\?\.id, config\.table\]/);
  assert.match(source, /gcTime: 0/);
  assert.match(source, /\(isError \? \[\] : data\)\.map/);
  assert.match(source, /loadRows\(config\.table, signal\)/);
});

test('destinataire lié à identifiant ET email, sans changement de tenant', () => {
  assert.equal(invoiceScope({ ...user, role: 'admin' }, raw), null);
  assert.equal(invoiceScope({ ...user, id: otherRecipient }, raw), null);
  assert.throws(() => invoiceScope({ ...user, email: 'other@example.invalid' }, raw), /vérifier/);
  assert.equal(scope.recipients[recipient], 'Starlight ASBL');
  assert.equal(user.organisation, 'Pixelium');
});

test('configuration invalide fermée, jamais élargie à tous les clients', () => {
  for (const value of ['broken', '[]', 'null']) assert.throws(() => invoiceScope(user, value));
  assert.throws(() => invoiceScope(user, JSON.stringify({ [user.id]: { email: user.email, recipients: { '*': 'All' } } })));
});

test('projection exclut brouillons, autres clients, ventes propres et informations internes', () => {
  assert.equal(visibleInvoice({ ...row, client_id: otherRecipient }, scope), null);
  assert.equal(visibleInvoice({ ...row, organisation_id: 'pixelium' }, scope), null);
  assert.equal(visibleInvoice({ ...row, statut: 'brouillon' }, scope), null);
  assert.equal(visibleInvoice({ ...row, statut: 'unexpected' }, scope), null);
  for (const statut of ['envoyee', 'payee', 'annulee', 'en_retard']) assert.ok(visibleInvoice({ ...row, statut }, scope));
  const result = visibleInvoice(row, scope);
  assert.equal(result.issuer_name, 'JS-Innov.IA'); assert.equal(result.client_nom, 'Starlight ASBL');
  for (const key of ['notes', 'marge', 'pdf_dropbox_path', 'lignes', 'client_id', 'organisation_id']) assert.equal(key in result, false);
  assert.equal(JSON.stringify(result).includes('internal_cost'), false);
  const detailed = visibleInvoice({ ...row, items: [{ description: 'Prestation', prix_unitaire_ht: 25, internal_cost: 12, metadata: { secret: true } }] }, scope);
  assert.deepEqual(detailed.invoice_lines, [{ description: 'Prestation', prix_unitaire_ht: 25 }]);
});

test('lecture filtrée au serveur et recontrôle local même si le fournisseur ignore les filtres', async () => {
  let calls = 0;
  const rows = await readClientInvoices(scope, async (path, options) => {
    calls++;
    assert.equal(options.method, 'GET'); assert.equal(options.tenant, 'jsinnovia');
    assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    const url = new URL(path, 'https://example.invalid');
    assert.equal(url.searchParams.get('client_id'), recipient);
    assert.equal(url.searchParams.get('organisation_id'), 'jsinnovia');
    return response([row, row, { ...row, client_id: otherRecipient }, { ...row, statut: 'brouillon' }]);
  });
  assert.equal(calls, 1); assert.equal(rows.length, 1);
});

test('les erreurs et listes tronquées ne deviennent pas un faux succès', async () => {
  await assert.rejects(readClientInvoices(scope, async () => ({ response: { ok: false }, raw: 'secret error' })), /indisponibles/);
  await assert.rejects(readClientInvoices(scope, async () => response(Array(1000).fill(row))), /trop longue/);
  await assert.rejects(readClientInvoices(scope, async () => response({ unexpected: true })), /invalide/);
});

test('la consultation directe vérifie toujours le destinataire et le statut', async () => {
  assert.equal((await readClientInvoices(scope, async () => response(row), invoiceId)).id, invoiceId);
  await assert.rejects(readClientInvoices(scope, async () => response({ ...row, client_id: otherRecipient }), invoiceId), e => e.status === 404);
  await assert.rejects(readClientInvoices(scope, async () => response({ ...row, statut: 'brouillon' }), invoiceId), e => e.status === 404);
  await assert.rejects(readClientInvoices(scope, async () => { throw Error('must not fetch'); }, '../x'), e => e.status === 404);
});

test('route réelle locale : filtres forgés neutralisés, écritures et permission désactivée refusées', async () => {
  process.env.CLIENT_INVOICE_RECIPIENTS_JSON = raw;
  process.env.AGENT_API_KEY = 'test-only-key';
  const express = require('express');
  const router = require('../server-data-proxy.cjs');
  const nativeFetch = global.fetch;
  let upstreamCalls = 0;
  let sessionUser = user;
  global.fetch = async (url, options) => {
    upstreamCalls++;
    assert.equal(options.headers['x-organisation-id'], 'jsinnovia');
    assert.equal(new URL(url).searchParams.get('client_id'), recipient);
    return new Response(JSON.stringify([row, { ...row, client_id: otherRecipient }]), { headers: { 'content-type': 'application/json' } });
  };
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.user = sessionUser; next(); }); app.use('/api/data', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/data`;
  try {
    const res = await nativeFetch(`${base}/Facture?client_id=${otherRecipient}&organisation_id=other&limit=99999`);
    assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const data = await res.json(); assert.equal(data.length, 1); assert.equal(data[0].client_nom, 'Starlight ASBL');
    for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await nativeFetch(`${base}/Facture`, { method })).status, 403);
    assert.equal((await nativeFetch(`${base}/Facture`, { headers: { 'x-managed-organisation': 'jsinnovia' } })).status, 403);
    assert.equal((await nativeFetch(`${base}/Facture/anything/send`)).status, 403);
    sessionUser = { ...user, permission_overrides: [{ permission_code: 'invoices', enabled: false }] };
    assert.equal((await nativeFetch(`${base}/Facture`)).status, 403);
    assert.equal(upstreamCalls, 1);
  } finally {
    global.fetch = nativeFetch; delete process.env.CLIENT_INVOICE_RECIPIENTS_JSON;
    await new Promise(resolve => server.close(resolve));
  }
});
