const test = require('node:test');
const assert = require('node:assert/strict');

test('diagnostics distinguish availability, unknown measurements and execution proof', async (t) => {
  const { collectReadOnlyDiagnostics, formatDiagnosticContext } = await import('../src/lib/assistantDiagnosticBridge.js');
  const original = global.window;
  t.after(() => { if (original === undefined) delete global.window; else global.window = original; });
  const healthyAgent = async () => ({ ok: true, json: async () => ({ status: 'ok' }) });
  function environment(status, storage = null) {
    global.window = {
      location: { pathname: '/taches' },
      localStorage: { getItem: () => storage },
      ...(status ? { electronAPI: { videoLocal: { status } } } : {}),
    };
  }
  await t.test('web has no Electron measurements and agent HTTP 200 does not certify Ollama', async () => {
    environment();
    const d = await collectReadOnlyDiagnostics(healthyAgent);
    assert.equal(d.local_agent.online, true);
    assert.equal(d.local_agent.ollama_online, null);
    assert.equal(d.video.comfyui_online, null);
    assert.equal(d.video.ffmpeg_online, null);
    const text = formatDiagnosticContext(d);
    assert.match(text, /non accessible depuis le web/);
    assert.match(text, /ComfyUI 8188: non mesuré/);
    assert.match(text, /Ollama: non mesuré/);
    assert.doesNotMatch(text, /hors ligne\/non mesuré/);
  });
  await t.test('successful desktop measurements do not certify end-to-end operation', async () => {
    environment(async () => ({ comfyui: { online: true }, ffmpeg: { online: true } }), '{}');
    const d = await collectReadOnlyDiagnostics(async () => ({ ok: true, json: async () => ({ ollama: { online: true } }) }));
    assert.equal(d.local_agent.ollama_online, true);
    assert.equal(d.video.comfyui_online, true);
    assert.equal(d.video.ffmpeg_online, true);
    assert.equal(d.video.h3_workflow_ready, true);
    const text = formatDiagnosticContext(d);
    assert.match(text, /Aucun test de génération vidéo de bout en bout/);
    assert.match(text, /modèles et validité du workflow non vérifiés/);
  });
  await t.test('explicit negative measurements remain distinct from missing fields', async () => {
    environment(async () => ({ comfyui: { online: false } }));
    const d = await collectReadOnlyDiagnostics(async () => ({ ok: true, json: async () => ({ ollama_online: false }) }));
    assert.equal(d.video.comfyui_online, false);
    assert.equal(d.video.ffmpeg_online, null);
    assert.equal(d.local_agent.ollama_online, false);
    assert.match(formatDiagnosticContext(d), /ComfyUI 8188: indisponible selon le contrôle Electron/);
  });
  await t.test('bridge, network and storage errors are unknown, not component failures', async () => {
    environment(async () => { throw new Error('IPC unavailable'); });
    window.localStorage.getItem = () => { throw new Error('storage blocked'); };
    const d = await collectReadOnlyDiagnostics(async () => { throw new Error('Failed to fetch'); });
    assert.equal(d.local_agent.online, null);
    assert.equal(d.video.desktop_bridge, true);
    assert.equal(d.video.comfyui_online, null);
    assert.equal(d.video.ffmpeg_online, null);
    assert.equal(d.video.h3_workflow_ready, null);
    assert.match(formatDiagnosticContext(d), /Contrôle agent non concluant/);
    assert.match(formatDiagnosticContext(d), /Contrôle vidéo non concluant/);
  });
  await t.test('malformed health data never becomes an Ollama measurement', async () => {
    environment();
    for (const response of [
      { ok: true, json: async () => { throw new Error('invalid JSON'); } },
      { ok: false, status: 503, json: async () => ({ ollama_online: true }) },
      { ok: true, json: async () => ({ ollama_online: 'false' }) },
    ]) {
      const d = await collectReadOnlyDiagnostics(async () => response);
      assert.equal(d.local_agent.ollama_online, null);
    }
  });
});
