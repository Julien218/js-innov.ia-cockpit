export function interactionContext() {
  /** @type {Window & {electronAPI?: {localVoice?: unknown}, SpeechRecognition?: unknown, webkitSpeechRecognition?: unknown}} */
  const host = window;
  return {
    desktop: Boolean(host.electronAPI),
    voice: Boolean(host.SpeechRecognition || host.webkitSpeechRecognition || host.electronAPI?.localVoice),
  };
}

export async function finishElyneaResponse(data, runtime = { fetch, document, URL, setTimeout }) {
  if (!data.download) return data;
  // Browser functions must not receive the dependency container as their receiver.
  const { fetch: request, setTimeout: schedule } = runtime;
  const { url, filename } = data.download;
  if (!/^\/api\/documents\/[a-zA-Z0-9_-]{1,120}\/download$/.test(String(url))) throw new Error('Lien de téléchargement refusé.');
  const response = await request(url, { credentials: 'same-origin', signal: AbortSignal.timeout(60000) });
  if (!response.ok || !/attachment/i.test(response.headers.get('Content-Disposition') || '')) throw new Error('Le fichier n’a pas pu être récupéré.');
  const blob = await response.blob();
  if (!blob.size || blob.size > 100 * 1024 * 1024) throw new Error('Fichier vide ou trop volumineux.');
  const href = runtime.URL.createObjectURL(blob);
  const anchor = runtime.document.createElement('a');
  const name = String(filename || 'document').replace(/[\\/<>:"|?*\u0000-\u001f]/g, '-').slice(0, 180);
  try {
    anchor.href = href; anchor.download = name;
    runtime.document.body.appendChild(anchor); anchor.click();
  } finally {
    anchor.remove(); schedule(() => runtime.URL.revokeObjectURL(href), 60000);
  }
  return { ...data, message: `Fichier récupéré : ${name}. Le téléchargement a été transmis à l’application ou au navigateur.`, download_started: true };
}
