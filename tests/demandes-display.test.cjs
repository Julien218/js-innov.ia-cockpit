const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { build } = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { MemoryRouter } = require('react-router-dom');
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
const root = path.resolve(__dirname, '..');
const fixtures = [
  { id: 'elynea', nom: 'Test Elynea', email: 'elynea@example.test', entreprise: 'TEST — À IGNORER', message: 'Demande qualifiée par Elynea depuis www.jsinnovia.com.\nObjet : Devis IA.', type: 'elynea_commerciale', statut: 'nouveau', created_at: '2026-08-29T16:43:35Z' },
  { id: 'olivier', nom: 'P&V / Olivier', telephone: '0123456789', message: 'Demande conformité FSMA.\nNotes internes : Demande reçue via agent IA.', type: 'autre', statut: 'nouveau', created_at: '2026-07-02T00:03:59Z' },
];

async function load(entry, overrides = {}) {
  const result = await build({
    entryPoints: [path.join(root, entry)], bundle: true, platform: 'node', format: 'cjs', write: false,
    packages: 'external', alias: { '@': path.join(root, 'src') },
    define: { 'window.self': 'undefined', 'window.top': 'undefined' },
    plugins: [{ name: 'fixtures', setup(builder) {
      builder.onResolve({ filter: /^@\// }, args => Object.hasOwn(overrides, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onResolve({ filter: /^lucide-react$/ }, () => ({ path: path.join(root, 'node_modules/lucide-react/dist/esm/lucide-react.js') }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: overrides[args.path], loader: 'js' }));
    } }],
  });
  const mod = new Module(path.join(__dirname, 'demandes-fixture.cjs'), module);
  mod.filename = path.join(__dirname, 'demandes-fixture.cjs');
  mod.paths = module.paths;
  mod._compile(result.outputFiles[0].text, mod.filename);
  return mod.exports;
}

const mocks = data => ({
  '@/lib/useDemandes': `export const useDemandes = () => ({ data: ${JSON.stringify(data)} });`,
  '@/lib/AuthContext': `export const useAuth = () => ({ user: { id: 'test', role: 'superadmin' }, logout() {} });`,
  '@/lib/usePermissions': `export const usePermissions = () => ({ role: 'superadmin', canAccess: () => true });`,
});

function render(Component) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => {
    if (!String(args[0]).startsWith('Warning: useLayoutEffect does nothing on the server')) errors.push(args);
  };
  try {
    const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client },
      React.createElement(MemoryRouter, null, React.createElement(Component))));
    assert.deepEqual(errors, [], 'Rendering must not hide errors inside DataTable');
    return html;
  } finally { client.clear(); console.error = originalError; }
}

test('real Demandes page and DataTable display stored contact, message, origin, dates and actions', async () => {
  const Page = (await load('src/pages/Demandes.jsx', mocks(fixtures))).default;
  const html = render(Page);
  for (const expected of ['Test Elynea', 'elynea@example.test', 'P&amp;V / Olivier', '0123456789',
    'Devis IA.', 'Demande conformité FSMA.', 'Elynea — www.jsinnovia.com', 'Agent IA (indiqué dans la demande)',
    '29 août 2026', '02 juil. 2026', '2 nouvelles', 'Voir la demande', 'Modifier la demande', 'Supprimer la demande']) {
    assert.ok(html.includes(expected), `Missing rendered content: ${expected}`);
  }
});

test('incomplete legacy requests display explicit fallbacks instead of failing table render', async () => {
  const Page = (await load('src/pages/Demandes.jsx', mocks([{ id: 'missing', statut: 'ouverte' }]))).default;
  const html = render(Page);
  for (const expected of ['Contact non renseigné', 'Origine non renseignée', 'Date non renseignée', 'Message non renseigné', '1 nouvelles']) assert.ok(html.includes(expected), expected);
});

test('navigation badge counts new requests and disappears when they are processed', async () => {
  const Sidebar = (await load('src/components/layout/Sidebar.jsx', mocks(fixtures))).default;
  const html = render(Sidebar);
  const demandesLink = html.match(/<a[^>]*href="\/demandes"[^>]*>(.*?)<\/a>/s)?.[1];
  assert.match(demandesLink, />2<\/span>/);
  const Processed = (await load('src/components/layout/Sidebar.jsx', mocks(fixtures.map((r, i) => ({ ...r, statut: i ? 'traite' : 'en_cours' }))))).default;
  const processedLink = render(Processed).match(/<a[^>]*href="\/demandes"[^>]*>(.*?)<\/a>/s)?.[1];
  assert.doesNotMatch(processedLink, /bg-red-500/);
});

test('status aliases, provenance and editable payload preserve truthful record semantics', async () => {
  const { demandeStatus, isNewDemande, demandeOrigin, demandeFormData } = await import('../src/lib/demandePresentation.js');
  assert.equal(demandeStatus({ statut: 'en_traitement' }), 'en_cours');
  assert.equal(demandeStatus({ statut: 'resolue' }), 'traite');
  assert.equal([{ statut: 'nouveau' }, { statut: 'ouverte' }, { statut: 'en_cours' }, { statut: 'traite' }, { statut: 'ferme' }, {}].filter(isNewDemande).length, 2);
  assert.equal(demandeOrigin({ type: 'contact', email: 'person@example.test', message: 'Analyser example.test' }), 'Origine non renseignée');
  assert.equal(demandeFormData().statut, 'nouveau');
  const payload = demandeFormData({ ...fixtures[0], organisation_id: 'tenant', created_by: 'original', statut: 'ouverte' });
  assert.equal(payload.statut, 'nouveau');
  assert.equal(payload.message, fixtures[0].message);
  assert.ok(!('id' in payload) && !('created_by' in payload) && !('organisation_id' in payload));
});

test('shared query refreshes badges, scopes cache to user and tenant, and respects request permission', async () => {
  const query = async (id, tenant, allowed) => {
    const { useDemandes } = await load('src/lib/useDemandes.js', {
      '@/lib/AuthContext': `export const useAuth = () => ({ user: { id: '${id}', organisation_id: '${tenant}' } });`,
      '@/lib/usePermissions': `export const usePermissions = () => ({ canAccess: () => ${allowed} });`,
    });
    // The actual hook is exercised inside a React component; query cache exposes its options.
    const client = new QueryClient();
    function Probe() { useDemandes(); return null; }
    try {
      renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(Probe)));
      return client.getQueryCache().getAll()[0].options;
    } finally { client.clear(); }
  };
  const a = await query('alice', 'one', true);
  const b = await query('bob', 'two', false);
  assert.equal(a.refetchInterval, 30000);
  assert.equal(a.refetchOnWindowFocus, true);
  assert.equal(a.enabled, true);
  assert.equal(b.enabled, false);
  assert.notDeepEqual(a.queryKey, b.queryKey);
});
