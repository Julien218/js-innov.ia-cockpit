const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('normal server startup installs the NOVA PDF route', () => {
  const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
  assert.match(server, /installNovaDocumentRoutes\(assistantRouter\)/);
});

test('PDF duplicate lookup is scoped to the authenticated organisation', async (t) => {
  const previousKey = process.env.JSINNOVIA_AGENT_KEY;
  const previousUrl = process.env.JSINNOVIA_AGENT_URL;
  const previousFetch = global.fetch;
  process.env.JSINNOVIA_AGENT_KEY = 'test-key';
  process.env.JSINNOVIA_AGENT_URL = 'https://agent.example.test';
  const modulePath = require.resolve('../server-nova-document-upload.cjs');
  delete require.cache[modulePath];
  const { findExistingDocument, resolveUploadOrganisation } = require(modulePath);
  t.after(() => {
    delete require.cache[modulePath];
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.JSINNOVIA_AGENT_KEY;
    else process.env.JSINNOVIA_AGENT_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.JSINNOVIA_AGENT_URL;
    else process.env.JSINNOVIA_AGENT_URL = previousUrl;
  });

  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      json: async () => [
        { id: 'foreign', organisation: 'other-org', email_message_id: 'nova-pdf:abc' },
        { id: 'current', organisation: 'my-org', email_message_id: 'nova-pdf:abc' },
      ],
    };
  };

  assert.equal(resolveUploadOrganisation({ organisation: 'my/org' }), 'my-org');
  const existing = await findExistingDocument('abc', 'my-org');
  assert.equal(existing.id, 'current');
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.searchParams.get('organisation'), 'my-org');
  assert.equal(calls[0].options.headers['x-organisation-id'], 'my-org');
});

test('uploaded PDF summaries are appended to the mounted NOVA chat', () => {
  const bridge = fs.readFileSync(path.join(root, 'src', 'components', 'NovaDocumentUploadBridge.jsx'), 'utf8');
  const floating = fs.readFileSync(path.join(root, 'src', 'components', 'FloatingAgent.jsx'), 'utf8');
  assert.match(bridge, /new CustomEvent\(CHAT_APPEND_EVENT/);
  assert.match(floating, /addEventListener\(CHAT_APPEND_EVENT/);
  assert.match(floating, /setMessages\(\(current\) => \[\.\.\.current, \.\.\.appended\]\.slice\(-50\)\)/);
});
