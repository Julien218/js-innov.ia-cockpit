// A login can receive JS-Innov.IA invoices for several legal/commercial records.
// This server-only mapping is NOT permission to manage those businesses' books.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISSUED_STATUSES = new Set(['envoyee', 'payee', 'en_retard', 'annulee']);
const PUBLIC_FIELDS = ['id', 'numero', 'objet', 'montant_ht', 'montant_tva', 'tva', 'montant_ttc', 'statut', 'date_emission', 'date_echeance', 'created_at'];
const LINE_FIELDS = ['description', 'periode', 'quantity', 'quantite', 'unit_price_ht', 'prix_unitaire_ht', 'tva', 'tva_pct', 'total_ht', 'total_ttc'];
const issuer = 'jsinnovia';

function failure(message, status = 503) { return Object.assign(new Error(message), { status }); }

function invoiceScope(user, raw = process.env.CLIENT_INVOICE_RECIPIENTS_JSON || '{}') {
  if (user?.role !== 'client') return null;
  let mappings;
  try { mappings = JSON.parse(raw); } catch { throw failure('Configuration des destinataires de facturation invalide.'); }
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) throw failure('Configuration des destinataires de facturation invalide.');
  if (!Object.hasOwn(mappings, user.id)) return null;
  const entry = mappings[user.id];
  if (!entry || typeof entry.email !== 'string' || entry.email.toLowerCase() !== String(user.email || '').trim().toLowerCase()) throw failure('Rattachement de facturation à vérifier.', 403);
  const recipients = entry.recipients;
  if (!recipients || typeof recipients !== 'object' || Array.isArray(recipients) || Object.keys(recipients).length > 20 ||
      Object.entries(recipients).some(([id, label]) => !UUID.test(id) || typeof label !== 'string' || !label.trim())) throw failure('Configuration des destinataires de facturation invalide.');
  return { recipients };
}

function visibleInvoice(row, scope) {
  if (!row || !UUID.test(row.id) || row.organisation_id !== issuer || !Object.hasOwn(scope.recipients, row.client_id) || !ISSUED_STATUSES.has(row.statut)) return null;
  const result = Object.fromEntries(PUBLIC_FIELDS.map(field => [field, row[field] ?? null]));
  const sourceLines = Array.isArray(row.items) && row.items.length ? row.items : row.lignes;
  const lines = Array.isArray(sourceLines) ? sourceLines.filter(line => line && typeof line === 'object' && !Array.isArray(line)).map(line =>
    Object.fromEntries(LINE_FIELDS.filter(field => ['string', 'number'].includes(typeof line[field])).map(field => [field, line[field]]))) : [];
  return { ...result, client_nom: scope.recipients[row.client_id], issuer_name: 'JS-Innov.IA', invoice_lines: lines };
}

async function readClientInvoices(scope, request, invoiceId = null) {
  if (invoiceId !== null && !UUID.test(invoiceId)) throw failure('Facture introuvable.', 404);
  const read = async path => {
    const result = await request(path, { method: 'GET', tenant: issuer, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!result.response.ok) throw failure('Factures momentanément indisponibles.');
    try { return JSON.parse(result.raw); } catch { throw failure('Réponse de facturation invalide.'); }
  };
  if (invoiceId) {
    const row = await read(`/data/Facture/${encodeURIComponent(invoiceId)}`);
    const visible = row?.id === invoiceId ? visibleInvoice(row, scope) : null;
    if (!visible) throw failure('Facture introuvable.', 404);
    return visible;
  }
  const batches = await Promise.all(Object.keys(scope.recipients).map(async clientId => {
    // The existing agent caps at 1000 and applies equality filters. Fail at the
    // cap instead of claiming an incomplete list is complete.
    const query = new URLSearchParams({ client_id: clientId, organisation_id: issuer, limit: '1000' });
    const rows = await read(`/data/Facture?${query}`);
    if (!Array.isArray(rows) || rows.length >= 1000) throw failure('Liste de factures trop longue ou invalide; contactez JS-Innov.IA.');
    return rows.filter(row => row?.client_id === clientId).map(row => visibleInvoice(row, scope)).filter(Boolean);
  }));
  const unique = new Map(batches.flat().map(row => [row.id, row]));
  return [...unique.values()].sort((a, b) => String(b.date_emission || b.created_at || '').localeCompare(String(a.date_emission || a.created_at || '')) || a.id.localeCompare(b.id));
}

module.exports = { invoiceScope, visibleInvoice, readClientInvoices };
