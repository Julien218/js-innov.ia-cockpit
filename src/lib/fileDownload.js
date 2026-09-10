export function safeDownloadName(value, fallback = 'download') {
  const normalized = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()
    .replace(/\.+$/, '');
  return normalized || fallback;
}

export function downloadBlob(blob, filename) {
  if (!blob) throw new Error('Aucun contenu à télécharger.');
  const documentImpl = globalThis.document;
  const urlImpl = globalThis.URL;
  if (!documentImpl?.createElement || !urlImpl?.createObjectURL) {
    throw new Error('Le téléchargement est indisponible dans ce contexte.');
  }

  const objectUrl = urlImpl.createObjectURL(blob);
  const link = documentImpl.createElement('a');
  link.href = objectUrl;
  link.download = safeDownloadName(filename);
  link.rel = 'noopener';
  documentImpl.body?.appendChild(link);
  link.click();
  link.remove();
  const revoke = () => urlImpl.revokeObjectURL?.(objectUrl);
  if (typeof globalThis.setTimeout === 'function') globalThis.setTimeout(revoke, 0);
  else revoke();
  return link.download;
}

export function videoStudioMediaUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url, globalThis.location?.origin || 'http://localhost');
    const marker = '/storage/v1/object/public/video-studio/';
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return url;
    const storagePath = decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length));
    return '/api/video-studio/media?path=' + encodeURIComponent(storagePath);
  } catch {
    return url;
  }
}

export async function downloadRemoteFile(url, filename, fetchImpl = globalThis.fetch) {
  if (!url || typeof fetchImpl !== 'function') {
    throw new Error('Le fichier audio n’est pas disponible.');
  }
  const response = await fetchImpl(videoStudioMediaUrl(url), { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error('Téléchargement refusé par le serveur (' + response.status + ').');
  }
  const blob = await response.blob();
  return downloadBlob(blob, filename);
}
