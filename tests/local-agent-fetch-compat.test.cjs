const test = require('node:test');
const assert = require('node:assert/strict');

async function loadCompat() {
  return import('../src/lib/localAgentFetchCompat.js');
}

test('extractLocalAgentText accepts direct and nested local-agent contracts', async () => {
  const { extractLocalAgentText } = await loadCompat();
  assert.equal(extractLocalAgentText({ response: 'bonjour' }), 'bonjour');
  assert.equal(extractLocalAgentText({ data: { answer: 'réponse locale' } }), 'réponse locale');
  assert.equal(extractLocalAgentText({ result: { output: { text: 'ok local' } } }), 'ok local');
  assert.equal(extractLocalAgentText({ choices: [{ message: { content: 'format OpenAI-compatible' } }] }), 'format OpenAI-compatible');
  assert.equal(extractLocalAgentText({ data: 'texte directement dans data' }), 'texte directement dans data');
});

test('extractLocalAgentText does not mistake health/status metadata for an answer', async () => {
  const { extractLocalAgentText } = await loadCompat();
  assert.equal(extractLocalAgentText({ status: 'ok', agent: 'online', ollama: 'online', model: 'qwen3.5:4b' }), null);
});

test('extractLocalAgentModels accepts the installed health contract and ollama contract', async () => {
  const { extractLocalAgentModels } = await loadCompat();
  assert.deepEqual(extractLocalAgentModels({ status: 'ok', model: 'qwen3.5:4b' }), ['qwen3.5:4b']);
  assert.deepEqual(
    extractLocalAgentModels({ services: { ollama: { models: [{ name: 'qwen3.5:4b' }, { model: 'llama3.2:3b' }] } } }),
    ['qwen3.5:4b', 'llama3.2:3b'],
  );
});

test('compat bridge normalizes a nested chat response only for local agent URLs', async () => {
  const originalFetch = globalThis.fetch;
  const previousFlag = globalThis.__JSINNOVIA_LOCAL_AGENT_FETCH_COMPAT__;
  try {
    globalThis.__JSINNOVIA_LOCAL_AGENT_FETCH_COMPAT__ = false;
    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('127.0.0.1:8787')) {
        return new Response(JSON.stringify({ ok: true, data: { answer: 'normalisée' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: { answer: 'cloud intact' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const { installLocalAgentFetchCompat } = await loadCompat();
    installLocalAgentFetchCompat();

    const local = await (await globalThis.fetch('http://127.0.0.1:8787/api/agent/chat')).json();
    assert.equal(local.response, 'normalisée');

    const cloud = await (await globalThis.fetch('https://example.test/api/agent/chat')).json();
    assert.equal(cloud.response, undefined);
    assert.equal(cloud.data.answer, 'cloud intact');
  } finally {
    globalThis.fetch = originalFetch;
    if (previousFlag === undefined) delete globalThis.__JSINNOVIA_LOCAL_AGENT_FETCH_COMPAT__;
    else globalThis.__JSINNOVIA_LOCAL_AGENT_FETCH_COMPAT__ = previousFlag;
  }
});
