export async function executeNovaClientAction(clientAction = {}) {
  if (clientAction.kind === 'electron_web_task') {
    const execute = window.electronAPI?.webAssistant?.execute;
    if (typeof execute !== 'function') {
      const details = 'Cette tâche authentifiée doit être confirmée dans l’application Windows JS-Innov.IA Cockpit.';
      return { ok: false, data: { error: details }, details };
    }
    let result;
    try { result = await execute(clientAction.body || {}); }
    catch (error) {
      const details = String(error?.message || 'La tâche web a échoué.');
      return { ok: false, data: { error: details }, details };
    }
    if (!result?.success || result?.status !== 'verified') {
      const details = result?.details || 'La tâche web n’a pas fourni de preuve de réussite.';
      return { ok: false, data: { ...result, error: details }, details };
    }
    const proof = result.proof || {};
    return {
      ok: true,
      data: result,
      details: `Vérifié: ${proof.source || 'source'} → ${proof.final_url || proof.location || proof.expected || 'destination'}`,
    };
  }

  const response = await fetch(clientAction.url, {
    method: clientAction.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(clientAction.body || {}),
  });
  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    data,
    details: response.ok ? 'Action exécutée par la route sécurisée du Cockpit' : (data.error || `HTTP ${response.status}`),
  };
}
